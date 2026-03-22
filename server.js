import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('CRITICAL ERROR:', err);
  if (err.message.includes('__vite-browser-external')) {
    console.error('\n--- WINDOWS RESOLUTION FIX ---');
    console.error('It looks like Vite is trying to resolve Node built-ins for the browser.');
    console.error('Try running the project in a folder without spaces in the path.');
    console.error('Current path:', process.cwd());
    console.error('-------------------------------\n');
  }
});

async function startServer() {
  // Dynamic imports to avoid any resolution issues on Windows
  const express = (await import("express")).default;
  const { Server } = await import("socket.io");

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
  });

  const PORT = 3000;

  // Game state storage
  const rooms = new Map();

  function createDeck(jokerEnabled = true) {
    const suits = ["♠", "♥", "♦", "♣"];
    const values = {
      "♠": ["6", "7", "8", "9", "10", "J", "Q", "K", "A"],
      "♥": ["6", "7", "8", "9", "10", "J", "Q", "K", "A"],
      "♦": ["7", "8", "9", "10", "J", "Q", "K", "A"],
      "♣": ["7", "8", "9", "10", "J", "Q", "K", "A"],
    };
    
    const deck = [];
    for (const suit of suits) {
      for (const value of values[suit]) {
        deck.push({ suit, value, type: 'normal' });
      }
    }
    
    if (jokerEnabled) {
      deck.push({ suit: "Joker", value: "Black", type: 'joker' });
      deck.push({ suit: "Joker", value: "Red", type: 'joker' });
    }
    
    return deck.sort(() => Math.random() - 0.5);
  }

  function dealCards(gameState) {
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      // Ensure we have 36 cards (34 regular + 2 jokers)
      // Spades(9) + Hearts(9) + Diamonds(8) + Clubs(8) + Jokers(2) = 36
      const deck = createDeck(true); 
      
      // Reset player cards
      gameState.players.forEach(p => p.cards = []);
      
      // Deal one card at a time in rotation (Player 1 -> 2 -> 3 -> 4)
      for (let i = 0; i < deck.length; i++) {
        const playerIndex = i % gameState.players.length;
        gameState.players[playerIndex].cards.push(deck[i]);
      }
      
      // Validation: 4 players, each must have exactly 9 cards
      const allHave9 = gameState.players.every(p => p.cards.length === 9);
      if (allHave9 && gameState.players.length === 4) {
        // Success! Sort cards and set initial hands for reveal mechanic
        gameState.initialHands = {};
        gameState.players.forEach(player => {
          player.cards.sort((a, b) => {
            const suits = ["♠", "♥", "♣", "♦", "Joker"];
            if (a.suit !== b.suit) return suits.indexOf(a.suit) - suits.indexOf(b.suit);
            const values = ["6", "7", "8", "9", "10", "J", "Q", "K", "A", "Black", "Red"];
            return values.indexOf(a.value) - values.indexOf(b.value);
          });
          gameState.initialHands[player.id] = [...player.cards];
          player.tricks = 0;
          const hasRed = player.cards.some((c) => c.type === 'joker' && c.value === 'Red');
          const hasBlack = player.cards.some((c) => c.type === 'joker' && c.value === 'Black');
          player.hasBothJokers = hasRed && hasBlack;
          player.playedRedJoker = false;
          player.playedBlackJoker = false;
        });
        return true;
      }
      attempts++;
      console.log(`[Room ${gameState.roomCode}] Dealing validation failed (Attempt ${attempts}). Redealing...`);
    }
    return false;
  }

  function evaluateTrick(cards, trumpSuit) {
    const leadSuit = cards[0].suit;
    
    const sorted = [...cards].sort((a, b) => {
      // Jokers
      if (a.type === 'joker' && !a.isBurned) {
        if (b.type === 'joker' && !b.isBurned) {
          return a.value === 'Red' ? -1 : 1;
        }
        return -1;
      }
      if (b.type === 'joker' && !b.isBurned) return 1;

      // Trump
      if (a.suit === trumpSuit && b.suit !== trumpSuit) return -1;
      if (b.suit === trumpSuit && a.suit !== trumpSuit) return 1;

      // Lead suit
      if (a.suit === leadSuit && b.suit !== leadSuit) return -1;
      if (b.suit === leadSuit && a.suit !== leadSuit) return 1;

      // Value comparison
      const values = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
      return values.indexOf(b.value) - values.indexOf(a.value);
    });

    return sorted[0];
  }

  function isValidPlay(gameState, player, cardIndex) {
    // Following Suit Rule is now disabled - players can play any card
    // but the system still tracks violations for the Reveal system.
    // This supports the "Secret Play" rule for high contracts (6, 7, 8).
    return { valid: true };
  }

  function processBid(gameState, playerIndex, bid) {
    const player = gameState.players[playerIndex];

    if (gameState.phase === 'DEALER_FORCED_BID') {
      gameState.highestBid = bid;
      gameState.bidWinnerIndex = gameState.dealerIndex;
      gameState.phase = 'TRUMP_SELECTION';
      gameState.turnIndex = gameState.bidWinnerIndex;

      if (bid === 8) {
        io.to(gameState.roomCode).emit("chatMessage", {
          id: Date.now() + Math.random().toString(),
          username: "SYSTEM",
          seat: "SYS",
          message: `🔥 ${player.name} has bid 8! Bidding ends immediately.`,
          time: Date.now()
        });
      }
    } else {
      if (bid !== 0 && bid > gameState.highestBid) {
        gameState.highestBid = bid;
        gameState.bidWinnerIndex = gameState.turnIndex;
      }

      // If a player bids 8, skip all others and go straight to trump selection
      if (bid === 8) {
        gameState.phase = 'TRUMP_SELECTION';
        gameState.turnIndex = gameState.bidWinnerIndex;
        
        // Add a system message to notify everyone
        io.to(gameState.roomCode).emit("chatMessage", {
          id: Date.now() + Math.random().toString(),
          username: "SYSTEM",
          seat: "SYS",
          message: `🔥 ${player.name} has bid 8! Bidding ends immediately.`,
          time: Date.now()
        });
        return;
      }

      gameState.turnIndex = (gameState.turnIndex - 1 + gameState.players.length) % gameState.players.length;
      const biddingFinished = gameState.turnIndex === (gameState.dealerIndex - 1 + gameState.players.length) % gameState.players.length;
      
      if (biddingFinished) {
        gameState.phase = 'TRUMP_SELECTION';
        gameState.turnIndex = gameState.bidWinnerIndex;
      } else if (gameState.turnIndex === gameState.dealerIndex && gameState.highestBid === 0) {
        gameState.phase = 'DEALER_FORCED_BID';
      }
    }
  }

  function processTrumpSelection(gameState, suit) {
    gameState.trumpSuit = suit;
    gameState.phase = 'PLAYING';
    gameState.roundNumber = 1;
    gameState.turnIndex = (gameState.bidWinnerIndex - 1 + gameState.players.length) % gameState.players.length;
  }

  function processCardPlay(gameState, playerIndex, cardIndex) {
    const player = gameState.players[playerIndex];
    const card = player.cards[cardIndex];

    let isBurned = false;
    let burnReason = `${card.value} Joker Burned by ${player.name}`;
    if (card.type === 'joker') {
      if (gameState.highestBid <= 6 && player.hasBothJokers) {
        if (card.value === 'Red') {
          if (!player.playedBlackJoker) {
            isBurned = true;
            burnReason = `Red Joker Burned by ${player.name} (Played before Black Joker on bid <= 6)`;
          } else {
            isBurned = false;
          }
        } else if (card.value === 'Black') {
          isBurned = false;
        }
      } else {
        if (card.value === 'Black') {
          const isLeading = gameState.tableCards.length === 0;
          if (isLeading) {
            // Black Joker Opening Exception
            const canLeadBlackJoker = player.hasBothJokers && gameState.highestBid >= 7 && player.playedRedJoker;
            if (!canLeadBlackJoker) {
              isBurned = true;
              burnReason = `Black Joker Opening Violation by ${player.name} (Requires Both Jokers, Bid 7+, Red Joker played first)`;
            }
          } else {
            if (player.hasBothJokers && player.playedRedJoker) {
              isBurned = false;
            } else if (gameState.roundNumber >= 4) {
              isBurned = true;
              burnReason = `Black Joker Burned by ${player.name} (Played in Round ${gameState.roundNumber} without Both Jokers and Red played first)`;
            }
          }
        }
        
        if (card.value === 'Red') {
          if (player.hasBothJokers) {
            isBurned = false;
          } else {
            const blackJokerPlayed = gameState.history.some(trick => 
              trick.cards.some(c => c.type === 'joker' && c.value === 'Black' && !c.isBurned)
            );
            const blackJokerOnTable = gameState.tableCards.some(c => c.type === 'joker' && c.value === 'Black' && !c.isBurned);
            if (!blackJokerPlayed && !blackJokerOnTable) {
              isBurned = true;
              burnReason = `Red Joker Burned by ${player.name} (Played before Black Joker)`;
            }
          }
        }
      }

      if (card.value === 'Red') player.playedRedJoker = true;
      if (card.value === 'Black') player.playedBlackJoker = true;
    }

    player.cards.splice(cardIndex, 1);
    gameState.tableCards.push({ ...card, playedBy: player.name, playerId: player.id, isBurned });

    if (isBurned) {
      gameState.phase = 'ROUND_OVER';
      gameState.tableCards = []; // Clear table cards immediately
      const playingTeam = (playerIndex % 2 === 0) ? 1 : 2;
      const opposingTeam = playingTeam === 1 ? 2 : 1;
      let team1RoundScore = opposingTeam === 1 ? 15 : 0;
      let team2RoundScore = opposingTeam === 2 ? 15 : 0;
      gameState.team1Score += team1RoundScore;
      gameState.team2Score += team2RoundScore;
      
      // Next dealer logic
      gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
      gameState.gameRoundNumber++;
      
      gameState.lastRoundResult = {
        team1Tricks: 0, team2Tricks: 0,
        biddingTeam: (gameState.bidWinnerIndex % 2 === 0) ? 1 : 2,
        highestBid: gameState.highestBid,
        team1RoundScore, team2RoundScore,
        reason: burnReason,
        isJokerBurn: true,
        burnedJoker: card.value,
        round: gameState.roundNumber,
        gameRound: gameState.gameRoundNumber
      };

      if (gameState.team1Score >= gameState.pointLimit || gameState.team2Score >= gameState.pointLimit) {
        gameState.phase = 'GAME_OVER';
      }

      // Return true to indicate a special phase has started and caller should not do normal trick resolution
      return "JOKER_BURN";
    }

    gameState.turnIndex = (gameState.turnIndex - 1 + gameState.players.length) % gameState.players.length;

    if (gameState.tableCards.length === gameState.players.length) {
      const winnerCard = evaluateTrick(gameState.tableCards, gameState.trumpSuit);
      const winnerPlayer = gameState.players.find(p => p.id === winnerCard.playerId);
      if (winnerPlayer) winnerPlayer.tricks++;
      
      if (gameState.bound?.status === 'ACCEPTED' && gameState.bound.choice === 'YES') {
        const biddingTeam = (gameState.bidWinnerIndex % 2 === 0) ? 1 : 2;
        const winnerIndex = gameState.players.findIndex(p => p.id === winnerCard.playerId);
        const winnerTeam = (winnerIndex % 2 === 0) ? 1 : 2;
        if (winnerTeam !== biddingTeam) {
          gameState.bound.lostTrick = true;
        }
      }

      gameState.history.push({ round: gameState.roundNumber, cards: [...gameState.tableCards], winner: winnerPlayer?.name });
      gameState.turnIndex = gameState.players.findIndex(p => p.id === winnerCard.playerId);
      
      return true; // Indicates trick is over and needs timeout
    }
    return false;
  }

  function clearRoomTimers(gameState) {
    if (gameState.bidTimer) {
      clearInterval(gameState.bidTimer);
      gameState.bidTimer = null;
    }
    if (gameState.voting && gameState.voting.timer) {
      clearInterval(gameState.voting.timer);
      gameState.voting.timer = null;
    }
    if (gameState.revealResultTimeout) {
      clearTimeout(gameState.revealResultTimeout);
      gameState.revealResultTimeout = null;
    }
    if (gameState.trickTimeout) {
      clearTimeout(gameState.trickTimeout);
      gameState.trickTimeout = null;
    }
    if (gameState.jokerBurnTimeout) {
      clearTimeout(gameState.jokerBurnTimeout);
      gameState.jokerBurnTimeout = null;
    }
  }

  function getPublicState(gameState, socketId) {
    if (!gameState) return null;
    
    const publicPlayers = gameState.players.map(p => {
      const isMe = p.id === socketId || (gameState.isSandbox && socketId === gameState.hostId && p.isBot);
      return {
        ...p,
        cards: isMe ? p.cards : p.cards.map(() => ({ suit: 'hidden', value: 'hidden', type: 'hidden' }))
      };
    });

    // Hide history, initialHands and all timer references from public state
    const { 
      history, 
      initialHands, 
      bidTimer, 
      revealResultTimeout, 
      trickTimeout, 
      jokerBurnTimeout, 
      ...publicState 
    } = gameState;
    
    // Sanitize voting object to remove timer reference
    if (publicState.voting && publicState.voting.timer) {
      const { timer, ...sanitizedVoting } = publicState.voting;
      publicState.voting = sanitizedVoting;
    }
    
    return {
      ...publicState,
      players: publicPlayers,
      bidTimeLeft: gameState.bidTimeLeft
    };
  }

  function startBiddingTimer(roomCode) {
    const gameState = rooms.get(roomCode);
    if (!gameState) return;

    if (gameState.bidTimer) {
      clearInterval(gameState.bidTimer);
    }

    gameState.bidTimeLeft = gameState.bidTimerLimit || 30;
    broadcastState(roomCode); // Initial broadcast with current limit
    
    gameState.bidTimer = setInterval(() => {
      const state = rooms.get(roomCode);
      if (!state || (state.phase !== 'BIDDING' && state.phase !== 'DEALER_FORCED_BID')) {
        if (state && state.bidTimer) {
          clearInterval(state.bidTimer);
          state.bidTimer = null;
        }
        return;
      }

      state.bidTimeLeft--;
      
      if (state.bidTimeLeft <= 0) {
        clearInterval(state.bidTimer);
        state.bidTimer = null;
        
        // Auto-pass (bid 0)
        processBid(state, state.turnIndex, 0);
        broadcastState(roomCode);
        
        // If still in bidding phase, start timer for next player
        if (state.phase === 'BIDDING' || state.phase === 'DEALER_FORCED_BID') {
          startBiddingTimer(roomCode);
        }
      } else {
        // Just broadcast the state with updated time
        broadcastState(roomCode);
      }
    }, 1000);
  }

  function resolveVote(roomCode) {
    const gameState = rooms.get(roomCode);
    if (!gameState || !gameState.voting) return;

    if (gameState.voting.timer) {
      clearInterval(gameState.voting.timer);
    }

    if (gameState.voting.closeVotes > gameState.voting.continueVotes) {
      // Majority Close
      gameState.phase = 'ROUND_OVER';
      gameState.tableCards = [];
      
      // Calculate points
      const team1Tricks = gameState.players[0].tricks + gameState.players[2].tricks;
      const team2Tricks = gameState.players[1].tricks + gameState.players[3].tricks;
      const biddingTeam = (gameState.bidWinnerIndex % 2 === 0) ? 1 : 2;
      const opponentTeam = biddingTeam === 1 ? 2 : 1;
      const opponentTricks = opponentTeam === 1 ? team1Tricks : team2Tricks;
      
      let opponentTarget = 0;
      if (gameState.highestBid === 6) opponentTarget = 4;
      else if (gameState.highestBid === 7) opponentTarget = 3;
      else if (gameState.highestBid === 8) opponentTarget = 2;
      else opponentTarget = (9 - gameState.highestBid) + 1;

      let penaltyMultiplier = (gameState.gameRoundNumber === 1) ? 1 : 2;
      let team1RoundScore = 0;
      let team2RoundScore = 0;
      let bidBroken = opponentTricks >= opponentTarget;

      if (biddingTeam === 1) {
        if (!bidBroken) {
          team1RoundScore = team1Tricks;
          team2RoundScore = 0;
        } else {
          team1RoundScore = 0;
          team2RoundScore = gameState.highestBid * penaltyMultiplier;
        }
      } else {
        if (!bidBroken) {
          team2RoundScore = team2Tricks;
          team1RoundScore = 0;
        } else {
          team2RoundScore = 0;
          team1RoundScore = gameState.highestBid * penaltyMultiplier;
        }
      }
      
      gameState.team1Score += team1RoundScore;
      gameState.team2Score += team2RoundScore;
      gameState.gameRoundNumber++;
      
      gameState.lastRoundResult = {
        team1Tricks, team2Tricks, biddingTeam,
        highestBid: gameState.highestBid,
        team1RoundScore, team2RoundScore,
        opponentTarget,
        reason: bidBroken ? `Bid Broken! Opponent reached target of ${opponentTarget} tricks.` : `Bid Successful!`
      };

      if (gameState.team1Score >= gameState.pointLimit || gameState.team2Score >= gameState.pointLimit) {
        gameState.phase = 'GAME_OVER';
      }
      gameState.voting = null;
    } else {
      // Majority Continue (or tie/timeout defaults to continue)
      gameState.phase = 'PLAYING';
      gameState.voting = null;
    }
    broadcastState(roomCode);
  }

  function startVoteTimer(roomCode) {
    const gameState = rooms.get(roomCode);
    if (!gameState || !gameState.voting) return;

    if (gameState.voting.timer) {
      clearInterval(gameState.voting.timer);
    }

    gameState.voting.timeLeft = gameState.voteTimerLimit || 20; 
    
    gameState.voting.timer = setInterval(() => {
      const state = rooms.get(roomCode);
      if (!state || !state.voting) {
        if (state && state.voting && state.voting.timer) clearInterval(state.voting.timer);
        return;
      }

      state.voting.timeLeft--;
      if (state.voting.timeLeft <= 0) {
        resolveVote(roomCode);
      } else {
        broadcastState(roomCode);
      }
    }, 1000);
  }

  function broadcastState(roomCode) {
    const gameState = rooms.get(roomCode);
    if (!gameState) return;
    
    const roomSockets = io.sockets.adapter.rooms.get(roomCode);
    if (roomSockets) {
      for (const socketId of roomSockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit("gameUpdate", getPublicState(gameState, socketId));
        }
      }
    }
  }

  io.on("connection", (socket) => {
    // Host a new game
    socket.on("hostGame", (data) => {
      const playerName = typeof data === 'string' ? data : data.playerName;
      const isSandbox = typeof data === 'object' ? data.isSandbox : false;
      const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      socket.join(roomCode);
      
      const players = [{ id: socket.id, name: playerName, cards: [], tricks: 0, connected: true, seatId: 0 }];
      if (isSandbox) {
        players.push({ id: 'bot1', name: 'Bot 1', cards: [], tricks: 0, connected: true, isBot: true, seatId: 1 });
        players.push({ id: 'bot2', name: 'Bot 2', cards: [], tricks: 0, connected: true, isBot: true, seatId: 2 });
        players.push({ id: 'bot3', name: 'Bot 3', cards: [], tricks: 0, connected: true, isBot: true, seatId: 3 });
      }
      console.log("Players created:", players.map(p => ({ name: p.name, seatId: p.seatId })));

      const gameState = {
        roomCode,
        isSandbox,
        hostId: socket.id,
        players,
        team1Name: "Team 1",
        team2Name: "Team 2",
        pointLimit: 56,
        bidTimerLimit: 30,
        voteTimerLimit: 20,
        tableCards: [],
        gameStarted: false,
        phase: 'WAITING', // WAITING, BIDDING, TRUMP_SELECTION, PLAYING, ROUND_OVER, GAME_OVER
        turnIndex: 0,
        dealerIndex: 0,
        highestBid: 0,
        bidWinnerIndex: -1,
        trumpSuit: '',
        roundNumber: 1,
        gameRoundNumber: 1,
        trickWinnerId: '',
        history: [],
        initialHands: {}, // Store hands at the start of each game round
        revealResult: null,
        team1Score: 0,
        team2Score: 0,
        jokerEnabled: true,
        lastRoundResult: null,
        contractTeamTricks: 0,
        opposingTeamTricks: 0,
        voting: null, // { continueVotes: 0, closeVotes: 0, playersVoted: [] }
        messages: [],
        mutes: []
      };
      rooms.set(roomCode, gameState);
      socket.emit("gameHosted", getPublicState(gameState, socket.id));
    });

    // Rejoin game
    socket.on("rejoinGame", ({ roomCode, playerName }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) {
        socket.emit("error", "Room not found.");
        return;
      }
      const player = gameState.players.find((p) => p.name === playerName);
      if (!player) {
        socket.emit("error", "Player not found in this room.");
        return;
      }
      
      // Update socket id
      player.id = socket.id;
      player.connected = true;
      socket.join(roomCode);
      socket.emit("gameUpdate", getPublicState(gameState, socket.id));
      
      if (!gameState.messages) gameState.messages = [];
      gameState.messages.push({
        username: 'SYSTEM',
        seat: 'SYS',
        message: `${playerName} (P${player.seatId + 1}) reconnected.`,
        time: Date.now()
      });
      
      broadcastState(roomCode);
    });

    // Join an existing game
    socket.on("joinGame", ({ roomCode, playerName }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.players.length >= 4 || gameState.gameStarted) {
        socket.emit("error", "Cannot join room. It might be full or already started.");
        return;
      }
      socket.join(roomCode);
      const takenSeatIds = gameState.players.map(p => p.seatId);
      let seatId = 0;
      while (takenSeatIds.includes(seatId) && seatId < 4) {
        seatId++;
      }
      if (seatId >= 4) {
        socket.emit("error", "Cannot join room. It might be full.");
        return;
      }
      gameState.players.push({ id: socket.id, name: playerName, cards: [], tricks: 0, connected: true, seatId });
      broadcastState(roomCode);
    });

    // Host Power: Kick Player
    socket.on("kickPlayer", ({ roomCode, playerId }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || playerId === socket.id) return;
      
      const playerIndex = gameState.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        gameState.players.splice(playerIndex, 1);
        const kickedSocket = io.sockets.sockets.get(playerId);
        if (kickedSocket) {
          kickedSocket.leave(roomCode);
          kickedSocket.emit("kicked");
        }
        broadcastState(roomCode);
      }
    });

    // Host Power: Swap Players (Teams)
    socket.on("swapPlayers", ({ roomCode, index1, index2 }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || gameState.gameStarted) return;
      
      // Only swap if both indices are within the current players array
      if (index1 >= 0 && index1 < gameState.players.length && 
          index2 >= 0 && index2 < gameState.players.length) {
        const temp = gameState.players[index1];
        gameState.players[index1] = gameState.players[index2];
        gameState.players[index2] = temp;
        
        broadcastState(roomCode);
      }
    });

    // Host Power: Reorder Players
    socket.on("reorderPlayers", ({ roomCode, newPlayers }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || gameState.gameStarted) return;
      
      // Basic validation: same length
      if (newPlayers.length === gameState.players.length) {
        gameState.players = newPlayers;
        broadcastState(roomCode);
      }
    });

    // Handle Voting (Now Host Decision)
    socket.on("castVote", ({ roomCode, vote }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'VOTING' || !gameState.voting) return;
      
      // Only host can make the decision
      if (socket.id !== gameState.hostId) return;

      if (vote === 'CONTINUE') {
        gameState.voting.continueVotes = 1;
        gameState.voting.closeVotes = 0;
      } else if (vote === 'CLOSE') {
        gameState.voting.continueVotes = 0;
        gameState.voting.closeVotes = 1;
      }

      resolveVote(roomCode);
    });

    // Host Power: Rename Teams
    socket.on("renameTeams", ({ roomCode, team1Name, team2Name }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      if (team1Name) gameState.team1Name = team1Name;
      if (team2Name) gameState.team2Name = team2Name;
      
      broadcastState(roomCode);
    });

    // Host Power: Update Settings
    socket.on("updateSettings", ({ roomCode, settings }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      if (settings.pointLimit !== undefined) gameState.pointLimit = settings.pointLimit;
      if (settings.bidTimerLimit !== undefined) gameState.bidTimerLimit = settings.bidTimerLimit;
      if (settings.voteTimerLimit !== undefined) gameState.voteTimerLimit = settings.voteTimerLimit;
      
      if (settings.newRoomCode && settings.newRoomCode !== gameState.roomCode) {
        const oldCode = gameState.roomCode;
        const newCode = settings.newRoomCode.toUpperCase();
        
        if (rooms.has(newCode)) {
          socket.emit("error", "Room code already exists.");
          return;
        }

        gameState.roomCode = newCode;
        rooms.delete(oldCode);
        rooms.set(newCode, gameState);
        
        // Move all sockets to new room
        const clients = io.sockets.adapter.rooms.get(oldCode);
        if (clients) {
          for (const clientId of clients) {
            const clientSocket = io.sockets.sockets.get(clientId);
            if (clientSocket) {
              clientSocket.leave(oldCode);
              clientSocket.join(newCode);
            }
          }
        }
        broadcastState(newCode);
      } else {
        broadcastState(gameState.roomCode);
      }
    });

    // Host Power: Pause/Resume Game
    socket.on("togglePause", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      gameState.isPaused = !gameState.isPaused;
      broadcastState(roomCode);
    });

    // Host Power: End Game
    socket.on("endGame", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      clearRoomTimers(gameState);
      gameState.gameStarted = false;
      gameState.phase = 'WAITING';
      gameState.tableCards = [];
      gameState.players.forEach(p => {
        p.cards = [];
        p.tricks = 0;
      });
      
      broadcastState(roomCode);
    });

    // Handle Leave Room
    socket.on("leaveRoom", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (gameState) {
        const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          // If it's a sandbox game or the game hasn't started, we might want to remove them
          // But for simplicity, let's just mark them as disconnected
          gameState.players[playerIndex].connected = false;
          broadcastState(roomCode);
        }
        socket.leave(roomCode);
      }
    });

    // Handle Disconnect
    socket.on("disconnect", () => {
      rooms.forEach((gameState, roomCode) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
          player.connected = false;
          broadcastState(roomCode);
        }
      });
    });

    // Start the game
    socket.on("startGame", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.players[0].id !== socket.id) return;
      
      clearRoomTimers(gameState);
      if (gameState.players.length < 4) {
        return;
      }
      
      if (gameState.phase === 'GAME_OVER') {
        gameState.team1Score = 0;
        gameState.team2Score = 0;
        gameState.gameRoundNumber = 1;
        gameState.history = [];
      }

      gameState.gameStarted = true;
      gameState.phase = 'BIDDING';
      gameState.turnIndex = (gameState.dealerIndex - 1 + gameState.players.length) % gameState.players.length;
      gameState.highestBid = 0;
      gameState.bidWinnerIndex = -1;
      gameState.bound = null; // Clear bound state for new game/round
      
      const dealSuccess = dealCards(gameState);
      if (!dealSuccess) {
        socket.emit("error", "Failed to deal cards correctly. Please try starting again.");
        return;
      }
      
      broadcastState(roomCode);
      startBiddingTimer(roomCode);
    });

    // Handle Bidding
    socket.on("placeBid", ({ roomCode, bid }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || (gameState.phase !== 'BIDDING' && gameState.phase !== 'DEALER_FORCED_BID')) return;
      
      const currentPlayerIndex = gameState.turnIndex;
      const isHostPlayingForBot = gameState.isSandbox && socket.id === gameState.hostId && gameState.players[currentPlayerIndex].isBot;
      if (gameState.players[currentPlayerIndex].id !== socket.id && !isHostPlayingForBot) return;

      // Clear timer when bid is placed
      if (gameState.bidTimer) {
        clearInterval(gameState.bidTimer);
        gameState.bidTimer = null;
      }

      processBid(gameState, currentPlayerIndex, bid);
      
      broadcastState(roomCode);

      // Start timer for next player if still in bidding phase
      if (gameState.phase === 'BIDDING' || gameState.phase === 'DEALER_FORCED_BID') {
        startBiddingTimer(roomCode);
      }
    });

    // Handle Trump Selection
    socket.on("selectTrump", ({ roomCode, suit }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'TRUMP_SELECTION') return;
      const isHostPlayingForBot = gameState.isSandbox && socket.id === gameState.hostId && gameState.players[gameState.bidWinnerIndex].isBot;
      if (gameState.players[gameState.bidWinnerIndex].id !== socket.id && !isHostPlayingForBot) return;

      processTrumpSelection(gameState, suit);
      
      broadcastState(roomCode);
    });

    // Handle Card Reordering
    socket.on("reorderCards", ({ roomCode, newCards }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      if (playerIndex === -1) return;

      // Ensure the new cards match the old cards in length and content
      const player = gameState.players[playerIndex];
      if (player.cards.length === newCards.length) {
        player.cards = newCards;
        // Only emit to the specific player to avoid unnecessary updates for others
        socket.emit("gameUpdate", getPublicState(gameState, socket.id));
      }
    });

    // Handle Card Play
    socket.on("playCard", ({ roomCode, cardIndex }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'PLAYING') return;
      
      // Prevent playing if the trick is currently resolving
      if (gameState.tableCards.length >= 4) return;

      let playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      // If host is controlling a bot, allow them to play if it's that bot's turn
      if (gameState.isSandbox && socket.id === gameState.hostId) {
        playerIndex = gameState.turnIndex;
      }
      if (playerIndex !== gameState.turnIndex) return;

      const player = gameState.players[playerIndex];
      const card = player.cards[cardIndex];

      const validation = isValidPlay(gameState, player, cardIndex);
      if (!validation.valid) {
        socket.emit("error", validation.reason);
        return;
      }

      const playResult = processCardPlay(gameState, playerIndex, cardIndex);
      
      if (playResult === "JOKER_BURN") {
        broadcastState(roomCode);
        
        // Handle the automatic resume here in the main handler to ensure scope is correct
        if (gameState.jokerBurnTimeout) clearTimeout(gameState.jokerBurnTimeout);
        gameState.jokerBurnTimeout = setTimeout(() => {
          const state = rooms.get(roomCode);
          if (!state) return;
          state.jokerBurnTimeout = null;
          if (state.phase !== 'ROUND_OVER' || !state.lastRoundResult?.isJokerBurn) return;
          
          // Reset for next round
          state.phase = 'BIDDING';
          state.turnIndex = (state.dealerIndex - 1 + state.players.length) % state.players.length;
          state.highestBid = 0;
          state.bidWinnerIndex = -1;
          state.history = [];
          state.tableCards = [];
          state.initialHands = {};
          state.roundNumber = 1;
          state.trumpSuit = null;
          state.lastRoundResult = null;
          state.bound = null; // Clear bound state
          
          state.players.forEach(p => {
            p.cards = [];
            p.tricks = 0;
          });

          const dealSuccess = dealCards(state);
          if (dealSuccess) {
            broadcastState(roomCode);
            startBiddingTimer(roomCode);
          }
        }, 7000);
        return;
      }

      const needsTimeout = playResult;
      if (needsTimeout) {
        broadcastState(roomCode);
        if (gameState.trickTimeout) clearTimeout(gameState.trickTimeout);
        gameState.trickTimeout = setTimeout(() => {
          const stateAfterTrick = rooms.get(roomCode);
          if (!stateAfterTrick) return;
          stateAfterTrick.trickTimeout = null;
          stateAfterTrick.tableCards = [];
          stateAfterTrick.roundNumber++;
          
          checkBoundCondition(stateAfterTrick);
          
          // Check contract conditions
          const team1Tricks = stateAfterTrick.players[0].tricks + stateAfterTrick.players[2].tricks;
          const team2Tricks = stateAfterTrick.players[1].tricks + stateAfterTrick.players[3].tricks;
          const biddingTeam = (stateAfterTrick.bidWinnerIndex % 2 === 0) ? 1 : 2;
          
          const contractTeamTricks = biddingTeam === 1 ? team1Tricks : team2Tricks;
          const opposingTeamTricks = biddingTeam === 1 ? team2Tricks : team1Tricks;
          
          let opponentTarget = 0;
          if (stateAfterTrick.highestBid === 6) opponentTarget = 4;
          else if (stateAfterTrick.highestBid === 7) opponentTarget = 3;
          else if (stateAfterTrick.highestBid === 8) opponentTarget = 2;
          else opponentTarget = (9 - stateAfterTrick.highestBid) + 1;

          if (stateAfterTrick.bound?.status === 'ACCEPTED' && stateAfterTrick.bound.choice === 'YES') {
            const biddingTeam = (stateAfterTrick.bidWinnerIndex % 2 === 0) ? 1 : 2;
            const opposingTeam = biddingTeam === 1 ? 2 : 1;

            if (stateAfterTrick.bound.lostTrick) {
              // Reverse Bound: Contract team loses immediately
              stateAfterTrick.phase = 'GAME_OVER';
              if (opposingTeam === 1) stateAfterTrick.team1Score = stateAfterTrick.pointLimit;
              else stateAfterTrick.team2Score = stateAfterTrick.pointLimit;
              
              stateAfterTrick.lastRoundResult = {
                reason: "Reverse Bound! Contract team lost a trick. Opposing team wins the game!",
                isBound: true,
                boundResult: 'LOST',
                biddingTeam,
                team1Tricks,
                team2Tricks
              };
              broadcastState(roomCode);
              return; // Stop further processing
            } else if (stateAfterTrick.players[0].cards.length === 0) {
              // Contract team wins all tricks
              stateAfterTrick.phase = 'GAME_OVER';
              if (biddingTeam === 1) stateAfterTrick.team1Score = stateAfterTrick.pointLimit;
              else stateAfterTrick.team2Score = stateAfterTrick.pointLimit;

              stateAfterTrick.lastRoundResult = {
                reason: "Bound Successful! Contract team won all 9 tricks. Game Over!",
                isBound: true,
                boundResult: 'WON',
                biddingTeam,
                team1Tricks,
                team2Tricks
              };
              broadcastState(roomCode);
              return; // Stop further processing
            }
          }

          if (stateAfterTrick.phase !== 'ROUND_OVER' && (contractTeamTricks >= stateAfterTrick.highestBid || opposingTeamTricks >= opponentTarget)) {
            stateAfterTrick.phase = 'VOTING';
            stateAfterTrick.voting = { continueVotes: 0, closeVotes: 0, playersVoted: [] };
            startVoteTimer(roomCode);
          }
          
          if (stateAfterTrick.roundNumber > 9) {
            stateAfterTrick.phase = 'ROUND_OVER';
            stateAfterTrick.dealerIndex = (stateAfterTrick.dealerIndex + 1) % stateAfterTrick.players.length;
            stateAfterTrick.bound = null; // Clear bound for next round
            
            // Penalty Multiplier Rule:
            // If contract is 6, 7, or 8 in subsequent rounds (Round > 1), points are doubled if lost.
            // If contract is 6 in the first round, do not double.
            // We apply the "no double in first round" to 7 and 8 as well based on the "subsequent rounds" phrasing.
            let penaltyMultiplier = (stateAfterTrick.gameRoundNumber === 1) ? 1 : 2;
            let team1RoundScore = 0;
            let team2RoundScore = 0;
            let bidBroken = opposingTeamTricks >= opponentTarget;

            if (biddingTeam === 1) {
              if (!bidBroken) {
                // Fulfilled: Award points according to tricks won
                team1RoundScore = team1Tricks;
                team2RoundScore = 0; // Failed team receives 0
              } else {
                // Failed: Bidding team receives 0, Opponent receives penalty
                team1RoundScore = 0;
                team2RoundScore = stateAfterTrick.highestBid * penaltyMultiplier;
              }
            } else {
              if (!bidBroken) {
                // Fulfilled: Award points according to tricks won
                team2RoundScore = team2Tricks;
                team1RoundScore = 0; // Failed team receives 0
              } else {
                // Failed: Bidding team receives 0, Opponent receives penalty
                team2RoundScore = 0;
                team1RoundScore = stateAfterTrick.highestBid * penaltyMultiplier;
              }
            }
            
            stateAfterTrick.team1Score += team1RoundScore;
            stateAfterTrick.team2Score += team2RoundScore;
            stateAfterTrick.gameRoundNumber++;
            
            stateAfterTrick.lastRoundResult = {
              team1Tricks, team2Tricks, biddingTeam,
              highestBid: stateAfterTrick.highestBid,
              team1RoundScore, team2RoundScore,
              opponentTarget,
              reason: bidBroken ? `Bid Broken! Opponent reached target of ${opponentTarget} tricks.` : `Bid Successful!`
            };

            if (stateAfterTrick.team1Score >= stateAfterTrick.pointLimit || stateAfterTrick.team2Score >= stateAfterTrick.pointLimit) {
              stateAfterTrick.phase = 'GAME_OVER';
            }
          }
          broadcastState(roomCode);
        }, 2000);
      } else {
        broadcastState(roomCode);
      }
    });

    function checkBoundCondition(gameState) {
      if (gameState.highestBid < 7 || gameState.bound) return;

      const biddingTeam = (gameState.bidWinnerIndex % 2 === 0) ? 1 : 2;
      const team1Tricks = gameState.players[0].tricks + gameState.players[2].tricks;
      const team2Tricks = gameState.players[1].tricks + gameState.players[3].tricks;
      const contractTeamTricks = biddingTeam === 1 ? team1Tricks : team2Tricks;
      
      const cardsPlayed = 9 - gameState.players[0].cards.length;
      
      // Contract team has won all tricks so far in the current round
      if (contractTeamTricks !== cardsPlayed) return;

      const cardsRemaining = gameState.players[0].cards.length;
      const triggerCards = gameState.highestBid === 8 ? 2 : 3;

      if (cardsRemaining === triggerCards) {
        gameState.bound = {
          offeredTo: gameState.players[gameState.bidWinnerIndex].id,
          status: 'OFFERED',
          choice: null
        };
      }
    }

    socket.on("boundChoice", ({ roomCode, choice }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || !gameState.bound || gameState.bound.status !== 'OFFERED') return;
      if (gameState.bound.offeredTo !== socket.id) return;

      if (choice === 'YES') {
        gameState.bound.status = 'ACCEPTED';
        gameState.bound.choice = 'YES';
      } else {
        gameState.bound.status = 'VOTING';
        gameState.bound.choice = 'NO';
        gameState.voting = { continueVotes: 0, closeVotes: 0, playersVoted: [] };
        startVoteTimer(roomCode);
      }
      broadcastState(roomCode);
    });

    // Handle Targeted Reveal (Improved Version)
    socket.on("revealChallenge", ({ roomCode, targetPlayerId, roundToInspect, suitType }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'PLAYING') return;

      const challengerIndex = gameState.players.findIndex(p => p.id === socket.id);
      const targetIndex = gameState.players.findIndex(p => p.id === targetPlayerId);
      if (challengerIndex === -1 || targetIndex === -1) return;

      const tricksInRound = gameState.history.filter(h => h.round === roundToInspect);
      if (tricksInRound.length === 0) return;
      
      const trick = tricksInRound.find(t => t.cards.some(c => c.playerId === targetPlayerId));
      if (!trick) return;

      const targetPlayedCard = trick.cards.find(c => c.playerId === targetPlayerId);
      if (!targetPlayedCard) return;

      // Determine demanded suit based on user selection
      let demandedSuit = suitType;
      if (suitType === 'Trump') demandedSuit = gameState.trumpSuit;

      // Reconstruct target's hand at that moment
      const initialHand = gameState.initialHands[targetPlayerId] || [];
      const trickIndex = gameState.history.indexOf(trick);
      const cardsPlayedBefore = [];
      for (let i = 0; i < trickIndex; i++) {
        const h = gameState.history[i];
        const played = h.cards.find(c => c.playerId === targetPlayerId);
        if (played) cardsPlayedBefore.push(played);
      }

      const handAtMoment = initialHand.filter(card => 
        !cardsPlayedBefore.some(played => played.suit === card.suit && played.value === card.value)
      );

      // Check for violation: Did they have the suit but played something else?
      let violationFound = false;
      
      // A violation occurs if:
      // 1. The card they played is NOT the demanded suit (and not a Joker if demanded is Trump)
      // 2. They HAD the demanded suit in their hand at that moment
      
      const playedCardIsDemanded = (targetPlayedCard.suit === demandedSuit && targetPlayedCard.type !== 'joker') || 
                                   (suitType === 'Trump' && targetPlayedCard.type === 'joker');

      if (!playedCardIsDemanded) {
        const hadDemandedSuit = handAtMoment.some(c => 
          (c.suit === demandedSuit && c.type !== 'joker') || 
          (suitType === 'Trump' && c.type === 'joker')
        );
        if (hadDemandedSuit) violationFound = true;
      }

      const challengerTeam = (challengerIndex % 2 === 0) ? 1 : 2;
      const targetTeam = (targetIndex % 2 === 0) ? 1 : 2;
      
      let pointsAwardedTo = 0;
      let message = "";

      if (violationFound) {
        // Violation Found: Opposing team of target gets 15 points
        pointsAwardedTo = targetTeam === 1 ? 2 : 1;
        message = `Violation Found! ${gameState.players[targetIndex].name} had ${suitType} but played ${targetPlayedCard.suit === 'none' ? 'Joker' : targetPlayedCard.suit}. Team ${pointsAwardedTo} receives 15 points.`;
      } else {
        // Reveal Was Incorrect: Target's team receives 15 points as a penalty to the challenger
        pointsAwardedTo = targetTeam;
        message = `Incorrect Reveal! ${gameState.players[targetIndex].name} did not have ${suitType}. Team ${pointsAwardedTo} receives 15 points.`;
      }

      if (pointsAwardedTo === 1) gameState.team1Score += 15;
      else gameState.team2Score += 15;

      gameState.revealResult = {
        challenger: gameState.players[challengerIndex].name,
        target: gameState.players[targetIndex].name,
        targetId: gameState.players[targetIndex].id,
        round: roundToInspect,
        suitChecked: suitType,
        violationFound,
        message,
        pointsAwardedTo,
        trickCards: trick.cards
      };

      broadcastState(roomCode);

      // Automatic Round Continuation
      if (gameState.revealResultTimeout) clearTimeout(gameState.revealResultTimeout);
      gameState.revealResultTimeout = setTimeout(() => {
        const state = rooms.get(roomCode);
        if (!state) return;
        state.revealResultTimeout = null;
        state.revealResult = null;
        
        // Reset for next round
        state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
        state.phase = 'BIDDING';
        state.turnIndex = (state.dealerIndex - 1 + state.players.length) % state.players.length;
        state.highestBid = 0;
        state.bidWinnerIndex = -1;
        state.history = [];
        state.tableCards = [];
        state.initialHands = {};
        state.roundNumber = 1;
        state.trumpSuit = null;
        
        state.players.forEach(p => {
          p.cards = [];
          p.tricks = 0;
        });

        const dealSuccess = dealCards(state);
        if (!dealSuccess) {
          console.error(`[Room ${roomCode}] Auto-deal failed after reveal.`);
        }

        if (state.team1Score >= state.pointLimit || state.team2Score >= state.pointLimit) {
          state.phase = 'GAME_OVER';
        }
        
        broadcastState(roomCode);
        if (state.phase === 'BIDDING') {
          startBiddingTimer(roomCode);
        }
      }, 6000);
    });

    socket.on("skipReveal", ({ roomCode }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || !gameState.revealResult) return;
      if (gameState.hostId !== socket.id) return; // Only host can skip

      clearRoomTimers(gameState);

      gameState.revealResult = null;
      
      // Reset for next round
      gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
      gameState.phase = 'BIDDING';
      gameState.turnIndex = (gameState.dealerIndex - 1 + gameState.players.length) % gameState.players.length;
      gameState.highestBid = 0;
      gameState.bidWinnerIndex = -1;
      gameState.history = [];
      gameState.tableCards = [];
      gameState.initialHands = {};
      gameState.roundNumber = 1;
      gameState.trumpSuit = null;
      
      gameState.players.forEach(p => {
        p.cards = [];
        p.tricks = 0;
      });

      const dealSuccess = dealCards(gameState);
      if (dealSuccess) {
        broadcastState(roomCode);
        startBiddingTimer(roomCode);
      } else {
        broadcastState(roomCode);
      }
    });

    // Chat Events
    socket.on("playerJoinedChat", ({ roomCode, playerName }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      const player = gameState.players.find(p => p.name === playerName);
      const seatLabel = player ? `P${player.seatId + 1}` : 'SYS';
      
      io.to(roomCode).emit("chatMessage", {
        id: Date.now() + Math.random().toString(),
        username: "SYSTEM",
        seat: "SYS",
        message: `${playerName} joined the chat.`,
        time: Date.now()
      });
    });

    socket.on("playerLeftChat", ({ roomCode, playerName }) => {
      io.to(roomCode).emit("chatMessage", {
        id: Date.now() + Math.random().toString(),
        username: "SYSTEM",
        seat: "SYS",
        message: `${playerName} left the chat.`,
        time: Date.now()
      });
    });

    socket.on("chatMessage", ({ roomCode, message, channel = 'global' }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      const player = gameState.players.find(p => p.id === socket.id);
      if (!player) return;

      if (gameState.mutes && gameState.mutes.includes(player.name)) return;

      // Basic rate limiting
      const now = Date.now();
      if (player.lastMessageTime && now - player.lastMessageTime < 1000) return;
      player.lastMessageTime = now;

      const sanitizedMessage = message.substring(0, 200).replace(/[<>]/g, "");
      const chatObj = {
        id: Date.now() + Math.random().toString(),
        username: player.name,
        seat: `P${player.seatId + 1}`,
        message: sanitizedMessage,
        time: Date.now(),
        channel
      };

      if (!gameState.messages) gameState.messages = [];
      gameState.messages.push(chatObj);
      if (gameState.messages.length > 50) gameState.messages.shift();

      if (channel === 'team') {
        const teamId = player.seatId % 2;
        gameState.players.forEach(p => {
          if (p.seatId % 2 === teamId) {
            io.to(p.id).emit("chatMessage", chatObj);
          }
        });
        if (gameState.isSandbox && socket.id !== gameState.hostId) {
          io.to(gameState.hostId).emit("chatMessage", chatObj);
        }
      } else {
        io.to(roomCode).emit("chatMessage", chatObj);
      }
    });

    socket.on("deleteChatMessage", ({ roomCode, messageId }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      const player = gameState.players.find(p => p.id === socket.id);
      if (!player) return;

      const messageIndex = gameState.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return;

      const message = gameState.messages[messageIndex];
      if (message.username !== player.name) return;

      gameState.messages.splice(messageIndex, 1);
      io.to(roomCode).emit("deleteChatMessage", messageId);
    });

    socket.on("typing", ({ roomCode, isTyping, channel = 'global' }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      const player = gameState.players.find(p => p.id === socket.id);
      if (!player) return;
      
      if (channel === 'team') {
        const teamId = player.seatId % 2;
        gameState.players.forEach(p => {
          if (p.seatId % 2 === teamId && p.id !== socket.id) {
            io.to(p.id).emit("typing", { seat: `P${player.seatId + 1}`, isTyping, channel });
          }
        });
        if (gameState.isSandbox && socket.id !== gameState.hostId) {
          io.to(gameState.hostId).emit("typing", { seat: `P${player.seatId + 1}`, isTyping, channel });
        }
      } else {
        socket.to(roomCode).emit("typing", {
          seat: `P${player.seatId + 1}`,
          isTyping,
          channel
        });
      }
    });

    socket.on("clearChat", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      gameState.messages = [];
      io.to(roomCode).emit("chatCleared");
      io.to(roomCode).emit("chatMessage", {
        id: Date.now() + Math.random().toString(),
        username: "SYSTEM",
        seat: "SYS",
        message: "Chat history cleared by host.",
        time: Date.now()
      });
    });

    socket.on("mutePlayer", ({ roomCode, targetName }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      if (!gameState.mutes) gameState.mutes = [];
      if (!gameState.mutes.includes(targetName)) {
        gameState.mutes.push(targetName);
      } else {
        gameState.mutes = gameState.mutes.filter(n => n !== targetName);
      }
      broadcastState(roomCode);
    });
  });

  // Raw source handler for ZIP export
  app.get("/src/*", (req, res, next) => {
    if (req.headers['x-raw-source'] === 'true') {
      const filePath = path.join(__dirname, req.path);
      return res.sendFile(filePath);
    }
    next();
  });

  app.get("/server.js", (req, res, next) => {
    if (req.headers['x-raw-source'] === 'true') {
      return res.sendFile(path.join(__dirname, "server.js"));
    }
    next();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
