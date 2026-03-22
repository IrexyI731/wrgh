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
  const rooms = new Map<string, any>();

  interface Card {
    suit: string;
    value: string;
    type: 'normal' | 'joker' | 'hidden';
    isBurned?: boolean;
    playedBy?: string;
    playerId?: string;
    isWeakestTrump?: boolean;
  }

  interface Player {
    id: string;
    name: string;
    cards: Card[];
    tricks: number;
    connected: boolean;
    seatId: number;
    isBot?: boolean;
    hasBothJokers?: boolean;
    playedRedJoker?: boolean;
    playedBlackJoker?: boolean;
    lastMessageTime?: number;
  }

  interface GameState {
    roomCode: string;
    isSandbox: boolean;
    hostId: string;
    players: Player[];
    team1Name: string;
    team2Name: string;
    pointLimit: number;
    bidTimerLimit: number;
    voteTimerLimit: number;
    startPointsTeam1: number;
    startPointsTeam2: number;
    tableCards: Card[];
    gameStarted: boolean;
    phase: string;
    turnIndex: number;
    dealerIndex: number;
    highestBid: number;
    bidWinnerIndex: number;
    trumpSuit: string | null;
    roundNumber: number;
    gameRoundNumber: number;
    trickWinnerId: string;
    history: any[];
    initialHands: Record<string, Card[]>;
    revealResult: any;
    team1Score: number;
    team2Score: number;
    jokerEnabled: boolean;
    lastRoundResult: any;
    contractTeamTricks: number;
    opposingTeamTricks: number;
    voting: any;
    messages: any[];
    mutes: string[];
    isPaused?: boolean;
    bidTimeLeft?: number;
    bidTimer?: NodeJS.Timeout | null;
    revealResultTimeout?: NodeJS.Timeout | null;
    trickTimeout?: NodeJS.Timeout | null;
    jokerBurnTimeout?: NodeJS.Timeout | null;
    bound?: any;
  }

  function createDeck(jokerEnabled = true): Card[] {
    const suits = ["♠", "♥", "♦", "♣"];
    const values: Record<string, string[]> = {
      "♠": ["6", "7", "8", "9", "10", "J", "Q", "K", "A"],
      "♥": ["6", "7", "8", "9", "10", "J", "Q", "K", "A"],
      "♦": ["7", "8", "9", "10", "J", "Q", "K", "A"],
      "♣": ["7", "8", "9", "10", "J", "Q", "K", "A"],
    };
    
    const deck: Card[] = [];
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

  function dealCards(gameState: GameState) {
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const deck = createDeck(true); 
      gameState.players.forEach(p => p.cards = []);
      
      for (let i = 0; i < deck.length; i++) {
        const playerIndex = i % gameState.players.length;
        gameState.players[playerIndex].cards.push(deck[i]);
      }
      
      const allHave9 = gameState.players.every(p => p.cards.length === 9);
      if (allHave9 && gameState.players.length === 4) {
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

  function evaluateTrick(cards: Card[], trumpSuit: string | null) {
    const leadCard = cards[0];
    const leadSuit = leadCard.type === 'joker' ? trumpSuit : leadCard.suit;
    const blackJokerLed = leadCard.type === 'joker' && leadCard.value === 'Black' && !leadCard.isBurned;

    const getCardPower = (card: Card) => {
      if (card.isBurned) return -1;

      if (card.type === 'joker') {
        if (card.value === 'Red') return 1000;
        if (card.value === 'Black') {
          if (card.isWeakestTrump) {
            return 99; // Weakest trump
          }
          if (blackJokerLed && card === leadCard) {
            // Lowest trump.
            // Trumps are 100 to 108. So lowest trump should be 99.
            return 99;
          }
          return 900; // Normal Black Joker is second highest
        }
      }

      const values = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
      const valuePower = values.indexOf(card.value);

      if (card.suit === trumpSuit) {
        return 100 + valuePower;
      }

      if (card.suit === leadSuit) {
        return 50 + valuePower;
      }

      return valuePower;
    };

    const sorted = [...cards].sort((a, b) => getCardPower(b) - getCardPower(a));
    return sorted[0];
  }

  function canPlayCard(gameState: GameState, player: Player, cardIndex: number) {
    if (gameState.phase !== 'PLAYING') return { valid: false, message: "Not playing phase" };
    if (gameState.isPaused) return { valid: false, message: "Game is paused" };
    return { valid: true };
  }

  function validateJokerRules(gameState: GameState, player: Player, card: Card, isLeading: boolean) {
    let isBurned = false;
    let burnReason = "";
    let isWeakestTrump = false;

    if (card.type !== 'joker') return { isBurned, burnReason, isWeakestTrump };

    const isBidWinner = gameState.bidWinnerIndex === gameState.players.findIndex(p => p.id === player.id);
    const bid = gameState.highestBid;
    const round = gameState.roundNumber;
    const hasBothJokers = player.hasBothJokers;
    const blackJokerPlayed = gameState.history.some(trick => 
      trick.cards.some((c: any) => c.type === 'joker' && c.value === 'Black' && !c.isBurned)
    ) || gameState.tableCards.some(c => c.type === 'joker' && c.value === 'Black' && !c.isBurned);

    if (card.value === 'Black') {
      isWeakestTrump = hasBothJokers && bid >= 7 && isBidWinner && player.playedRedJoker;

      // Black Joker can be played ONLY until the end of Round 3, unless it's the weakest trump.
      if (round >= 4 && !isWeakestTrump) {
        isBurned = true;
        burnReason = `Black Joker Burned by ${player.name} (Played in Round ${round})`;
        return { isBurned, burnReason, isWeakestTrump };
      }

      if (isLeading && !isWeakestTrump) {
        if (bid >= 7 && isBidWinner && hasBothJokers) {
          // Allowed to lead Black Joker
        } else {
          isBurned = true;
          burnReason = `Black Joker Burned by ${player.name} (Illegal Lead)`;
        }
      }
    } else if (card.value === 'Red') {
      // Red Joker Global Rules
      if (isLeading) {
        isBurned = true;
        burnReason = `Red Joker Burned by ${player.name} (Red Joker can NEVER lead)`;
        return { isBurned, burnReason, isWeakestTrump };
      }

      if (hasBothJokers) {
        if (bid >= 7 && isBidWinner) {
          // Allowed to play Red Joker BEFORE Black Joker
        } else {
          // Other players with both jokers, or bid <= 6
          if (!player.playedBlackJoker) {
            isBurned = true;
            burnReason = `Red Joker Burned by ${player.name} (Played before Black Joker)`;
          }
        }
      } else {
        // Player only has Red Joker
        if (!blackJokerPlayed) {
          isBurned = true;
          burnReason = `Red Joker Burned by ${player.name} (Played before Black Joker was played)`;
        }
      }
    }

    return { isBurned, burnReason, isWeakestTrump };
  }

  function handleBurn(gameState: GameState, playerIndex: number, card: Card, burnReason: string) {
    gameState.phase = 'ROUND_OVER';
    gameState.tableCards = []; 
    
    const playingTeam = (playerIndex % 2 === 0) ? 1 : 2;
    const opposingTeam = playingTeam === 1 ? 2 : 1;
    
    // Opponent team receives +15 points
    let team1RoundScore = opposingTeam === 1 ? 15 : 0;
    let team2RoundScore = opposingTeam === 2 ? 15 : 0;
    
    gameState.team1Score += team1RoundScore;
    gameState.team2Score += team2RoundScore;
    
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

    return "JOKER_BURN";
  }

  function handleBlackJokerPenalty(gameState: GameState, playerIndex: number, card: Card) {
    // This is handled inside handleBurn, but we can keep it as a wrapper if needed
    return handleBurn(gameState, playerIndex, card, `Black Joker Penalty: Played in Round ${gameState.roundNumber} by ${gameState.players[playerIndex].name}`);
  }

  function processBid(gameState: GameState, playerIndex: number, bid: number) {
    const player = gameState.players[playerIndex];

    if (gameState.phase === 'DEALER_FORCED_BID') {
      // Dealer is forced to bid at least 5 (matching UI options)
      const actualBid = bid < 5 ? 5 : bid;
      gameState.highestBid = actualBid;
      gameState.bidWinnerIndex = gameState.dealerIndex;
      gameState.phase = 'TRUMP_SELECTION';
      gameState.turnIndex = gameState.bidWinnerIndex;

      io.to(gameState.roomCode).emit("chatMessage", {
        id: Date.now() + Math.random().toString(),
        username: "SYSTEM",
        seat: "SYS",
        message: `📢 ${player.name} won the bid with ${actualBid}.`,
        time: Date.now()
      });
    } else {
      if (bid !== 0 && bid > gameState.highestBid) {
        gameState.highestBid = bid;
        gameState.bidWinnerIndex = gameState.turnIndex;
      }

      if (bid === 8) {
        gameState.phase = 'TRUMP_SELECTION';
        gameState.turnIndex = gameState.bidWinnerIndex;
        
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
        
        io.to(gameState.roomCode).emit("chatMessage", {
          id: Date.now() + Math.random().toString(),
          username: "SYSTEM",
          seat: "SYS",
          message: `📢 ${gameState.players[gameState.bidWinnerIndex].name} won the bid with ${gameState.highestBid}.`,
          time: Date.now()
        });
      } else if (gameState.turnIndex === gameState.dealerIndex && gameState.highestBid === 0) {
        // If it reaches the dealer and everyone else passed, force the dealer to bid
        gameState.phase = 'DEALER_FORCED_BID';
        io.to(gameState.roomCode).emit("chatMessage", {
          id: Date.now() + Math.random().toString(),
          username: "SYSTEM",
          seat: "SYS",
          message: `📢 Everyone passed! Dealer ${gameState.players[gameState.dealerIndex].name} must bid.`,
          time: Date.now()
        });
      }
    }
  }

  function processTrumpSelection(gameState: GameState, suit: string) {
    gameState.trumpSuit = suit;
    gameState.phase = 'PLAYING';
    gameState.roundNumber = 1;
    gameState.turnIndex = (gameState.bidWinnerIndex - 1 + gameState.players.length) % gameState.players.length;
  }

  function processCardPlay(gameState: GameState, playerIndex: number, cardIndex: number) {
    const player = gameState.players[playerIndex];
    const card = player.cards[cardIndex];
    const isLeading = gameState.tableCards.length === 0;

    const { isBurned, burnReason, isWeakestTrump } = validateJokerRules(gameState, player, card, isLeading);

    if (card.type === 'joker') {
      if (card.value === 'Red') player.playedRedJoker = true;
      if (card.value === 'Black') player.playedBlackJoker = true;
    }

    player.cards.splice(cardIndex, 1);
    gameState.tableCards.push({ ...card, playedBy: player.name, playerId: player.id, isBurned, isWeakestTrump });

    if (isBurned) {
      return handleBurn(gameState, playerIndex, card, burnReason);
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
      
      return true; 
    }
    return false;
  }

  function clearRoomTimers(gameState: GameState) {
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

  function getPublicState(gameState: GameState, socketId: string) {
    if (!gameState) return null;
    
    const publicPlayers = (gameState.players || []).map(p => {
      const isMe = p.id === socketId || (gameState.isSandbox && socketId === gameState.hostId && p.isBot);
      return {
        ...p,
        cards: isMe ? p.cards : (p.cards || []).map(() => ({ suit: 'hidden', value: 'hidden', type: 'hidden' }))
      };
    });

    // Safely clone the state and remove non-serializable or sensitive fields
    const { 
      history, 
      initialHands, 
      bidTimer, 
      revealResultTimeout, 
      trickTimeout, 
      jokerBurnTimeout, 
      ...publicState 
    } = gameState;
    
    // Create a new object to avoid any potential circular references or hidden properties
    const sanitizedState: any = {
      ...publicState,
      players: publicPlayers,
      history: (history || []).map(h => ({ ...h })), // Shallow copy history
      bidTimeLeft: gameState.bidTimeLeft,
      messages: (gameState.messages || []).slice(-50) // Only send last 50 messages
    };

    if (sanitizedState.voting) {
      const { timer, ...rest } = sanitizedState.voting;
      sanitizedState.voting = rest;
    }

    return sanitizedState;
  }

  function broadcastState(roomCode: string) {
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

  function startNextRound(roomCode: string) {
    const gameState = rooms.get(roomCode);
    if (!gameState || gameState.phase !== 'ROUND_OVER') return;
    
    gameState.phase = 'BIDDING';
    gameState.roundNumber = 1;
    gameState.highestBid = 0;
    gameState.bidWinnerIndex = -1;
    gameState.trumpSuit = null;
    gameState.tableCards = [];
    gameState.history = [];
    gameState.initialHands = {};
    gameState.revealResult = null;
    gameState.contractTeamTricks = 0;
    gameState.opposingTeamTricks = 0;
    gameState.voting = null;
    gameState.bound = null;
    gameState.turnIndex = (gameState.dealerIndex - 1 + 4) % 4;
    
    dealCards(gameState);
    startBiddingTimer(roomCode);
    broadcastState(roomCode);
  }

  function startBiddingTimer(roomCode: string) {
    const gameState = rooms.get(roomCode);
    if (!gameState) return;

    if (gameState.bidTimer) {
      clearInterval(gameState.bidTimer);
    }

    gameState.bidTimeLeft = gameState.bidTimerLimit || 30;
    broadcastState(roomCode); 
    
    gameState.bidTimer = setInterval(() => {
      const state = rooms.get(roomCode);
      if (!state || (state.phase !== 'BIDDING' && state.phase !== 'DEALER_FORCED_BID')) {
        if (state && state.bidTimer) {
          clearInterval(state.bidTimer);
          state.bidTimer = null;
        }
        return;
      }

      state.bidTimeLeft!--;
      
      if (state.bidTimeLeft! <= 0) {
        clearInterval(state.bidTimer!);
        state.bidTimer = null;
        
        // If it's a forced bid for the dealer, auto-bid 5.
        if (state.phase === 'DEALER_FORCED_BID') {
          processBid(state, state.turnIndex, 5);
          broadcastState(roomCode);
          return;
        }
        
        processBid(state, state.turnIndex, 0);
        broadcastState(roomCode);
        
        if (state.phase === 'BIDDING' || state.phase === 'DEALER_FORCED_BID') {
          startBiddingTimer(roomCode);
        }
      } else {
        broadcastState(roomCode);
      }
    }, 1000);
  }

  function resolveVote(roomCode: string) {
    const gameState = rooms.get(roomCode);
    if (!gameState || !gameState.voting) return;

    if (gameState.voting.timer) {
      clearInterval(gameState.voting.timer);
    }

    if (gameState.voting.closeVotes > gameState.voting.continueVotes) {
      gameState.phase = 'ROUND_OVER';
      gameState.tableCards = [];
      
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
      } else {
        // Rotate dealer for the next round
        gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;
        setTimeout(() => {
          startNextRound(roomCode);
        }, 8000);
      }
      gameState.voting = null;
    } else {
      gameState.phase = 'PLAYING';
      gameState.voting = null;
    }
    broadcastState(roomCode);
  }

  function startVoteTimer(roomCode: string) {
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

  function checkBoundCondition(gameState: GameState) {
    if (gameState.highestBid < 7 || gameState.bound) return;

    const biddingTeam = (gameState.bidWinnerIndex % 2 === 0) ? 1 : 2;
    const team1Tricks = gameState.players[0].tricks + gameState.players[2].tricks;
    const team2Tricks = gameState.players[1].tricks + gameState.players[3].tricks;
    const contractTeamTricks = biddingTeam === 1 ? team1Tricks : team2Tricks;
    
    const cardsPlayed = 9 - gameState.players[0].cards.length;
    
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

  io.on("connection", (socket) => {
    // Host a new game
    socket.on("hostGame", (data) => {
      const playerName = typeof data === 'string' ? data : data.playerName;
      const isSandbox = typeof data === 'object' ? data.isSandbox : false;
      const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      socket.join(roomCode);
      
      const players: Player[] = [{ id: socket.id, name: playerName, cards: [], tricks: 0, connected: true, seatId: 0 }];
      if (isSandbox) {
        players.push({ id: 'bot1', name: 'Bot 1', cards: [], tricks: 0, connected: true, isBot: true, seatId: 1 });
        players.push({ id: 'bot2', name: 'Bot 2', cards: [], tricks: 0, connected: true, isBot: true, seatId: 2 });
        players.push({ id: 'bot3', name: 'Bot 3', cards: [], tricks: 0, connected: true, isBot: true, seatId: 3 });
      }

      const gameState: GameState = {
        roomCode,
        isSandbox,
        hostId: socket.id,
        players,
        team1Name: "Team 1",
        team2Name: "Team 2",
        pointLimit: 56,
        bidTimerLimit: 30,
        voteTimerLimit: 20,
        startPointsTeam1: 0,
        startPointsTeam2: 0,
        tableCards: [],
        gameStarted: false,
        phase: 'WAITING',
        turnIndex: 0,
        dealerIndex: 0,
        highestBid: 0,
        bidWinnerIndex: -1,
        trumpSuit: null,
        roundNumber: 1,
        gameRoundNumber: 1,
        trickWinnerId: '',
        history: [],
        initialHands: {},
        revealResult: null,
        team1Score: 0,
        team2Score: 0,
        jokerEnabled: true,
        lastRoundResult: null,
        contractTeamTricks: 0,
        opposingTeamTricks: 0,
        voting: null,
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
      const player = gameState.players.find((p: Player) => p.name === playerName);
      if (!player) {
        socket.emit("error", "Player not found in this room.");
        return;
      }
      
      player.id = socket.id;
      player.connected = true;
      socket.join(roomCode);
      socket.emit("playerJoined", getPublicState(gameState, socket.id));
      
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
      const takenSeatIds = (gameState.players || []).map(p => p.seatId);
      let seatId = 0;
      while (takenSeatIds.includes(seatId) && seatId < 4) {
        seatId++;
      }
      if (seatId >= 4) {
        socket.emit("error", "Cannot join room. It might be full.");
        return;
      }
      gameState.players.push({ id: socket.id, name: playerName, cards: [], tricks: 0, connected: true, seatId });
      socket.emit("playerJoined", getPublicState(gameState, socket.id));
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
      
      if (newPlayers.length === gameState.players.length) {
        gameState.players = newPlayers;
        broadcastState(roomCode);
      }
    });

    // Handle Voting (Now Host Decision)
    socket.on("castVote", ({ roomCode, vote }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'VOTING' || !gameState.voting) return;
      
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
      if (settings.team1Score !== undefined) {
        gameState.team1Score = settings.team1Score;
        gameState.startPointsTeam1 = settings.team1Score;
      }
      if (settings.team2Score !== undefined) {
        gameState.team2Score = settings.team2Score;
        gameState.startPointsTeam2 = settings.team2Score;
      }
      
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

    // Host Power: Transfer Host
    socket.on("transferHost", ({ roomCode, newHostId }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      const newHost = gameState.players.find(p => p.id === newHostId);
      if (newHost && newHost.connected && !newHost.isBot) {
        gameState.hostId = newHostId;
        broadcastState(roomCode);
      }
    });

    // Host Power: Fill with Bots
    socket.on("fillWithBots", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || gameState.gameStarted) return;
      
      const currentPlayers = gameState.players.length;
      if (currentPlayers >= 4) return;

      let botCount = 1;
      while (gameState.players.length < 4) {
        const botId = `bot${Date.now()}_${botCount}`;
        gameState.players.push({
          id: botId,
          name: `Bot ${botCount}`,
          cards: [],
          tricks: 0,
          connected: true,
          isBot: true,
          seatId: gameState.players.length
        });
        botCount++;
      }
      gameState.isSandbox = true; // Enable sandbox mode so host can control bots
      broadcastState(roomCode);
    });

    // Host Power: Remove Bots
    socket.on("removeBots", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || gameState.gameStarted) return;
      
      gameState.players = gameState.players.filter(p => !p.isBot);
      
      // Re-assign seat IDs
      gameState.players.forEach((p, index) => {
        p.seatId = index;
      });
      
      if (gameState.players.length < 4) {
        gameState.isSandbox = false;
      }
      broadcastState(roomCode);
    });

    // Handle Leave Room
    socket.on("leaveRoom", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (gameState) {
        const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
        socket.leave(roomCode);
        if (playerIndex !== -1) {
          gameState.players[playerIndex].connected = false;
          broadcastState(roomCode);
        }
      }
    });

    // Handle Disconnect
    socket.on("disconnect", () => {
      rooms.forEach((gameState, roomCode) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
          player.connected = false;
          if (!gameState.messages) gameState.messages = [];
          gameState.messages.push({
            id: Date.now() + Math.random().toString(),
            username: 'SYSTEM',
            seat: 'SYS',
            color: '#ff4444',
            message: `${player.name} (P${player.seatId + 1}) disconnected.`,
            time: Date.now(),
            channel: 'all'
          });
          broadcastState(roomCode);
        }
      });
    });

    // Start the game
    socket.on("startGame", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id || gameState.players.length < 4) return;
      
      gameState.gameStarted = true;
      gameState.phase = 'BIDDING';
      gameState.roundNumber = 1;
      gameState.gameRoundNumber = 1;
      gameState.team1Score = gameState.startPointsTeam1 || 0;
      gameState.team2Score = gameState.startPointsTeam2 || 0;
      gameState.dealerIndex = Math.floor(Math.random() * 4);
      gameState.turnIndex = (gameState.dealerIndex - 1 + 4) % 4;
      gameState.highestBid = 0;
      gameState.bidWinnerIndex = -1;
      gameState.trumpSuit = null;
      gameState.history = [];
      gameState.initialHands = {};
      gameState.revealResult = null;
      gameState.contractTeamTricks = 0;
      gameState.opposingTeamTricks = 0;
      gameState.voting = null;
      gameState.bound = null;
      gameState.messages = [];
      gameState.mutes = [];

      dealCards(gameState);
      
      startBiddingTimer(roomCode);
      broadcastState(roomCode);
    });

    socket.on("nextRound", (roomCode) => {
      startNextRound(roomCode);
    });

    // Handle Bidding
    socket.on("placeBid", ({ roomCode, bid }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || (gameState.phase !== 'BIDDING' && gameState.phase !== 'DEALER_FORCED_BID')) return;
      
      const isHostInSandbox = gameState.isSandbox && socket.id === gameState.hostId;
      let playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      
      if (isHostInSandbox) {
        // In sandbox mode, the host can act for the current turn's player
        playerIndex = gameState.turnIndex;
      }

      if (playerIndex === -1 || playerIndex !== gameState.turnIndex) return;

      processBid(gameState, playerIndex, bid);
      
      // Reset timer for the next player if we're still in a bidding phase
      if (gameState.phase === 'BIDDING' || gameState.phase === 'DEALER_FORCED_BID') {
        startBiddingTimer(roomCode);
      } else {
        // If bidding finished, clear the timer
        if (gameState.bidTimer) {
          clearInterval(gameState.bidTimer);
          gameState.bidTimer = null;
        }
      }
      
      broadcastState(roomCode);
    });

    // Handle Trump Selection
    socket.on("selectTrump", ({ roomCode, suit }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'TRUMP_SELECTION') return;
      
      let playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      const isHostInSandbox = gameState.isSandbox && socket.id === gameState.hostId;

      if (isHostInSandbox) {
        playerIndex = gameState.bidWinnerIndex;
      }

      if (playerIndex !== gameState.bidWinnerIndex) return;

      processTrumpSelection(gameState, suit);
      broadcastState(roomCode);
    });

    // Handle Card Play
    socket.on("playCard", ({ roomCode, cardIndex }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.phase !== 'PLAYING' || gameState.isPaused) return;
      
      let playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      const isHostInSandbox = gameState.isSandbox && socket.id === gameState.hostId;

      if (isHostInSandbox) {
        playerIndex = gameState.turnIndex;
      }

      if (playerIndex !== gameState.turnIndex) return;

      const player = gameState.players[playerIndex];
      const validation = canPlayCard(gameState, player, cardIndex);
      if (!validation.valid) {
        socket.emit("error", { message: validation.message });
        return;
      }

      const result = processCardPlay(gameState, playerIndex, cardIndex);
      broadcastState(roomCode);

      if (result === "JOKER_BURN") {
        if (gameState.phase === 'ROUND_OVER') {
          setTimeout(() => {
            startNextRound(roomCode);
          }, 8000);
        }
      } else if (result === true) {
        // Trick is over
        setTimeout(() => {
          const state = rooms.get(roomCode);
          if (!state || state.phase !== 'PLAYING') return;
          
          state.tableCards = [];
          state.roundNumber++;
          
          // Check if round is over
          if (state.players[0].cards.length === 0) {
            state.phase = 'ROUND_OVER';
            
            const team1Tricks = state.players[0].tricks + state.players[2].tricks;
            const team2Tricks = state.players[1].tricks + state.players[3].tricks;
            const biddingTeam = (state.bidWinnerIndex % 2 === 0) ? 1 : 2;
            
            let team1RoundScore = 0;
            let team2RoundScore = 0;
            
            // Basic scoring logic
            if (biddingTeam === 1) {
              if (team1Tricks >= state.highestBid) {
                team1RoundScore = team1Tricks;
              } else {
                team1RoundScore = 0;
                team2RoundScore = state.highestBid;
              }
            } else {
              if (team2Tricks >= state.highestBid) {
                team2RoundScore = team2Tricks;
              } else {
                team2RoundScore = 0;
                team1RoundScore = state.highestBid;
              }
            }
            
            state.team1Score += team1RoundScore;
            state.team2Score += team2RoundScore;
            state.gameRoundNumber++;
            
            state.lastRoundResult = {
              team1Tricks, team2Tricks, biddingTeam,
              highestBid: state.highestBid,
              team1RoundScore, team2RoundScore
            };

            if (state.team1Score >= state.pointLimit || state.team2Score >= state.pointLimit) {
              state.phase = 'GAME_OVER';
            } else {
              // Rotate dealer for the next round
              state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
              setTimeout(() => {
                startNextRound(roomCode);
              }, 8000);
            }
          }
          broadcastState(roomCode);
        }, 2000);
      }
    });

    // Chat System
    socket.on("chatMessage", ({ roomCode, message, channel }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      if (playerIndex === -1) return;
      const player = gameState.players[playerIndex];

      // Check if muted
      if (gameState.mutes.includes(player.id)) return;

      const chatObj = {
        id: Date.now() + Math.random().toString(),
        username: player.name,
        seat: `P${player.seatId + 1}`,
        message: message.substring(0, 200),
        time: Date.now(),
        channel: channel || 'global'
      };

      if (!gameState.messages) gameState.messages = [];
      gameState.messages.push(chatObj);

      // Keep only last 50 messages
      if (gameState.messages.length > 50) {
        gameState.messages.shift();
      }

      if (channel === 'team') {
        const teamIndices = (playerIndex % 2 === 0) ? [0, 2] : [1, 3];
        teamIndices.forEach(idx => {
          const p = gameState.players[idx];
          if (p && p.id) {
            io.to(p.id).emit("chatMessage", chatObj);
          }
        });
      } else {
        io.to(roomCode).emit("chatMessage", chatObj);
      }

      broadcastState(roomCode);
    });

    socket.on("playerJoinedChat", ({ roomCode, playerName }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;

      // Send existing messages to the player who just joined
      if (gameState.messages && gameState.messages.length > 0) {
        const player = gameState.players.find(p => p.id === socket.id);
        const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
        
        gameState.messages.forEach(msg => {
          if (msg.channel === 'team') {
            if (playerIndex !== -1) {
              const msgSenderIndex = gameState.players.findIndex(p => p.name === msg.username);
              if (msgSenderIndex !== -1 && (msgSenderIndex % 2 === playerIndex % 2)) {
                socket.emit("chatMessage", msg);
              }
            }
          } else {
            socket.emit("chatMessage", msg);
          }
        });
      }
    });

    socket.on("typing", ({ roomCode, isTyping, channel }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      if (playerIndex === -1) return;
      const player = gameState.players[playerIndex];

      const typingObj = {
        seat: `P${player.seatId + 1}`,
        isTyping,
        channel: channel || 'global'
      };

      if (channel === 'team') {
        const teamIndices = (playerIndex % 2 === 0) ? [0, 2] : [1, 3];
        teamIndices.forEach(idx => {
          const p = gameState.players[idx];
          if (p && p.id && p.id !== socket.id) {
            io.to(p.id).emit("typing", typingObj);
          }
        });
      } else {
        socket.to(roomCode).emit("typing", typingObj);
      }
    });

    socket.on("playerLeftChat", ({ roomCode, playerName }) => {
      // Optional: Log or handle player leaving chat
    });

    socket.on("deleteChatMessage", ({ roomCode, messageId }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;
      
      if (gameState.messages) {
        gameState.messages = gameState.messages.filter(m => m.id !== messageId);
      }
      
      io.to(roomCode).emit("deleteChatMessage", messageId);
      broadcastState(roomCode);
    });

    // Host Power: Mute Player
    socket.on("mutePlayer", ({ roomCode, playerId }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      if (gameState.mutes.includes(playerId)) {
        gameState.mutes = gameState.mutes.filter(id => id !== playerId);
      } else {
        gameState.mutes.push(playerId);
      }
      broadcastState(roomCode);
    });

    // Host Power: Clear Chat
    socket.on("clearChat", (roomCode) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      gameState.messages = [];
      io.to(roomCode).emit("chatCleared");
      broadcastState(roomCode);
    });

    socket.on("revealChallenge", ({ roomCode, targetPlayerId, roundToInspect, suitType }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState) return;

      const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
      if (!targetPlayer) return;

      // Find the trick for the round to inspect
      const trick = gameState.history.find(h => h.round === roundToInspect);
      if (!trick) return;

      // Find the card the target player played in that trick
      const playedCard = trick.cards.find(c => c.playerId === targetPlayerId);
      if (!playedCard) return;

      // The lead suit of that trick
      const leadCard = trick.cards[0];
      const leadSuit = leadCard.type === 'joker' ? gameState.trumpSuit : leadCard.suit;

      // To check for violation, we need to know what they had in their hand AT THAT TIME
      const initialHand = gameState.initialHands[targetPlayerId] || [];
      const cardsPlayedBefore = (gameState.history || [])
        .filter(h => h && h.round < roundToInspect)
        .map(h => h.cards?.find((c: any) => c && c.playerId === targetPlayerId))
        .filter(c => c !== undefined);
      
      const currentHandAtRoundStart = [...initialHand];
      cardsPlayedBefore.forEach(played => {
        if (!played) return;
        const idx = currentHandAtRoundStart.findIndex(c => c && c.suit === played.suit && c.value === played.value);
        if (idx !== -1) currentHandAtRoundStart.splice(idx, 1);
      });

      // Check if they had the suit they were supposed to follow
      const hadLeadSuit = currentHandAtRoundStart.some(c => {
        const cSuit = c.type === 'joker' ? gameState.trumpSuit : c.suit;
        return cSuit === leadSuit;
      });

      // Check if they had the specific suit the user is checking for
      const targetSuit = suitType === 'Trump' ? gameState.trumpSuit : suitType;
      const hadTargetSuit = currentHandAtRoundStart.some(c => {
        const cSuit = c.type === 'joker' ? gameState.trumpSuit : c.suit;
        return cSuit === targetSuit;
      });

      const playedCardSuit = playedCard.type === 'joker' ? gameState.trumpSuit : playedCard.suit;
      const followedSuit = playedCardSuit === leadSuit;

      // A violation occurs if they had the lead suit but played something else (even trump)
      const violationFound = hadLeadSuit && !followedSuit;
      
      let message = "";
      if (violationFound) {
        message = `${targetPlayer.name} was caught! They had ${leadSuit} in Round ${roundToInspect} but played ${playedCard.suit || playedCard.type} instead.`;
      } else {
        if (hadTargetSuit) {
          message = `${targetPlayer.name} is clean. They did have ${suitType} in Round ${roundToInspect}, but they played correctly.`;
        } else {
          message = `${targetPlayer.name} is clean. They didn't even have ${suitType} in Round ${roundToInspect}!`;
        }
      }

      gameState.revealResult = {
        target: targetPlayer.name,
        targetId: targetPlayer.id,
        round: roundToInspect,
        suit: suitType,
        violationFound,
        message,
        challenger: gameState.players.find(p => p.id === socket.id)?.name || 'Someone',
        trickCards: trick.cards,
        pointsAwardedTo: violationFound ? (gameState.players.findIndex(p => p.id === socket.id) % 2 === 0 ? 1 : 2) : (gameState.players.findIndex(p => p.id === targetPlayerId) % 2 === 0 ? 1 : 2)
      };

      if (violationFound) {
        // Award 15 points to challenger's team
        const challengerIndex = gameState.players.findIndex(p => p.id === socket.id);
        if (challengerIndex % 2 === 0) {
          gameState.team1Score += 15;
        } else {
          gameState.team2Score += 15;
        }
      } else {
        // Award 15 points to target's team
        const targetIndex = gameState.players.findIndex(p => p.id === targetPlayerId);
        if (targetIndex % 2 === 0) {
          gameState.team1Score += 15;
        } else {
          gameState.team2Score += 15;
        }
      }

      // Clear result after 10 seconds
      if (gameState.revealResultTimeout) clearTimeout(gameState.revealResultTimeout);
      gameState.revealResultTimeout = setTimeout(() => {
        const state = rooms.get(roomCode);
        if (state) {
          state.revealResult = null;
          broadcastState(roomCode);
        }
      }, 10000);

      broadcastState(roomCode);
    });

    socket.on("skipReveal", ({ roomCode }) => {
      const gameState = rooms.get(roomCode);
      if (!gameState || gameState.hostId !== socket.id) return;
      
      if (gameState.revealResultTimeout) {
        clearTimeout(gameState.revealResultTimeout);
        gameState.revealResultTimeout = null;
      }
      gameState.revealResult = null;
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

  app.get("/server.ts", (req, res, next) => {
    if (req.headers['x-raw-source'] === 'true') {
      return res.sendFile(path.join(__dirname, "server.ts"));
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
