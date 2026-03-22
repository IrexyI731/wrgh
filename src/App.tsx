import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Users, Play, Plus, LogIn, Trophy, Info, ChevronRight, ChevronLeft, Ghost, Zap, Sparkles, GripVertical, Pause, PlayCircle, Settings, X, Spade, Heart, Diamond, Club, Crown, Eye, Flame, ShieldAlert, AlertTriangle, ShieldCheck, Maximize, LogOut, LayoutGrid, RefreshCw, Shield, Volume2, VolumeX, MessageSquare, Send, FastForward, Trash2, UserMinus } from 'lucide-react';
import { playProceduralSound } from './services/audioEngine.js';
import Chat from './components/Chat.tsx';

interface Card {
  suit: string;
  value: string;
  type: 'normal' | 'joker';
  playedBy?: string;
  playerId?: string;
  isBurned?: boolean;
  isWeakestTrump?: boolean;
}

interface Player {
  id: string;
  name: string;
  cards: Card[];
  tricks: number;
  connected?: boolean;
  seatId: number;
}

interface GameState {
  roomCode: string;
  hostId: string;
  players: Player[];
  team1Name: string;
  team2Name: string;
  pointLimit: number;
  tableCards: Card[];
  gameStarted: boolean;
  phase: 'WAITING' | 'BIDDING' | 'DEALER_FORCED_BID' | 'TRUMP_SELECTION' | 'PLAYING' | 'ROUND_OVER' | 'GAME_OVER' | 'VOTING';
  turnIndex: number;
  dealerIndex: number;
  highestBid: number;
  bidWinnerIndex: number;
  trumpSuit: string;
  roundNumber: number;
  gameRoundNumber: number;
  history: any[];
  initialHands: Record<string, Card[]>;
  revealResult: {
    challenger: string;
    target: string;
    round: number;
    violationFound: boolean;
    message: string;
    trickCards: Card[];
  } | null;
  team1Score: number;
  team2Score: number;
  isPaused?: boolean;
  messages: {
    sender: string;
    text: string;
    timestamp: number;
    seat?: number;
    color?: string;
    isSystem?: boolean;
  }[];
  typingPlayers?: string[];
  mutes?: string[];
  bound?: {
    offeredTo: string;
    status: 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'VOTING';
    choice: 'YES' | 'NO' | null;
    lostTrick?: boolean;
  } | null;
  voting?: {
    continueVotes: number;
    closeVotes: number;
    playersVoted: string[];
    timeLeft?: number;
  } | null;
  lastRoundResult?: {
    team1Tricks: number;
    team2Tricks: number;
    biddingTeam: number;
    highestBid: number;
    team1RoundScore: number;
    team2RoundScore: number;
    reason?: string;
  };
  bidTimeLeft?: number;
  bidTimerLimit?: number;
  voteTimerLimit?: number;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const [localCards, setLocalCards] = useState<Card[]>([]);
  const [showRevealMenu, setShowRevealMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [prevGameState, setPrevGameState] = useState<GameState | null>(null);
  const [chatBubbles, setChatBubbles] = useState<Record<string, { text: string; timestamp: number; channel?: string }>>({});

  const handleChatMessage = useCallback((msg: any) => {
    if (msg.seat && msg.seat !== 'SYS') {
      setChatBubbles(prev => ({
        ...prev,
        [msg.seat]: { text: msg.message, timestamp: Date.now(), channel: msg.channel }
      }));
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChatBubbles(prev => {
        const next = { ...prev };
        let changed = false;
        for (const seat in next) {
          if (now - next[seat].timestamp > 5000) {
            delete next[seat];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const AnimatedButton = ({ children, className, onClick, ...props }: any) => (
    <motion.button
      whileHover={{ scale: 1.05, boxShadow: "0 0 15px rgba(255,255,255,0.2)" }}
      whileTap={{ scale: 0.95, opacity: 0.8 }}
      onClick={onClick}
      className={className}
      {...props}
    >
      {children}
    </motion.button>
  );

  const BASE_STYLE = "high quality, short duration, soft dynamics, no distortion, clean audio, cozy atmosphere";

  const SOUND_PROMPTS = {
    card: `soft cozy card tap, paper texture, warm, minimal, ${BASE_STYLE}`,
    turn: `soft UI tick, light wooden click, minimal, ${BASE_STYLE}`,
    winTrick: `soft warm chime, gentle bell, smooth, ${BASE_STYLE}`,
    bound: `smooth rising tone, soft whoosh, cozy premium feel, ${BASE_STYLE}`,
    reverseBound: `soft low drop tone, muted, calm, ${BASE_STYLE}`,
    voting: `soft UI pop, clean click, minimal, ${BASE_STYLE}`,
    gameWin: `short cozy melody, warm, relaxing, ${BASE_STYLE}`,
    gameLoss: `gentle low tone, soft fade, calm, ${BASE_STYLE}`
  };

  const GUI_SOUNDS = {
    hover: "soft UI hover tick, light, minimal, cozy, very subtle",
    click: "soft button click, muted, clean, cozy UI sound, short",
    openMenu: "soft whoosh, smooth UI transition, cozy, light and calm",
    closeMenu: "gentle reverse whoosh, soft, minimal, cozy",
    switchTab: "soft slide click, minimal, clean UI feedback, cozy",
    toggleOn: "soft tick up, light positive tone, cozy",
    toggleOff: "soft tick down, muted, calm, cozy",
    notification: "soft pop, light bubble sound, friendly cozy UI",
    error: "soft low tone, muted, calm warning, not harsh",
    success: "soft chime, warm, positive, cozy feedback",
    message: "soft notification chime, light bubble sound, friendly cozy UI",
    slider: "soft drag sound, smooth, minimal, subtle texture",
    back: "soft click + light whoosh, cozy transition",
    select: "soft confirm click, warm, minimal, clean"
  };

  const playSound = (type: string) => {
    if (soundEnabled) playProceduralSound(type);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };
  const [revealTargetId, setRevealTargetId] = useState('');
  const [revealRound, setRevealRound] = useState(1);
  const [revealSuit, setRevealSuit] = useState<string>('♥');
  const [sandboxPlayerId, setSandboxPlayerId] = useState<string | null>(null);

  const activePlayerId = (gameState as any)?.isSandbox && socket?.id === gameState?.hostId ? (sandboxPlayerId || socket?.id) : socket?.id;

  useEffect(() => {
    if (gameState && gameState.players) {
      console.log("Players and seatIds:", (gameState.players || []).map(p => ({ name: p.name, seatId: p.seatId })));
      const myPlayer = (gameState.players || []).find(p => p.id === activePlayerId);
      console.log("MyPlayer:", myPlayer);
    }
    if (gameState && gameState.players && socket) {
      const myPlayer = (gameState.players || []).find(p => p.id === activePlayerId);
      if (myPlayer && myPlayer.cards) {
        // Only update localCards if the length changed (e.g. a card was played)
        // or if the cards are completely different.
        // This prevents the hand from resetting while dragging.
        if (localCards.length !== myPlayer.cards.length) {
          setLocalCards(myPlayer.cards);
        } else {
          // Check if the actual cards changed (not just reordered)
          const localCardIds = (localCards || []).map(c => `${c.suit}-${c.value}`).sort().join(',');
          const serverCardIds = (myPlayer.cards || []).map(c => `${c.suit}-${c.value}`).sort().join(',');
          if (localCardIds !== serverCardIds) {
            setLocalCards(myPlayer.cards);
          }
        }
      }
    }
  }, [gameState, socket, activePlayerId, localCards]);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      const savedPlayerName = localStorage.getItem('playerName');
      const savedRoomCode = localStorage.getItem('roomCode');
      if (savedPlayerName && savedRoomCode) {
        setPlayerName(savedPlayerName);
        newSocket.emit('rejoinGame', { roomCode: savedRoomCode, playerName: savedPlayerName });
      }
    });

    newSocket.on('gameHosted', (state: GameState) => {
      localStorage.setItem('roomCode', state.roomCode);
      setGameState(state);
      setIsJoined(true);
    });

    newSocket.on('error', (msg: string) => {
      // Create a temporary system message for errors
      setGameState(prev => {
        if (!prev) return prev;
        const errorMsg = {
          sender: 'SYSTEM',
          seat: 0,
          color: 'red',
          text: `⚠️ ${msg}`,
          timestamp: Date.now(),
          isSystem: true
        };
        return {
          ...prev,
          messages: [...(prev.messages || []), errorMsg]
        };
      });
    });

    newSocket.on('playerJoined', (state: GameState) => {
      setGameState(state);
      setIsJoined(true);
    });

    newSocket.on('gameUpdate', (state: GameState) => {
      console.log('Received game update:', state);
      setGameState(prev => {
        if (prev && state.messages && state.messages.length > (prev.messages?.length || 0)) {
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg.sender !== playerName && !lastMsg.isSystem) {
            playSound('message');
          }
        }
        return state;
      });
      if (state.players[state.turnIndex]?.id !== newSocket.id) {
        setSelectedCardIndex(null);
      }
    });

    newSocket.on('error', (msg: string) => {
      setError(msg);
      playSound('error');
      setTimeout(() => setError(''), 3000);
    });

    newSocket.on('kicked', () => {
      setGameState(null);
      setIsJoined(false);
      setError('You have been kicked from the room.');
      setTimeout(() => setError(''), 5000);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const hostGame = () => {
    if (!playerName) return setError('Please enter your name');
    localStorage.setItem('playerName', playerName);
    socket?.emit('hostGame', { playerName });
  };

  const hostSandboxGame = () => {
    if (!playerName) return setError('Please enter your name');
    localStorage.setItem('playerName', playerName);
    socket?.emit('hostGame', { playerName, isSandbox: true });
  };

  const joinGame = () => {
    if (!playerName || !roomCodeInput) return setError('Enter name and room code');
    localStorage.setItem('playerName', playerName);
    localStorage.setItem('roomCode', roomCodeInput.toUpperCase());
    socket?.emit('joinGame', { roomCode: roomCodeInput.toUpperCase(), playerName });
  };

  const startGame = () => {
    if (gameState) {
      socket?.emit('startGame', gameState.roomCode);
    }
  };

  const placeBid = (bid: number) => {
    if (gameState) {
      socket?.emit('placeBid', { roomCode: gameState.roomCode, bid });
    }
  };

  const selectTrump = (suit: string) => {
    if (gameState) {
      socket?.emit('selectTrump', { roomCode: gameState.roomCode, suit });
    }
  };
  
  const leaveGame = () => {
    if (socket && gameState) {
      socket.emit('leaveRoom', gameState.roomCode);
    }
    localStorage.removeItem('playerName');
    localStorage.removeItem('roomCode');
    setIsJoined(false);
    setGameState(null);
    setRoomCodeInput('');
    setShowSettings(false);
    setShowRevealMenu(false);
    setShowGallery(false);
    setShowRules(false);
    setSelectedCardIndex(null);
    setLocalCards([]);
    setError('');
  };

  const [isDragging, setIsDragging] = useState(false);
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isProcessingPlay, setIsProcessingPlay] = useState(false);
  const [lastTrick, setLastTrick] = useState<{ cards: Card[], winnerId: string } | null>(null);

  useEffect(() => {
    if (gameState?.tableCards.length === 0 && lastTrick === null && gameState.players.some(p => p.tricks > 0)) {
      // This logic might need to be more robust based on how the server sends updates
    }
  }, [gameState?.tableCards]);

  useEffect(() => {
    if (!gameState) {
      setPrevGameState(null);
      return;
    }
    if (!prevGameState) {
      setPrevGameState(gameState);
      return;
    }

    // Card Played
    if (gameState.tableCards.length > prevGameState.tableCards.length) {
      playSound('card');
    }

    // Bid Placed
    if (gameState.highestBid > prevGameState.highestBid) {
      playSound('bid');
    }

    // Trick Won
    const prevTricks = prevGameState.players.reduce((sum, p) => sum + p.tricks, 0);
    const currentTricks = gameState.players.reduce((sum, p) => sum + p.tricks, 0);
    if (currentTricks > prevTricks) {
      playSound('winTrick');
    }

    // Phase Changes
    if (gameState.phase !== prevGameState.phase) {
      if (gameState.phase === 'ROUND_OVER') {
        playSound('round');
      }
      if (gameState.phase === 'GAME_OVER') {
        const myTeam = myIndex !== -1 ? (myIndex % 2 === 0 ? 1 : 2) : 0;
        const won = (myTeam === 1 && gameState.team1Score > gameState.team2Score) || (myTeam === 2 && gameState.team2Score > gameState.team1Score);
        playSound(won ? 'gameWin' : 'gameLoss');
      }
    }

    // Reveal Result
    if (gameState.revealResult && !prevGameState.revealResult) {
      // Reveal result particles removed
    }

    // Your Turn
    if (gameState.turnIndex !== prevGameState.turnIndex && gameState.players[gameState.turnIndex]?.id === socket?.id) {
      playSound('turn');
    }

    // Bound Activation (Yes)
    if (gameState.bound?.status === 'ACCEPTED' && prevGameState.bound?.status === 'OFFERED') {
      playSound('bound');
    }
    // Reverse Bound (No/Lost)
    if (gameState.bound?.status === 'REJECTED' && prevGameState.bound?.status === 'OFFERED') {
      playSound('reverseBound');
    }

    // Voting Appears
    if (gameState.phase === 'VOTING' && prevGameState.phase !== 'VOTING') {
      playSound('voting');
    }

    setPrevGameState(gameState);
  }, [gameState, socket?.id]);

  const SuitIcon = ({ suit, className }: { suit: string, className?: string }) => {
    switch (suit) {
      case '♠': return <Spade className={className} />;
      case '♥': return <Heart className={className} />;
      case '♦': return <Diamond className={className} />;
      case '♣': return <Club className={className} />;
      default: return null;
    }
  };

  const getCardIcon = (value: string) => {
    return value;
  };

  const playCard = (card: Card, localIndex: number) => {
    if (gameState && socket && !isProcessingPlay) {
      setIsProcessingPlay(true);
      const myPlayer = (gameState?.players || []).find(p => p.id === activePlayerId);
      if (myPlayer) {
        const actualIndex = (myPlayer.cards || []).findIndex(c => c.suit === card.suit && c.value === card.value);
        if (actualIndex !== -1) {
          socket.emit('playCard', { roomCode: gameState.roomCode, cardIndex: actualIndex });
        }
      }
      setSelectedCardIndex(null);
      // Reset processing state after a short delay to allow server sync
      setTimeout(() => setIsProcessingPlay(false), 500);
    }
  };

  const revealChallenge = () => {
    if (!gameState || !revealTargetId || !revealRound || !revealSuit) return;
    socket?.emit('revealChallenge', { 
      roomCode: gameState.roomCode, 
      targetPlayerId: revealTargetId, 
      roundToInspect: revealRound,
      suitType: revealSuit
    });
    setShowRevealMenu(false);
  };

  const isHost = gameState?.hostId === socket?.id;
  const [showHostPanel, setShowHostPanel] = useState(false);
  const [newTeam1Name, setNewTeam1Name] = useState('');
  const [newTeam2Name, setNewTeam2Name] = useState('');
  const [newPointLimit, setNewPointLimit] = useState(56);
  const [newBidTimerLimit, setNewBidTimerLimit] = useState(30);
  const [newVoteTimerLimit, setNewVoteTimerLimit] = useState(20);
  const [newTeam1Score, setNewTeam1Score] = useState(0);
  const [newTeam2Score, setNewTeam2Score] = useState(0);
  const [editRoomCode, setEditRoomCode] = useState('');

  useEffect(() => {
    if (showHostPanel && gameState) {
      setNewTeam1Name(gameState.team1Name || '');
      setNewTeam2Name(gameState.team2Name || '');
      setNewPointLimit(gameState.pointLimit || 56);
      setNewBidTimerLimit(gameState.bidTimerLimit || 30);
      setNewVoteTimerLimit(gameState.voteTimerLimit || 20);
      setNewTeam1Score(gameState.team1Score || 0);
      setNewTeam2Score(gameState.team2Score || 0);
      setEditRoomCode(gameState.roomCode || '');
    }
  }, [showHostPanel, gameState?.roomCode]);

  const kickPlayer = (playerId: string) => {
    socket?.emit('kickPlayer', { roomCode: gameState?.roomCode, playerId });
  };

  const swapPlayers = (idx1: number, idx2: number) => {
    socket?.emit('swapPlayers', { roomCode: gameState?.roomCode, index1: idx1, index2: idx2 });
  };

  const reorderPlayers = (newPlayers: Player[]) => {
    socket?.emit('reorderPlayers', { roomCode: gameState?.roomCode, newPlayers });
  };

  const renameTeams = () => {
    socket?.emit('renameTeams', { roomCode: gameState?.roomCode, team1Name: newTeam1Name, team2Name: newTeam2Name });
  };

  const updateSettings = () => {
    socket?.emit('updateSettings', { 
      roomCode: gameState?.roomCode, 
      settings: { 
        pointLimit: newPointLimit,
        bidTimerLimit: newBidTimerLimit,
        voteTimerLimit: newVoteTimerLimit,
        team1Score: newTeam1Score,
        team2Score: newTeam2Score,
        newRoomCode: editRoomCode || undefined
      } 
    });
  };

  const regenerateRoomCode = () => {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setEditRoomCode(randomCode);
    socket?.emit('updateSettings', { 
      roomCode: gameState?.roomCode, 
      settings: { 
        newRoomCode: randomCode
      } 
    });
  };

  const togglePause = () => {
    socket?.emit('togglePause', gameState?.roomCode);
  };

  const endGame = () => {
    // We cannot use window.confirm in iframe, so we will just emit it.
    socket?.emit('endGame', gameState?.roomCode);
  };

  const transferHost = (newHostId: string) => {
    socket?.emit('transferHost', { roomCode: gameState?.roomCode, newHostId });
  };

  const fillWithBots = () => {
    socket?.emit('fillWithBots', gameState?.roomCode);
  };

  const removeBots = () => {
    socket?.emit('removeBots', gameState?.roomCode);
  };

  const clearChat = () => {
    socket?.emit('clearChat', gameState?.roomCode);
  };

  const myPlayer = (gameState?.players || []).find(p => p.id === activePlayerId);
  const myIndex = (gameState?.players || []).findIndex(p => p.id === activePlayerId) ?? -1;
  const biddingTeam = gameState ? (gameState.bidWinnerIndex % 2 === 0 ? 1 : 2) : 0;
  const myTeam = myIndex !== -1 ? (myIndex % 2 === 0 ? 1 : 2) : 0;
  const isOpponent = biddingTeam !== 0 && myTeam !== 0 && biddingTeam !== myTeam;

  const opponentTarget = gameState?.highestBid === 6 ? 4 : (gameState?.highestBid === 7 ? 3 : (gameState?.highestBid === 8 ? 2 : 0));
  const opponentTricks = gameState ? (biddingTeam === 1 ? ((gameState.players[1]?.tricks || 0) + (gameState.players[3]?.tricks || 0)) : ((gameState.players[0]?.tricks || 0) + (gameState.players[2]?.tricks || 0))) : 0;

  const isMyTurn = gameState && gameState.players[gameState.turnIndex]?.id === activePlayerId;
  const hasAlreadyPlayed = gameState?.tableCards?.some(c => c.playerId === activePlayerId);
  const isEligibleToPlay = isMyTurn && 
                         gameState?.phase === 'PLAYING' && 
                         (gameState?.tableCards?.length ?? 0) < 4 && 
                         !isProcessingPlay &&
                         !hasAlreadyPlayed;


  const TurnIndicator = ({ gameState, activePlayerId }: { gameState: GameState | null, activePlayerId: string | null }) => {
    if (!gameState || gameState.phase !== 'PLAYING') return null;

    const currentPlayer = gameState.players[gameState.turnIndex];
    const isMyTurn = currentPlayer.id === activePlayerId;

    return (
      <div className="absolute z-[100] pointer-events-none inset-0 flex items-center justify-center">
        <div className="flex items-center gap-2 bg-neutral-950/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-neutral-200 text-xs font-medium shadow-xl">
          <div className={`w-1.5 h-1.5 rounded-full ${isMyTurn ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
          {isMyTurn ? "Your Turn" : `${currentPlayer.name}'s Turn`}
        </div>
      </div>
    );
  };

  const CardVisual = ({ card, className = "", isBurned = false }: { card: Card, className?: string, isBurned?: boolean }) => {
    const isRed = card.suit === '♥' || card.suit === '♦' || (card.type === 'joker' && card.value === 'Red');
    const isBlack = card.suit === '♠' || card.suit === '♣' || (card.type === 'joker' && card.value === 'Black');
    const suitColor = isRed ? 'text-red-600' : 'text-neutral-900';
    const isAce = card.value === 'A';
    const isKing = card.value === 'K';
    const isQueen = card.value === 'Q';
    const isJack = card.value === 'J';
    const player = gameState?.players?.find(p => p.id === card.playerId);
    const playerIndex = player ? (gameState?.players?.indexOf(player) ?? -1) : -1;
    const isTeam1 = playerIndex !== -1 ? playerIndex % 2 === 0 : true;
    const teamBorder = playerIndex !== -1 ? (isTeam1 ? 'border-cyan-500' : 'border-amber-500') : 'border-neutral-200';
    
    // Add a specific class to dim black cards more when grayscale is applied
    const grayscaleClass = isBurned ? (isBlack ? 'opacity-20 grayscale brightness-50' : 'opacity-30 grayscale') : '';

    return (
      <div className={`relative w-12 h-16 sm:w-24 sm:h-36 md:w-32 md:h-48 rounded-xl shadow-[0_10px_25px_rgba(0,0,0,0.4),_0_0_0_1px_rgba(0,0,0,0.1)] border-2 ${teamBorder} flex flex-col p-3 overflow-hidden select-none ${
        isAce 
          ? 'bg-gradient-to-br from-neutral-50 via-white to-neutral-200' 
          : 'bg-gradient-to-br from-white to-neutral-100'
      } ${suitColor} ${grayscaleClass} ${className} ${card.isWeakestTrump ? 'ring-4 ring-purple-500/50' : ''}`}>
        
        {card.isWeakestTrump && (
          <div className="absolute inset-0 bg-purple-500/10 flex items-center justify-center pointer-events-none z-10">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-purple-600 bg-white/80 px-2 py-1 rounded-full rotate-[-15deg] shadow-sm">
              Weakest Trump
            </span>
          </div>
        )}
        <div className="absolute inset-1 border border-neutral-200/50 rounded-lg pointer-events-none" />
        
        {/* Background Patterns */}
        {card.type !== 'joker' && (
          <div className={`absolute inset-0 pointer-events-none ${
            isAce 
              ? "bg-[url('https://www.transparenttextures.com/patterns/silk.png')] opacity-[0.08]" 
              : "bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03]"
          }`} />
        )}

        {card.type === 'joker' ? (
          <div className="flex flex-col h-full z-10 relative">
            <div className="flex justify-between items-start">
              <div className="flex flex-col">
                <div className="text-xl font-black leading-none">J</div>
                <div className="text-[8px] font-bold uppercase tracking-tighter opacity-60">Joker</div>
              </div>
              <div className="flex gap-1">
                <Sparkles className={`w-3 h-3 ${card.value === 'Red' ? 'text-red-400' : 'text-neutral-400'}`} />
                <div className={`w-2 h-2 rounded-full ${card.value === 'Red' ? 'bg-red-500' : 'bg-neutral-900'}`} />
              </div>
            </div>
            
            <div className="flex-1 flex items-center justify-center relative">
              <div className={`absolute inset-0 m-4 rounded-full blur-3xl opacity-10 ${card.value === 'Red' ? 'bg-red-600' : 'bg-neutral-600'}`} />
              <div className="relative">
                {/* Custom Joker Crown Icon */}
                <svg viewBox="0 0 64 64" className={`w-28 h-28 drop-shadow-xl ${card.value === 'Red' ? 'text-red-600' : 'text-neutral-800'}`} fill="currentColor">
                  {/* Crown Base */}
                  <path d="M12 48h40v-4H12v4z" />
                  <path d="M14 44h36v-2H14v2z" opacity="0.5" />
                  
                  {/* Crown Body */}
                  <path d="M12 40l-2-16 10 8 12-20 12 20 10-8-2 16H12z" />
                  
                  {/* Jewels/Ornaments */}
                  <circle cx="32" cy="12" r="4" />
                  <circle cx="10" cy="24" r="3" />
                  <circle cx="54" cy="24" r="3" />
                  <circle cx="21" cy="30" r="2" />
                  <circle cx="43" cy="30" r="2" />
                  
                  {/* Base Jewels */}
                  <circle cx="20" cy="46" r="1.5" fill="white" opacity="0.6" />
                  <circle cx="32" cy="46" r="1.5" fill="white" opacity="0.6" />
                  <circle cx="44" cy="46" r="1.5" fill="white" opacity="0.6" />
                </svg>
              </div>
            </div>

            <div className="flex justify-between items-start mt-auto rotate-180">
              <div className="flex flex-col">
                <div className="text-xl font-black leading-none">J</div>
                <div className="text-[8px] font-bold uppercase tracking-tighter opacity-60">Joker</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">{card.value}</div>
                <Zap className="w-3 h-3 opacity-30" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full z-10 relative">
            <div className="flex justify-between items-start">
              <div className="flex flex-col items-center">
                <span className="text-2xl font-black leading-none">{card.value}</span>
                <SuitIcon suit={card.suit} className="w-5 h-5 fill-current" />
              </div>
              <div className="text-[8px] font-bold opacity-20 tracking-widest uppercase">{card.suit === '♠' || card.suit === '♣' ? 'Black' : 'Red'}</div>
            </div>
            
            <div className="flex-1 flex items-center justify-center">
              {isAce ? (
                <div className="relative">
                  <SuitIcon suit={card.suit} className="w-12 h-12 drop-shadow-sm fill-current" />
                  <div className="absolute -inset-4 bg-current opacity-10 blur-2xl rounded-full" />
                </div>
              ) : isKing ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Subtle Royal Glow */}
                  <div className={`absolute -inset-12 blur-3xl rounded-full opacity-10 ${suitColor.replace('text-', 'bg-')}`} />
                  
                  {/* Enhanced Outline King Portrait */}
                  <svg viewBox="0 0 64 64" className={`w-20 h-20 ${suitColor}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {/* Crown - Refined Majestic Outline */}
                    <g strokeWidth="1.8">
                      <path d="M14 22 L8 6 L20 14 L32 2 L44 14 L56 6 L50 22 Z" />
                      {/* Crown Details */}
                      <path d="M14 22 Q32 26 50 22" opacity="0.6" />
                      <path d="M24 16 Q32 19 40 16" opacity="0.3" />
                      {/* Jewels - 3 Small Circles on Center Peak & Side Peaks */}
                      <circle cx="32" cy="0.5" r="1" fill="currentColor" stroke="none" />
                      <circle cx="29.5" cy="2.5" r="0.8" fill="currentColor" stroke="none" opacity="0.8" />
                      <circle cx="34.5" cy="2.5" r="0.8" fill="currentColor" stroke="none" opacity="0.8" />
                      <circle cx="8" cy="6" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="56" cy="6" r="1.2" fill="currentColor" stroke="none" />
                    </g>
                    
                    {/* Head & Hair Outlines */}
                    <path d="M20 22 V42 C20 50 26 56 32 56 S44 50 44 42 V22" strokeWidth="1.8" />
                    {/* Flowing Hair Accents */}
                    <path d="M14 28 C11 32 11 42 14 48" opacity="0.4" />
                    <path d="M50 28 C53 32 53 42 50 48" opacity="0.4" />
                    
                    {/* Facial Features - Refined */}
                    <g strokeWidth="1.8">
                      {/* Stern Eyebrows */}
                      <path d="M24 34 Q28 32 31 34" opacity="0.8" />
                      <path d="M33 34 Q36 32 40 34" opacity="0.8" />
                      
                      {/* Piercing Eyes */}
                      <circle cx="28" cy="38" r="0.8" fill="currentColor" stroke="none" />
                      <circle cx="36" cy="38" r="0.8" fill="currentColor" stroke="none" />
                      
                      {/* Noble Nose */}
                      <path d="M32 36 V44 L30 46" opacity="0.6" />
                      
                      {/* Elegant Handlebar Mustache */}
                      <path d="M21 48 C25 44 31 44 32 48 C33 44 39 44 43 48" />
                      <path d="M21 48 Q17 48 16 44" opacity="0.5" />
                      <path d="M43 48 Q47 48 48 44" opacity="0.5" />
                    </g>
                    
                    {/* Royal Collar / Shoulders - Grounding the portrait */}
                    <path d="M12 58 Q32 62 52 58" strokeWidth="1.2" opacity="0.3" />
                    <path d="M18 54 Q32 57 46 54" strokeWidth="1" opacity="0.2" />
                    
                    {/* Beard Texture - Rhythmic Lines */}
                    <g opacity="0.3" strokeWidth="1">
                      <path d="M27 51 V53" />
                      <path d="M32 52 V54" />
                      <path d="M37 51 V53" />
                    </g>
                  </svg>
                </div>
              ) : isQueen ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Subtle Royal Glow */}
                  <div className={`absolute -inset-12 blur-3xl rounded-full opacity-10 ${suitColor.replace('text-', 'bg-')}`} />
                  
                  {/* Further Enhanced Outline Queen Portrait */}
                  <svg viewBox="0 0 64 64" className={`w-20 h-20 ${suitColor}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {/* Queen's Crown - Intricate Majestic Outline */}
                    <g strokeWidth="1.8">
                      <path d="M18 22 L12 8 L24 16 L32 2 L40 16 L52 8 L46 22 Z" />
                      {/* Crown Internal Filigree */}
                      <path d="M18 22 Q32 26 46 22" opacity="0.6" />
                      <path d="M24 16 Q32 19 40 16" opacity="0.3" />
                      <path d="M32 4 V16" opacity="0.2" />
                      {/* Jewels - 3 Small Circles on Center Peak & Side Peaks */}
                      <circle cx="32" cy="0.5" r="1" fill="currentColor" stroke="none" />
                      <circle cx="29.5" cy="2.5" r="0.8" fill="currentColor" stroke="none" opacity="0.8" />
                      <circle cx="34.5" cy="2.5" r="0.8" fill="currentColor" stroke="none" opacity="0.8" />
                      <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="52" cy="8" r="1.2" fill="currentColor" stroke="none" />
                      <circle cx="32" cy="12" r="0.6" fill="currentColor" stroke="none" opacity="0.5" />
                    </g>
                    
                    {/* Queen's Head & Flowing Hair - More Strands */}
                    <g strokeWidth="1.8">
                      <path d="M22 22 V40 C22 48 26 54 32 54 S42 48 42 40 V22" />
                      {/* Flowing Hair Outlines - Layered strands */}
                      <path d="M16 24 C10 28 10 48 18 54" opacity="0.5" />
                      <path d="M48 24 C54 28 54 48 46 54" opacity="0.5" />
                      <path d="M13 30 C9 36 9 46 15 52" opacity="0.3" />
                      <path d="M51 30 C55 36 55 46 49 52" opacity="0.3" />
                      {/* Hair Pearls/Accents */}
                      <circle cx="14" cy="34" r="0.6" fill="currentColor" stroke="none" opacity="0.4" />
                      <circle cx="50" cy="34" r="0.6" fill="currentColor" stroke="none" opacity="0.4" />
                    </g>
                    
                    {/* Facial Features - Refined Elegance */}
                    <g strokeWidth="1.6">
                      {/* Graceful Eyebrows */}
                      <path d="M25 34 Q28 32 31 34" opacity="0.8" />
                      <path d="M33 34 Q36 32 39 34" opacity="0.8" />
                      
                      {/* Piercing Soft Eyes */}
                      <circle cx="28" cy="38" r="0.8" fill="currentColor" stroke="none" />
                      <circle cx="36" cy="38" r="0.8" fill="currentColor" stroke="none" />
                      {/* Eyelash accents */}
                      <path d="M26 37.5 L25 36.5" opacity="0.4" />
                      <path d="M38 37.5 L39 36.5" opacity="0.4" />
                      
                      {/* Delicate Nose */}
                      <path d="M32 36 V43" opacity="0.5" />
                      
                      {/* Royal Smile - More defined */}
                      <path d="M28 47 Q32 49 36 47" opacity="0.8" />
                      <path d="M30 48.5 Q32 49.5 34 48.5" opacity="0.4" />
                    </g>
                    
                    {/* Royal Jewelry - Necklace & Earrings */}
                    <g opacity="0.5" strokeWidth="1.2">
                      {/* Necklace */}
                      <path d="M22 42 Q32 46 42 42" />
                      <circle cx="32" cy="45" r="1" fill="currentColor" stroke="none" />
                      <circle cx="28" cy="44" r="0.5" fill="currentColor" stroke="none" opacity="0.6" />
                      <circle cx="36" cy="44" r="0.5" fill="currentColor" stroke="none" opacity="0.6" />
                      
                      {/* Subtle Earrings */}
                      <circle cx="20" cy="40" r="0.6" fill="currentColor" stroke="none" />
                      <circle cx="44" cy="40" r="0.6" fill="currentColor" stroke="none" />
                    </g>
                    
                    {/* Royal Collar / Shoulders - Grounding the portrait */}
                    <path d="M12 56 Q32 60 52 56" strokeWidth="1.2" opacity="0.3" />
                    <path d="M18 52 Q32 55 46 52" strokeWidth="1" opacity="0.2" />
                  </svg>
                </div>
              ) : isJack ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Subtle Royal Glow */}
                  <div className={`absolute -inset-12 blur-3xl rounded-full opacity-10 ${suitColor.replace('text-', 'bg-')}`} />
                  
                  {/* Outline Jack Portrait */}
                  <svg viewBox="0 0 64 64" className={`w-20 h-20 ${suitColor}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {/* Jack's Cap - Feathered Warrior Style */}
                    <g strokeWidth="1.8">
                      {/* Cap Base */}
                      <path d="M16 26 Q32 18 48 26 L52 32 L12 32 Z" />
                      {/* The Feather */}
                      <path d="M42 22 C46 10 54 6 58 4" strokeWidth="1.2" />
                      <path d="M58 4 Q54 8 52 14" strokeWidth="0.8" opacity="0.6" />
                      <path d="M58 4 Q50 6 46 10" strokeWidth="0.8" opacity="0.6" />
                      {/* Cap Detail - 3 Small Circles */}
                      <circle cx="20" cy="28" r="1" fill="currentColor" stroke="none" />
                      <circle cx="18" cy="29.5" r="0.6" fill="currentColor" stroke="none" opacity="0.6" />
                      <circle cx="22" cy="29.5" r="0.6" fill="currentColor" stroke="none" opacity="0.6" />
                    </g>
                    
                    {/* Jack's Head & Youthful Hair */}
                    <g strokeWidth="1.8">
                      <path d="M22 32 V44 C22 50 26 56 32 56 S42 50 42 44 V32" />
                      {/* Short, Energetic Hair strands */}
                      <path d="M18 32 C15 34 14 40 16 44" opacity="0.5" />
                      <path d="M46 32 C49 34 50 40 48 44" opacity="0.5" />
                    </g>
                    
                    {/* Facial Features - Youthful & Determined */}
                    <g strokeWidth="1.6">
                      {/* Determined Eyebrows */}
                      <path d="M25 38 Q28 37 31 38" />
                      <path d="M33 38 Q36 37 39 38" />
                      
                      {/* Focused Eyes */}
                      <circle cx="28" cy="42" r="0.8" fill="currentColor" stroke="none" />
                      <circle cx="36" cy="42" r="0.8" fill="currentColor" stroke="none" />
                      
                      {/* Straight Nose */}
                      <path d="M32 40 V48" opacity="0.6" />
                      
                      {/* Confident Smirk */}
                      <path d="M28 51 Q32 53 36 51" />
                    </g>
                    
                    {/* Warrior's Collar / Armor Detail */}
                    <g opacity="0.4" strokeWidth="1.2">
                      <path d="M18 54 L12 60" />
                      <path d="M46 54 L52 60" />
                      <path d="M22 56 Q32 60 42 56" />
                    </g>
                    
                    {/* Shoulders */}
                    <path d="M10 58 Q32 62 54 58" strokeWidth="1" opacity="0.2" />
                  </svg>
                </div>
              ) : (
                <span className="text-7xl drop-shadow-sm select-none font-black">
                  {card.value}
                </span>
              )}
            </div>
            
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${isAce ? 'opacity-[0.08]' : 'opacity-[0.05]'}`}>
              <SuitIcon suit={card.suit} className="w-32 h-32 fill-current" />
            </div>

            <div className="flex justify-between items-start mt-auto rotate-180">
              <div className="flex flex-col items-center">
                <span className="text-2xl font-black leading-none">{card.value}</span>
                <SuitIcon suit={card.suit} className="w-5 h-5 fill-current" />
              </div>
              <div className="text-[8px] font-bold opacity-20 tracking-widest uppercase">{card.suit === '♠' || card.suit === '♣' ? 'Black' : 'Red'}</div>
            </div>
          </div>
        )}
        
        {isBurned && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 rounded-xl backdrop-blur-[2px]">
            <span className="text-red-600 font-black text-lg rotate-45 border-4 border-red-600 px-3 py-1 uppercase tracking-tighter bg-white/95 shadow-2xl">
              BURNED
            </span>
          </div>
        )}
      </div>
    );
  };

  const getCardPosition = (card: Card, index: number) => {
    if (!gameState) return { x: 0, y: 0, rotate: 0 };
    
    const myPlayer = (gameState?.players || []).find(p => p.id === activePlayerId);
    if (!myPlayer) return { x: 0, y: 0, rotate: 0 };
    
    const player = (gameState?.players || []).find(p => p.id === card.playerId);
    if (!player) return { x: 0, y: 0, rotate: 0 };
    
    const relativePos = (player.seatId - myPlayer.seatId + 4) % 4;
    const randomOffset = (index * 7) % 15 - 7.5; 
    
    switch (relativePos) {
      case 0: return { x: 0, y: 80, rotate: randomOffset };
      case 1: return { x: -140, y: 0, rotate: 90 + randomOffset };
      case 2: return { x: 0, y: -80, rotate: 180 + randomOffset };
      case 3: return { x: 140, y: 0, rotate: -90 + randomOffset };
      default: return { x: 0, y: 0, rotate: 0 };
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans">
      
      {/* Chat System */}
      {isJoined && gameState && (
        <Chat 
          socket={socket}
          roomCode={gameState.roomCode}
          playerName={playerName}
          isHost={gameState.hostId === socket?.id}
          onNewMessage={() => playSound('click')}
          onChatMessage={handleChatMessage}
        />
      )}

      {/* Settings Menu */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          >
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-neutral-900 border-2 border-white/10 rounded-[3rem] p-10 max-w-sm w-full shadow-[0_0_100px_rgba(0,0,0,0.5)] space-y-8 relative"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-black italic text-white flex items-center gap-3 tracking-tighter">
                  <Settings className="w-6 h-6 text-neutral-400" />
                  SETTINGS
                </h3>
                <AnimatedButton 
                  onClick={() => {
                    playSound('closeMenu');
                    setShowSettings(false);
                  }} 
                  className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <X className="w-6 h-6 text-neutral-400" />
                </AnimatedButton>
              </div>
              
              <div className="space-y-4">
                <p className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Preferences</p>
                <AnimatedButton 
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="w-full flex items-center justify-between p-4 bg-neutral-800 rounded-2xl hover:bg-neutral-700 transition-colors"
                >
                  <span className="text-sm font-medium text-white">Sound Effects</span>
                  <div className={`w-10 h-6 rounded-full flex items-center p-1 transition-all duration-300 ${soundEnabled ? 'bg-emerald-500 justify-end' : 'bg-neutral-600 justify-start'}`}>
                    <motion.div layout className="w-4 h-4 bg-white rounded-full shadow-sm" />
                  </div>
                </AnimatedButton>
                <button 
                  onClick={toggleFullscreen}
                  className="w-full flex items-center justify-between p-4 bg-neutral-800 rounded-2xl hover:bg-neutral-700 transition-colors"
                >
                  <span className="text-sm font-medium text-white">Fullscreen</span>
                  <Maximize className="w-5 h-5 text-neutral-400" />
                </button>
                <button 
                  onClick={() => {
                    playSound('closeMenu');
                    setShowGallery(true);
                    setShowSettings(false);
                  }}
                  className="w-full flex items-center justify-between p-4 bg-neutral-800 rounded-2xl hover:bg-neutral-700 transition-colors"
                >
                  <span className="text-sm font-medium text-white">Card Gallery</span>
                  <LayoutGrid className="w-5 h-5 text-neutral-400" />
                </button>
                <button 
                  onClick={leaveGame}
                  className="w-full flex items-center justify-between p-4 bg-red-900/20 rounded-2xl hover:bg-red-900/40 transition-colors"
                >
                  <span className="text-sm font-medium text-red-400">Leave Game</span>
                  <LogOut className="w-5 h-5 text-red-400" />
                </button>
                <div className="pt-4 flex justify-between">
                  <p className="text-xs font-bold text-neutral-600 uppercase tracking-widest">Creator: REXY</p>
                  <p className="text-xs font-bold text-neutral-600 uppercase tracking-widest">TikTok: IREXYI</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isJoined ? (
        <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-neutral-900 p-8 rounded-3xl shadow-2xl border border-white/10"
          >
            <h1 className="text-5xl font-black mb-2 text-center bg-gradient-to-br from-emerald-400 to-cyan-500 bg-clip-text text-transparent italic tracking-tighter">
              ورقــــــه
            </h1>
            {/* removed strategy game text */}
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest ml-1">Your Name</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="e.g. AceHigh"
                  className="w-full bg-neutral-800 border border-white/5 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all placeholder:text-neutral-700 font-semibold"
                />
              </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={hostGame}
                className="flex flex-col items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 p-6 rounded-2xl transition-all group active:scale-95 shadow-lg shadow-emerald-900/20"
              >
                <div className="p-3 bg-white/10 rounded-xl group-hover:scale-110 transition-transform">
                  <Plus className="w-6 h-6" />
                </div>
                <span className="font-bold text-sm uppercase tracking-wider text-center">Host Game</span>
              </button>
              
              <button 
                onClick={hostSandboxGame}
                className="flex flex-col items-center justify-center gap-3 bg-amber-600 hover:bg-amber-500 p-6 rounded-2xl transition-all group active:scale-95 shadow-lg shadow-amber-900/20"
              >
                <div className="p-3 bg-white/10 rounded-xl group-hover:scale-110 transition-transform">
                  <Ghost className="w-6 h-6" />
                </div>
                <span className="font-bold text-sm uppercase tracking-wider text-center">Sandbox Mode</span>
              </button>
            </div>
            
            <div className="flex flex-col gap-3 pt-4 border-t border-white/5">
              <div className="flex gap-3">
                <input 
                  type="text" 
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="ROOM CODE"
                  className="w-full bg-neutral-800 border border-white/5 rounded-2xl px-4 py-3 text-center uppercase font-black tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-neutral-700"
                />
                <button 
                  onClick={joinGame}
                  className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 px-8 py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-cyan-900/20"
                >
                  <LogIn className="w-5 h-5" />
                  <span className="font-bold text-sm uppercase tracking-wider">Join</span>
                </button>
              </div>
              <button 
                onClick={() => {
                  console.log('Settings button clicked');
                  setShowSettings(true);
                }}
                className="w-full flex items-center justify-center gap-3 bg-neutral-800 hover:bg-neutral-700 p-4 rounded-2xl transition-all active:scale-95"
              >
                <Settings className="w-5 h-5" />
                <span className="font-bold text-sm uppercase tracking-wider">Settings</span>
              </button>
            </div>
            <div className="flex gap-2 pt-4">
              <button 
                onClick={() => setShowRules(!showRules)}
                className="w-full flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 py-3 rounded-xl transition-colors text-xs font-bold text-neutral-400 uppercase tracking-widest"
              >
                <Info className="w-4 h-4" />
                Game Rules
              </button>
            </div>
            <div className="pt-6 flex justify-between">
              <p className="text-xs font-bold text-neutral-600 uppercase tracking-widest">Creator: REXY</p>
              <p className="text-xs font-bold text-neutral-600 uppercase tracking-widest">TikTok: IREXYI</p>
            </div>

            {error && (
              <motion.p 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-center text-xs font-bold bg-red-400/10 py-3 rounded-xl border border-red-400/20"
              >
                {error}
              </motion.p>
            )}
          </div>
        </motion.div>

        <AnimatePresence>
          {showRules && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mt-8 w-full max-w-2xl bg-neutral-900 p-8 rounded-3xl border border-white/10 shadow-2xl"
            >
              <h3 className="text-xl font-black mb-6 flex items-center gap-2 text-emerald-400 italic">
                <ChevronRight className="w-6 h-6" />
                GAME ENGINE SPECIFICATION
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm text-neutral-400 leading-relaxed">
                <div className="space-y-4">
                  <p><strong className="text-white">Deck:</strong> 36 Cards (6-A for ♠♥, 7-A for ♦♣) + Red & Black Jokers.</p>
                  <p><strong className="text-white">Dealing:</strong> 9 cards each. 4 players total.</p>
                  <p><strong className="text-white">Bidding:</strong> Call 6 to 8 tricks. If any player bids 8, bidding ends immediately and they select trump. If all pass, dealer calls 5-8.</p>
                </div>
                <div className="space-y-4">
                  <p><strong className="text-white">Jokers:</strong> Black burns after Round 3. Red burns if played before Black.</p>
                  <p><strong className="text-white">Trumps:</strong> Bid winner chooses the trump suit.</p>
                  <p><strong className="text-white">Goal:</strong> Win at least the number of tricks you called.</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showGallery && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex flex-col p-8 overflow-y-auto"
            >
              <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                  <div>
                    <h2 className="text-4xl font-black italic text-emerald-400 tracking-tighter">CARD ARCHIVE</h2>
                    <p className="text-neutral-500 font-bold uppercase tracking-[0.3em] text-xs mt-2">Visualizing the 38-card specialized deck</p>
                  </div>
                  <button 
                    onClick={() => setShowGallery(false)}
                    className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl transition-colors"
                  >
                    <X className="w-8 h-8" />
                  </button>
                </div>

                <div className="space-y-16">
                  {['♠', '♥', '♦', '♣', 'Joker'].map(suit => (
                    <div key={suit} className="space-y-6">
                      <h3 className="text-xl font-black flex items-center gap-3 text-neutral-400">
                        <SuitIcon suit={suit} className="w-6 h-6 fill-current" />
                        {suit === 'Joker' ? 'SPECIALS' : `SUIT: ${suit}`}
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-4">
                        {(suit === 'Joker' ? ['Black', 'Red'] : (suit === '♠' || suit === '♥' ? ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] : ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'])).map(value => (
                          <div key={value} className="flex flex-col items-center gap-2">
                            <CardVisual card={{ suit, value, type: suit === 'Joker' ? 'joker' : 'normal' }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      ) : (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-white/5 flex justify-between items-center bg-neutral-900/50 backdrop-blur-xl z-50">
        <div className="flex items-center gap-6">
          <button 
            onClick={leaveGame}
            className="p-2 rounded-xl bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all border border-white/5 group"
            title="Back to Menu"
          >
            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <h2 className="text-2xl font-black italic tracking-tighter text-emerald-400">ورقــــــه</h2>
          <div className="flex items-center gap-2 bg-neutral-800 px-4 py-1.5 rounded-full text-[10px] font-black tracking-[0.2em] border border-white/5 text-neutral-400">
            ROOM: <span className="text-white">{gameState?.roomCode}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-8 items-center">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Round</span>
            <span className="text-2xl font-black">{gameState?.roundNumber}/9</span>
          </div>
          {gameState?.highestBid > 0 && (
            <div className="flex flex-col items-center border border-emerald-500/30 rounded-2xl px-4 py-2 bg-emerald-500/5">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Bid</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-emerald-400">{gameState.highestBid}</span>
                {opponentTarget > 0 && (
                  <div className="flex flex-col items-start leading-none">
                    <span className="text-[8px] font-bold text-red-500 uppercase">Target</span>
                    <span className="text-xs font-black text-red-400">{opponentTricks}/{opponentTarget}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isHost && (
            <button 
              onClick={() => setShowHostPanel(!showHostPanel)}
              className={`p-2 rounded-xl transition-all ${showHostPanel ? 'bg-emerald-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
              title="Host Controls"
            >
              <Users className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={() => {
              console.log('Settings button clicked (game screen)');
              playSound('openMenu');
              setShowSettings(true);
            }}
            className="p-2 rounded-xl bg-neutral-800 text-neutral-400 hover:text-white transition-all"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          {gameState?.phase === 'PLAYING' && (
            <button 
              onClick={() => {
                playSound('openMenu');
                setShowRevealMenu(true);
                const firstOtherPlayer = (gameState?.players || []).find(p => p.id !== activePlayerId);
                if (firstOtherPlayer) setRevealTargetId(firstOtherPlayer.id);
                setRevealRound(Math.max(1, gameState.roundNumber - 1));
              }}
              className={`p-2 rounded-xl transition-all ${showRevealMenu ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
              title="Check Player"
            >
              <Eye className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-4 mr-4">
            <div className="text-right">
              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{gameState?.team1Name || 'Team 1'}</p>
              <p className="text-sm font-black text-white">{gameState?.team1Score || 0}</p>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div className="text-left">
              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{gameState?.team2Name || 'Team 2'}</p>
              <p className="text-sm font-black text-white">{gameState?.team2Score || 0}</p>
            </div>
          </div>
          <div className="flex -space-x-3">
            {gameState?.players?.map((p, i) => {
              const isTeam1 = i % 2 === 0;
              return (
                <div 
                  key={p.id} 
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all relative ${
                    gameState.turnIndex === i 
                      ? (isTeam1 ? 'border-cyan-500 scale-110 z-10 bg-cyan-500/20' : 'border-amber-500 scale-110 z-10 bg-amber-500/20')
                      : 'border-neutral-700 bg-neutral-800'
                  } ${!p.connected ? 'opacity-40' : ''}`}
                  title={`${p.name}${!p.connected ? ' (Disconnected)' : ''}`}
                >
                  {p.name[0].toUpperCase()}
                  {!p.connected && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-black" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-8 w-px bg-white/10 mx-2" />
          <div className="text-right">
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Phase</p>
            <p className="text-xs font-black text-emerald-400 uppercase tracking-wider">{gameState?.phase.replace('_', ' ')}</p>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 relative flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-800 via-neutral-950 to-black shadow-[inset_0_0_150px_rgba(0,0,0,1)]">
        

        {/* Turn Indicator */}
        <TurnIndicator gameState={gameState} activePlayerId={activePlayerId} />

        {/* Host Panel Overlay */}
        <AnimatePresence>
          {showRevealMenu && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6 relative overflow-hidden"
              >
                <div className="flex justify-between items-center relative z-10">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Eye className="w-5 h-5" />
                    <h3 className="text-xl font-black italic tracking-tighter uppercase">Check Player</h3>
                  </div>
                  <button 
                    onClick={() => {
                      playSound('closeMenu');
                      setShowRevealMenu(false);
                    }} 
                    className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5 text-neutral-400" />
                  </button>
                </div>

                <div className="space-y-6 relative z-10">
                  {/* Target Selection */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Who to check?</label>
                    <div className="grid grid-cols-3 gap-2">
                      {gameState?.players?.filter(p => p.id !== activePlayerId).map(p => (
                        <button
                          key={p.id}
                          onClick={() => setRevealTargetId(p.id)}
                          className={`p-3 rounded-xl border transition-all ${
                            revealTargetId === p.id 
                              ? 'bg-amber-500 border-amber-400 text-black' 
                              : 'bg-neutral-800/50 border-white/5 text-neutral-400 hover:border-white/10'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-sm font-black ${
                            revealTargetId === p.id ? 'bg-black text-amber-500' : 'bg-neutral-700 text-neutral-400'
                          }`}>
                            {p.name[0].toUpperCase()}
                          </div>
                          <p className="text-[10px] font-black uppercase truncate text-center">{p.name}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Round Selection */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Which round? (1-{Math.max(1, (gameState?.roundNumber || 1) - 1)})</label>
                    <div className="bg-neutral-800/50 p-4 rounded-2xl border border-white/5 flex items-center gap-4">
                      <input 
                        type="range" 
                        min="1" 
                        max={Math.max(1, (gameState?.roundNumber || 1) - 1)}
                        value={revealRound}
                        onChange={(e) => setRevealRound(parseInt(e.target.value))}
                        className="flex-1 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      <div className="w-10 h-10 rounded-xl bg-black border border-amber-500/30 flex flex-col items-center justify-center">
                        <span className="text-[8px] font-black text-neutral-500 uppercase leading-none">Rnd</span>
                        <span className="text-lg font-black text-amber-400">{revealRound}</span>
                      </div>
                    </div>
                  </div>

                  {/* Suit Selection */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">What suit?</label>
                    <div className="grid grid-cols-5 gap-2">
                      {['♠', '♥', '♦', '♣', 'Trump'].map(s => (
                        <button
                          key={s}
                          onClick={() => setRevealSuit(s)}
                          className={`aspect-square rounded-xl border text-lg font-black transition-all flex flex-col items-center justify-center ${
                            revealSuit === s 
                              ? 'bg-amber-500 border-amber-400 text-black' 
                              : 'bg-neutral-800/50 border-white/5 text-neutral-400 hover:border-white/10'
                          }`}
                        >
                          <span>{s === 'Trump' ? 'T' : s}</span>
                          <span className="text-[7px] font-black uppercase opacity-50">{s === 'Trump' ? 'Trump' : ''}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={revealChallenge}
                    disabled={!revealTargetId || (gameState?.roundNumber || 1) <= 1}
                    className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-black uppercase tracking-widest text-xs transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Check Now
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {gameState?.revealResult && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`relative bg-neutral-900 border-2 rounded-3xl p-6 max-w-lg w-full shadow-2xl text-center space-y-4 overflow-hidden ${
                  gameState.revealResult.violationFound ? 'border-red-500/50' : 'border-emerald-500/50'
                }`}
              >
                <div className="flex flex-col items-center gap-3">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`w-16 h-16 rounded-full flex items-center justify-center ${
                      gameState.revealResult.violationFound 
                        ? 'bg-red-500' 
                        : 'bg-emerald-500'
                    }`}
                  >
                    {gameState.revealResult.violationFound ? <AlertTriangle className="w-8 h-8 text-white" /> : <ShieldCheck className="w-8 h-8 text-white" />}
                  </motion.div>
                  
                  <h2 className={`text-2xl font-black italic tracking-tighter uppercase ${
                    gameState.revealResult.violationFound ? 'text-red-500' : 'text-emerald-500'
                  }`}>
                    {gameState.revealResult.violationFound ? 'Caught!' : 'Clean!'}
                  </h2>
                </div>

                <div className="space-y-4">
                  <div className="bg-black/40 p-4 rounded-xl border border-white/5">
                    <p className="text-sm font-medium text-neutral-200 italic">
                      "{gameState.revealResult.message}"
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-neutral-800/50 p-3 rounded-xl border border-white/5">
                      <p className="text-[8px] font-black uppercase text-neutral-500 mb-1">Challenger</p>
                      <p className="text-sm font-black text-white">{gameState.revealResult.challenger}</p>
                    </div>
                    <div className="bg-neutral-800/50 p-3 rounded-xl border border-white/5">
                      <p className="text-[8px] font-black uppercase text-neutral-500 mb-1">Target</p>
                      <p className="text-sm font-black text-white">{gameState.revealResult.target}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Evidence: Round {gameState.revealResult.round}</p>
                    
                    <div className="flex justify-center gap-4">
                      {gameState.revealResult.trickCards?.map((card, idx) => {
                        const isTarget = card.playerId === gameState.revealResult?.targetId;
                        return (
                          <div key={`${card.suit}-${card.value}-${card.playerId}`} className="flex flex-col items-center gap-2">
                            <div className={`relative p-0.5 rounded-xl ${
                              isTarget ? 'bg-amber-500 shadow-lg scale-105' : 'opacity-50'
                            }`}>
                              <CardVisual card={card} className="scale-75" />
                            </div>
                            <span className={`text-[8px] font-black uppercase ${isTarget ? 'text-amber-400' : 'text-neutral-500'}`}>
                              {card.playedBy}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <Trophy className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-[8px] font-black uppercase text-neutral-500">Points</p>
                      <p className="text-xs font-black text-white">Team {gameState.revealResult.pointsAwardedTo} <span className="text-emerald-400">+15</span></p>
                    </div>
                  </div>
                  {isHost ? (
                    <button 
                      onClick={() => socket.emit('skipReveal', { roomCode: gameState.roomCode })}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                      Skip
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-neutral-500 italic text-[10px]">
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping" />
                      Next in 5s...
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Host Panel Overlay */}
        <AnimatePresence>
          {showHostPanel && isHost && (
            <motion.div 
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              className="absolute right-4 top-20 bottom-24 w-80 bg-neutral-900/95 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl z-[100] p-6 flex flex-col gap-6 overflow-y-auto"
            >
              <div className="flex justify-between items-center sticky top-0 bg-neutral-900/95 backdrop-blur-2xl py-2 z-10 border-b border-white/5">
                <h3 className="text-lg font-black italic text-emerald-400">HOST POWERS</h3>
                <button onClick={() => setShowHostPanel(false)} className="text-neutral-500 hover:text-white bg-neutral-800 p-1.5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 flex items-center gap-2">
                  <Users className="w-3 h-3" />
                  Players & Teams
                </h4>
                <Reorder.Group 
                  axis="y" 
                  values={gameState?.players || []} 
                  onReorder={reorderPlayers}
                  className="space-y-2"
                >
                  {gameState?.players?.map((p, idx) => {
                    if (!p) return null;
                    const isTeam1 = idx % 2 === 0;
                    const teamBorder = isTeam1 ? 'border-cyan-500/50' : 'border-amber-500/50';
                    const teamText = isTeam1 ? 'text-cyan-400' : 'text-amber-400';
                    return (
                      <Reorder.Item 
                        key={p.id} 
                        value={p}
                        disabled={gameState.gameStarted}
                        className={`flex items-center justify-between bg-neutral-800/80 p-3 rounded-xl border ${teamBorder} ${!gameState.gameStarted ? 'cursor-grab active:cursor-grabbing hover:bg-neutral-700/80' : ''} transition-colors shadow-sm`}
                      >
                        <div className="flex items-center gap-3">
                          {!gameState.gameStarted && (
                            <GripVertical className="w-4 h-4 text-neutral-500" />
                          )}
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-red-500'} shadow-[0_0_8px_rgba(0,0,0,0.5)] ${p.connected ? 'shadow-emerald-500/50' : 'shadow-red-500/50'}`} />
                            <span className={`text-xs font-bold truncate max-w-[100px] ${teamText}`}>{p.name}</span>
                            <span className="text-[8px] text-neutral-500 bg-neutral-900 px-1.5 py-0.5 rounded-md">T{idx % 2 === 0 ? '1' : '2'}</span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {p.id !== activePlayerId && (
                            <>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  transferHost(p.id);
                                }}
                                className="p-1.5 hover:bg-amber-500/20 rounded-lg text-amber-500/70 hover:text-amber-400 transition-colors"
                                title="Transfer Host"
                              >
                                <Crown className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  kickPlayer(p.id);
                                }}
                                className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-500/70 hover:text-red-400 transition-colors"
                                title="Kick Player"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </Reorder.Item>
                    );
                  })}
                </Reorder.Group>
                {!gameState?.gameStarted && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {(gameState?.players?.length || 0) < 4 && (
                      <button 
                        onClick={fillWithBots}
                        className="w-full bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border border-cyan-500/20 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                      >
                        <Users className="w-3.5 h-3.5" />
                        Fill Bots
                      </button>
                    )}
                    {gameState?.players?.some(p => p.isBot) && (
                      <button 
                        onClick={removeBots}
                        className="w-full bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        Remove Bots
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-white/5">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 flex items-center gap-2">
                  <Settings className="w-3 h-3" />
                  Room Settings
                </h4>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-neutral-500 uppercase font-bold ml-1">Team 1 Name</label>
                      <input 
                        type="text" 
                        placeholder={gameState?.team1Name}
                        value={newTeam1Name}
                        onChange={(e) => setNewTeam1Name(e.target.value)}
                        className="w-full bg-neutral-800 border border-white/5 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-neutral-500 uppercase font-bold ml-1">Team 2 Name</label>
                      <input 
                        type="text" 
                        placeholder={gameState?.team2Name}
                        value={newTeam2Name}
                        onChange={(e) => setNewTeam2Name(e.target.value)}
                        className="w-full bg-neutral-800 border border-white/5 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center ml-1">
                      <label className="text-[9px] text-neutral-500 uppercase font-bold">Room Code</label>
                      <button 
                        onClick={regenerateRoomCode}
                        disabled={gameState?.gameStarted}
                        className={`text-[9px] font-black text-emerald-400 uppercase tracking-tighter flex items-center gap-1 hover:text-emerald-300 transition-colors ${gameState?.gameStarted ? 'opacity-20 cursor-not-allowed' : ''}`}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Regenerate
                      </button>
                    </div>
                    <input 
                      type="text" 
                      placeholder={gameState?.roomCode}
                      value={editRoomCode}
                      disabled={gameState?.gameStarted}
                      onChange={(e) => setEditRoomCode(e.target.value.toUpperCase())}
                      className={`w-full bg-neutral-800 border border-white/5 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-neutral-500 uppercase font-bold ml-1 truncate">{gameState?.team1Name || 'Team 1'} Pts</label>
                      <input 
                        type="number" 
                        value={newTeam1Score}
                        onChange={(e) => setNewTeam1Score(parseInt(e.target.value) || 0)}
                        className="w-full bg-neutral-800 border border-white/5 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-neutral-500 uppercase font-bold ml-1 truncate">{gameState?.team2Name || 'Team 2'} Pts</label>
                      <input 
                        type="number" 
                        value={newTeam2Score}
                        onChange={(e) => setNewTeam2Score(parseInt(e.target.value) || 0)}
                        className="w-full bg-neutral-800 border border-white/5 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2 bg-neutral-800/50 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center text-[10px] text-neutral-400 uppercase font-bold">
                      <span>Point Limit</span>
                      <span className="text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-md">{newPointLimit}</span>
                    </div>
                    <input 
                      type="range" 
                      min="21" 
                      max="101" 
                      step="5"
                      disabled={gameState?.gameStarted}
                      value={newPointLimit}
                      onChange={(e) => setNewPointLimit(parseInt(e.target.value))}
                      className={`w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div className="space-y-2 bg-neutral-800/50 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center text-[10px] text-neutral-400 uppercase font-bold">
                      <span>Bidding Timer</span>
                      <span className="text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-md">{newBidTimerLimit}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="10" 
                      max="120" 
                      step="5"
                      disabled={gameState?.gameStarted}
                      value={newBidTimerLimit}
                      onChange={(e) => setNewBidTimerLimit(parseInt(e.target.value))}
                      className={`w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div className="space-y-2 bg-neutral-800/50 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center text-[10px] text-neutral-400 uppercase font-bold">
                      <span>Voting Timer</span>
                      <span className="text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-md">{newVoteTimerLimit}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="10" 
                      max="60" 
                      step="5"
                      disabled={gameState?.gameStarted}
                      value={newVoteTimerLimit}
                      onChange={(e) => setNewVoteTimerLimit(parseInt(e.target.value))}
                      className={`w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button 
                      disabled={gameState?.gameStarted}
                      onClick={renameTeams} 
                      className={`w-full bg-neutral-700 hover:bg-neutral-600 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      Update Names
                    </button>
                    <button 
                      disabled={gameState?.gameStarted}
                      onClick={updateSettings} 
                      className={`w-full bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-900/20 ${gameState?.gameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      Apply Settings
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 flex items-center gap-2">
                  <Volume2 className="w-3 h-3" />
                  Preferences
                </h4>
                <button 
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    soundEnabled 
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                      : 'bg-neutral-800 border-white/5 text-neutral-500'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    <span className="text-[10px] font-black uppercase tracking-widest">Sound Effects</span>
                  </div>
                  <div className={`w-8 h-4 rounded-full relative transition-colors ${soundEnabled ? 'bg-emerald-500' : 'bg-neutral-700'}`}>
                    <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${soundEnabled ? 'right-1' : 'left-1'}`} />
                  </div>
                </button>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/5">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-500 flex items-center gap-2">
                  <ShieldAlert className="w-3 h-3" />
                  Session Controls
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={togglePause}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      gameState?.isPaused 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-neutral-800 text-neutral-400 border border-white/5 hover:bg-neutral-700 hover:text-white'
                    }`}
                  >
                    {gameState?.isPaused ? <PlayCircle className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    {gameState?.isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button 
                    onClick={clearChat}
                    className="flex items-center justify-center gap-2 bg-neutral-800 text-neutral-400 border border-white/5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-neutral-700 hover:text-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Chat
                  </button>
                  <button 
                    onClick={endGame}
                    className="col-span-2 flex items-center justify-center gap-2 bg-red-600/10 text-red-500 border border-red-500/20 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-red-600/20 hover:text-red-400"
                  >
                    <Ghost className="w-3.5 h-3.5" />
                    End Game
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>



        {/* Pause Overlay */}
        <AnimatePresence>
          {gameState?.isPaused && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md z-[150] flex flex-col items-center justify-center"
            >
              <Pause className="w-20 h-20 text-emerald-500 mb-6 animate-pulse" />
              <h2 className="text-4xl font-black italic text-white mb-2">GAME PAUSED</h2>
              <p className="text-neutral-400 font-bold uppercase tracking-widest">Waiting for host to resume...</p>
              {isHost && (
                <button 
                  onClick={togglePause}
                  className="mt-8 bg-emerald-500 text-black px-8 py-3 rounded-2xl font-black uppercase tracking-widest hover:scale-105 transition-transform"
                >
                  Resume Game
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Trump Card Display */}
        {gameState?.trumpSuit && (
          <div className="absolute top-8 left-8 flex flex-col items-center z-20">
            <span className="text-[10px] font-bold text-neutral-300 uppercase tracking-widest mb-2 drop-shadow-md">Trump Suit</span>
            <motion.div 
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: -6 }}
              className={`w-24 h-36 bg-gradient-to-br from-white to-neutral-100 rounded-xl shadow-[0_10px_20px_rgba(0,0,0,0.5),_0_0_0_1px_rgba(0,0,0,0.1)] flex flex-col p-2 ${
                gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'text-red-600' : 'text-neutral-900'
              }`}
            >
              <div className="absolute inset-1 border border-neutral-200/50 rounded-lg pointer-events-none" />
              <div className="text-xl font-black leading-none z-10">{gameState.trumpSuit}</div>
              <div className="flex-1 flex items-center justify-center z-10">
                <span className="text-6xl drop-shadow-sm">{gameState.trumpSuit}</span>
              </div>
              <div className="text-xl font-black leading-none self-end rotate-180 z-10">{gameState.trumpSuit}</div>
            </motion.div>
          </div>
        )}

        {/* Phase Overlays */}
        <AnimatePresence mode="wait">
          {gameState?.bound && gameState.bound.status === 'OFFERED' && gameState.bound.offeredTo === activePlayerId && (
            <motion.div
              key="bound"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
            >
              <div className="bg-neutral-900 border border-white/10 rounded-3xl p-6 md:p-12 max-w-lg w-full shadow-2xl text-center space-y-8">
                <h2 className="text-4xl font-black uppercase tracking-widest text-white">Bound Option</h2>
                <p className="text-neutral-400 text-lg">The contract team has won all tricks. Do you want to activate Bound?</p>
                
                <div className="grid grid-cols-2 gap-6">
                  <button
                    onClick={() => {
                      console.log("Yes clicked");
                      if (socket) socket.emit('boundChoice', { roomCode: gameState.roomCode, choice: 'YES' });
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 py-6 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 text-xl"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => {
                      console.log("No clicked");
                      if (socket) socket.emit('boundChoice', { roomCode: gameState.roomCode, choice: 'NO' });
                    }}
                    className="bg-red-600 hover:bg-red-500 py-6 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 text-xl"
                  >
                    No
                  </button>
                </div>
              </div>
            </motion.div>
          )}
          {gameState?.phase === 'VOTING' && (
            <motion.div
              key="voting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
            >
              <div className="bg-neutral-900 border border-white/10 rounded-3xl p-6 md:p-12 max-w-lg w-full shadow-2xl text-center space-y-8">
                <div className="flex flex-col items-center gap-2">
                  <Shield className="w-12 h-12 text-amber-500 mb-2" />
                  <h2 className="text-4xl font-black uppercase tracking-widest text-white">Host Decision</h2>
                  <div className="bg-amber-500/10 border border-amber-500/20 px-4 py-1 rounded-full">
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Host Power Active</span>
                  </div>
                </div>
                
                <p className="text-neutral-400 text-lg">
                  {isHost 
                    ? "The contract condition has been met. As the host, you must decide how to proceed." 
                    : "The contract condition has been met. Waiting for the host to decide the next step."}
                </p>
                
                <div className="flex flex-col items-center gap-4">
                  <div className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">
                    {isHost ? "Your Decision Time" : "Host's Decision Time"}
                  </div>
                  <motion.div 
                    key="vote-timer"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center font-black transition-all duration-300 ${
                    (gameState.voting?.timeLeft || 0) <= 5 
                      ? 'border-red-500 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)] animate-pulse' 
                      : 'border-amber-500/50 text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                  }`}>
                    <span className="text-3xl leading-none">{gameState.voting?.timeLeft ?? 20}</span>
                    <span className="text-[10px] opacity-50 mt-1">SEC</span>
                  </motion.div>
                </div>

                {isHost ? (
                  <div className="grid grid-cols-2 gap-6">
                    <button
                      onClick={() => socket.emit('castVote', { roomCode: gameState.roomCode, vote: 'CONTINUE' })}
                      className="bg-emerald-600 hover:bg-emerald-500 py-6 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 text-xl shadow-lg shadow-emerald-900/20"
                    >
                      Continue
                    </button>
                    <button
                      onClick={() => socket.emit('castVote', { roomCode: gameState.roomCode, vote: 'CLOSE' })}
                      className="bg-red-600 hover:bg-red-500 py-6 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 text-xl shadow-lg shadow-red-900/20"
                    >
                      Close
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3 py-6 bg-white/5 rounded-2xl border border-white/5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                    <span className="text-sm font-black uppercase tracking-widest text-neutral-500">Waiting for Host...</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {gameState?.phase === 'WAITING' && (
            <motion.div 
              key="waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center space-y-8"
            >
              <div className="flex justify-center gap-6">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="space-y-3">
                      <div className={`w-24 h-24 rounded-full border-[4px] flex items-center justify-center transition-all relative shadow-2xl ${
                      gameState.players[i] ? 'border-emerald-500 bg-gradient-to-b from-emerald-800 to-emerald-950' : 'border-neutral-700 bg-neutral-900/50 border-dashed'
                    }`}>
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase tracking-widest bg-neutral-950 px-3 py-1 rounded-full border border-white/10 shadow-lg">
                        {i % 2 === 0 ? (gameState.team1Name || 'Team 1') : (gameState.team2Name || 'Team 2')}
                      </div>
                      {gameState.players[i] ? (
                        <div className="relative">
                          <span className="text-4xl font-black text-white drop-shadow-md">{gameState.players[i].name[0].toUpperCase()}</span>
                          {!gameState.players[i].connected && (
                            <div className="absolute -bottom-1 -right-1 bg-red-500 w-4 h-4 rounded-full border-2 border-neutral-950 flex items-center justify-center">
                              <Ghost className="w-2 h-2 text-white" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <Users className="w-8 h-8 text-neutral-600" />
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                      {gameState.players[i]?.name || 'Empty'}
                    </p>
                  </div>
                ))}
              </div>
              
              {gameState.players[0]?.id === socket?.id && (
                <button 
                  onClick={startGame}
                  disabled={gameState.players.length < 4}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed px-12 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center gap-3 mx-auto transition-all hover:scale-105 active:scale-95 shadow-xl shadow-emerald-900/20"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Launch Game
                </button>
              )}
              <p className="text-neutral-600 text-xs font-medium italic">Need 4 players to begin the royale...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Round and Bid Info - Moved above the table */}
        {gameState?.phase !== 'WAITING' && gameState?.bidWinnerIndex !== -1 && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex flex-col items-center gap-1 z-30"
          >
            <div className="bg-neutral-900/80 backdrop-blur-md px-8 py-3 rounded-full border border-white/10 shadow-2xl flex items-center gap-6">
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Bidder</span>
                <span className="text-lg font-black text-emerald-400">{gameState.players[gameState.bidWinnerIndex]?.name}</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Bid</span>
                <span className="text-lg font-black text-white">{gameState.highestBid}</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Round</span>
                <span className="text-lg font-black text-white">{gameState.roundNumber}</span>
              </div>
            </div>
          </motion.div>
        )}

        {gameState?.phase !== 'WAITING' && (
          <div className={`relative w-full max-w-5xl aspect-square sm:aspect-[2/1] rounded-[1000px] border-[10px] sm:border-[20px] border-[#2d1b15] bg-[#144d29] transition-all duration-300 ${
            isDragging ? 'shadow-[inset_0_0_100px_rgba(0,0,0,0.9),_0_30px_60px_rgba(0,0,0,0.8),_0_0_150px_rgba(52,211,153,0.4)] ring-8 ring-emerald-500/30' : 'shadow-[inset_0_0_100px_rgba(0,0,0,0.9),_0_30px_60px_rgba(0,0,0,0.8),_0_0_120px_rgba(20,77,41,0.5)] ring-4 ring-black/40'
          } flex items-center justify-center mt-8`}>
            {/* Table felt texture pattern */}
            <div className="absolute inset-0 rounded-[980px] opacity-40 bg-[radial-gradient(circle_at_center,_transparent_0%,_#000_120%),_repeating-linear-gradient(45deg,_transparent,_transparent_2px,_rgba(0,0,0,0.3)_2px,_rgba(0,0,0,0.3)_4px)] pointer-events-none" />
            <div className="absolute inset-0 rounded-[980px] border-[3px] border-[#4caf50]/20 pointer-events-none m-4" />
            
            {/* Play Zone Indicator */}
            {(isDragging || draggedCard) && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className={`w-48 h-60 sm:w-56 sm:h-72 md:w-64 md:h-80 border-4 border-dashed rounded-[3rem] flex items-center justify-center transition-colors duration-300 ${
                  dragY < -100 ? 'border-emerald-400 bg-emerald-500/5' : 'border-emerald-400/20'
                }`}>
                  <span className={`text-[10px] font-black uppercase tracking-[0.5em] transition-colors duration-300 ${
                    dragY < -100 ? 'text-emerald-400' : 'text-emerald-400/20'
                  }`}>
                    {dragY < -100 ? 'Release to Play' : 'Drop to Play'}
                  </span>
                </div>
              </motion.div>
            )}

            {/* Drag Preview on Table */}
            {draggedCard && dragY < -50 && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ 
                  opacity: Math.min(1, Math.abs(dragY) / 200), 
                  y: 0,
                  scale: 0.9 + Math.min(0.1, Math.abs(dragY) / 2000)
                }}
                className={`absolute w-12 h-16 sm:w-24 sm:h-36 md:w-32 md:h-48 bg-white/10 rounded-xl border-2 border-dashed flex flex-col p-3 pointer-events-none z-50 ${
                  draggedCard.suit === '♥' || draggedCard.suit === '♦' ? 'border-red-500/30 text-red-500/30' : 'border-white/20 text-white/20'
                }`}
              >
                <div className="text-2xl font-black leading-none">{draggedCard.value}</div>
                <div className="text-3xl"><SuitIcon suit={draggedCard.suit} className="w-8 h-8 fill-current" /></div>
                <div className="absolute inset-0 flex items-center justify-center opacity-10">
                  <SuitIcon suit={draggedCard.suit} className="w-32 h-32 fill-current" />
                </div>
              </motion.div>
            )}

            {/* Player Avatars Around Table */}
            {gameState?.players?.map((p) => {
              const myPlayer = (gameState?.players || []).find(me => me.id === activePlayerId);
              const mySeatId = myPlayer?.seatId ?? 0;
              const relativePos = (p.seatId - mySeatId + 4) % 4;
              const isCurrent = gameState.players[gameState.turnIndex]?.id === p.id;
              const isTeam1 = p.seatId % 2 === 0;
              const teamBorder = isTeam1 ? 'border-cyan-500' : 'border-amber-500';
              let positionClasses = "";
              switch (relativePos) {
                case 0: positionClasses = "bottom-2 left-1/2 -translate-x-1/2"; break;
                case 1: positionClasses = "left-4 top-1/2 -translate-y-1/2"; break;
                case 2: positionClasses = "top-2 left-1/2 -translate-x-1/2"; break;
                case 3: positionClasses = "right-4 top-1/2 -translate-y-1/2"; break;
              }

              const isHost = gameState?.hostId === socket?.id;
              const isSandbox = (gameState as any)?.isSandbox;
              const isBot = (p as any).isBot;
              const canControl = isSandbox && isHost;

              return (
                <motion.div 
                  key={p.id} 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ 
                    opacity: isCurrent ? 1 : 0.6, 
                    scale: isCurrent ? 1.15 : 1,
                  }}
                  className={`absolute ${positionClasses} flex flex-col items-center gap-2 z-10 transition-all duration-500 ${!p.connected ? 'opacity-50 grayscale' : ''}`}
                >
                  {/* Chat Bubble */}
                  <AnimatePresence>
                    {chatBubbles[`P${p.seatId + 1}`] && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.5 }}
                        animate={{ opacity: 1, y: -40, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        className="absolute top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                      >
                        <div className={`text-neutral-950 px-3 py-1.5 rounded-2xl text-[10px] font-black shadow-2xl whitespace-nowrap relative ${chatBubbles[`P${p.seatId + 1}`].channel === 'team' ? 'bg-indigo-300' : 'bg-white'}`}>
                          {chatBubbles[`P${p.seatId + 1}`].channel === 'team' && <span className="mr-1 opacity-70">[TEAM]</span>}
                          {chatBubbles[`P${p.seatId + 1}`].text}
                          <div className={`absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${chatBubbles[`P${p.seatId + 1}`].channel === 'team' ? 'bg-indigo-300' : 'bg-white'}`} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="relative">
                    <div 
                      onClick={() => canControl && setSandboxPlayerId(p.id)}
                      className={`w-16 h-16 rounded-full border-[3px] flex items-center justify-center text-2xl font-black bg-gradient-to-b from-neutral-800 to-neutral-900 shadow-xl transition-all duration-700 relative ${
                      isCurrent ? 'border-emerald-400 text-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.4)]' : `${teamBorder} text-neutral-400`
                    } ${canControl ? 'cursor-pointer hover:border-amber-400 hover:text-amber-400' : ''} ${sandboxPlayerId === p.id ? 'border-amber-500 text-amber-500 shadow-[0_0_40px_rgba(245,158,11,0.4)]' : ''}`}>
                      {p.name[0].toUpperCase()}
                      {isCurrent && (
                        <motion.div 
                          layoutId="turn-glow"
                          className="absolute inset-0 rounded-full bg-emerald-500/10 animate-pulse"
                        />
                      )}
                      {/* Contextual Timer on Avatar */}
                      {isCurrent && (gameState.phase === 'BIDDING' || gameState.phase === 'DEALER_FORCED_BID') && (
                        <motion.div 
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black shadow-lg z-20 ${
                            (gameState.bidTimeLeft || 0) <= 5 ? 'bg-red-600 border-red-400 text-white animate-pulse' : 'bg-emerald-600 border-emerald-400 text-white'
                          }`}
                        >
                          {gameState.bidTimeLeft ?? 30}
                        </motion.div>
                      )}
                      {/* Voting Timer for Host */}
                      {gameState.phase === 'VOTING' && p.id === gameState.hostId && (
                        <motion.div 
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black shadow-lg z-20 ${
                            (gameState.voting?.timeLeft || 0) <= 5 ? 'bg-red-600 border-red-400 text-white animate-pulse' : 'bg-amber-600 border-amber-400 text-white'
                          }`}
                        >
                          {gameState.voting?.timeLeft ?? 20}
                        </motion.div>
                      )}
                      {isBot && (
                        <div className="absolute -top-2 -right-2 bg-amber-500 text-neutral-950 text-[8px] font-black px-1.5 py-0.5 rounded-full border border-neutral-900">
                          BOT
                        </div>
                      )}
                      {!p.connected && (
                        <div className="absolute -top-1 -right-1 bg-red-600 text-[8px] font-black px-1.5 py-0.5 rounded-full border border-black uppercase tracking-tighter shadow-lg">
                          OFF
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full border shadow-lg transition-all duration-500 ${
                      isCurrent ? 'bg-emerald-500 text-neutral-950 border-emerald-400' : 'bg-neutral-900/90 text-neutral-400 border-neutral-700'
                    } ${sandboxPlayerId === p.id ? 'bg-amber-500 text-neutral-950 border-amber-400' : ''}`}>
                      <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      {p.name}
                    </div>
                    </span>
                    {!p.connected && <span className="text-[8px] font-bold text-red-500 uppercase tracking-tighter">Disconnected</span>}
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${isTeam1 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {isTeam1 ? 'Team 1' : 'Team 2'}
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded-full border border-white/5">
                      <Trophy className="w-2.5 h-2.5 text-emerald-500" />
                      <span className="text-[9px] font-black text-emerald-500/80">{p.tricks}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            <div className="flex justify-center items-center relative w-full h-full z-20 -translate-y-6 pointer-events-none">
              <AnimatePresence mode="wait">
                {(gameState?.phase === 'BIDDING' || gameState?.phase === 'DEALER_FORCED_BID') && (
                  <motion.div 
                    key="bidding"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    className="bg-neutral-900/90 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/10 shadow-2xl text-center max-w-md w-full pointer-events-auto"
                  >
                    <h3 className="text-2xl font-black mb-2 italic tracking-tight">CALL YOUR TRICKS</h3>
                    
                    <div className="flex flex-col items-center gap-4 mb-8">
                      <div className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">
                        {isMyTurn ? "Your Bidding Time" : `${gameState.players[gameState.turnIndex]?.name}'s Time`}
                      </div>
                      <motion.div 
                        key={`bid-timer-${gameState.turnIndex}`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className={`w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center font-black transition-all duration-300 ${
                        (gameState.bidTimeLeft || 0) <= 5 
                          ? 'border-red-500 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)] animate-pulse' 
                          : 'border-emerald-500/50 text-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.2)]'
                      }`}>
                        <span className="text-3xl leading-none">{gameState.bidTimeLeft ?? 30}</span>
                        <span className="text-[10px] opacity-50 mt-1">SEC</span>
                      </motion.div>
                    </div>

                    <p className="text-neutral-500 text-xs mb-8 font-medium uppercase tracking-widest">
                      {isMyTurn ? "It's your turn to bid" : `Waiting for ${gameState.players[gameState.turnIndex]?.name || 'Player'}`}
                    </p>
                    
                    <div className="grid grid-cols-4 gap-3">
                      {gameState.phase === 'DEALER_FORCED_BID' ? (
                        [5, 6, 7, 8].map(bid => (
                          <div key={bid} className="flex flex-col gap-1">
                            <button
                              disabled={!isMyTurn}
                              onClick={() => placeBid(bid)}
                              className="aspect-square bg-neutral-800 hover:bg-emerald-600 disabled:opacity-20 disabled:hover:bg-neutral-800 rounded-2xl flex items-center justify-center text-2xl font-black transition-all active:scale-90"
                            >
                              {bid}
                            </button>
                          </div>
                        ))
                      ) : (
                        <>
                          {[6, 7, 8].map(bid => (
                            <div key={bid} className="flex flex-col gap-1">
                              <button
                                disabled={!isMyTurn || bid <= gameState.highestBid}
                                onClick={() => placeBid(bid)}
                                className="aspect-square bg-neutral-800 hover:bg-emerald-600 disabled:opacity-20 disabled:hover:bg-neutral-800 rounded-2xl flex items-center justify-center text-2xl font-black transition-all active:scale-90"
                              >
                                {bid}
                              </button>
                            </div>
                          ))}
                          <button
                            disabled={!isMyTurn}
                            onClick={() => placeBid(0)}
                            className="aspect-square bg-neutral-800 hover:bg-red-600 disabled:opacity-20 disabled:hover:bg-neutral-800 rounded-2xl flex items-center justify-center text-xs font-black uppercase tracking-widest transition-all active:scale-90"
                          >
                            Pass
                          </button>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

                {gameState?.phase === 'TRUMP_SELECTION' && (
                  <motion.div 
                    key="trump"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    className="bg-neutral-900/90 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/10 shadow-2xl text-center max-w-md w-full pointer-events-auto"
                  >
                    <h3 className="text-2xl font-black mb-2 italic tracking-tight">CHOOSE TRUMP</h3>
                    <p className="text-neutral-500 text-xs mb-8 font-medium uppercase tracking-widest">
                      {isMyTurn ? "Select the dominant suit" : `Waiting for ${gameState.players[gameState.turnIndex]?.name || 'Player'}`}
                    </p>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {["♠", "♥", "♦", "♣"].map(suit => (
                        <button
                          key={suit}
                          disabled={!isMyTurn}
                          onClick={() => selectTrump(suit)}
                          className={`h-24 bg-neutral-800 hover:bg-emerald-600 disabled:opacity-20 disabled:hover:bg-neutral-800 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${
                            suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-white'
                          }`}
                        >
                          <SuitIcon suit={suit} className="w-12 h-12 fill-current" />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {gameState?.phase === 'ROUND_OVER' && gameState.lastRoundResult && (
                  <motion.div 
                    key="over"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    className={`bg-neutral-900/95 backdrop-blur-3xl p-6 md:p-12 rounded-[3.5rem] border shadow-2xl text-center max-w-lg w-full pointer-events-auto ${
                      gameState.lastRoundResult.isJokerBurn ? 'border-red-500/50 shadow-[0_0_100px_rgba(239,68,68,0.2)]' : 'border-white/10'
                    }`}
                  >
                    {gameState.lastRoundResult.isJokerBurn ? (
                      <div className="space-y-6">
                        <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(239,68,68,0.5)] animate-pulse">
                          <Flame className="w-12 h-12 text-white" />
                        </div>
                        <h3 className="text-4xl font-black italic tracking-tighter text-red-500 uppercase">JUDGMENT PHASE</h3>
                        <div className="space-y-2">
                          <p className="text-2xl font-black text-white">{gameState.lastRoundResult.burnedJoker} Joker Burned!</p>
                          <p className="text-neutral-400 font-medium uppercase tracking-[0.2em] text-xs">Trick {gameState.lastRoundResult.round} • Round {gameState.lastRoundResult.gameRound}</p>
                        </div>
                        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl">
                          <p className="text-red-400 font-black text-xl">15 Points Awarded to Opposing Team</p>
                        </div>
                        <div className="flex items-center justify-center gap-2 text-neutral-500 text-[10px] font-bold uppercase tracking-widest pt-4">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
                          Next round starting automatically...
                        </div>
                      </div>
                    ) : (
                      <>
                        <Trophy className="w-16 h-16 text-emerald-400 mx-auto mb-6" />
                        <h3 className="text-3xl font-black mb-2 italic tracking-tight">ROUND RESULTS</h3>
                        {gameState.lastRoundResult.reason && (
                          <p className="text-red-400 font-bold mb-6">{gameState.lastRoundResult.reason}</p>
                        )}
                        
                        <div className="grid grid-cols-2 gap-6 mb-10">
                          {/* Team 1 */}
                          <div className={`p-6 rounded-3xl border ${gameState.lastRoundResult.biddingTeam === 1 ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/5 bg-white/5'}`}>
                            <h4 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-4">{gameState.team1Name || 'Team 1'}</h4>
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs text-neutral-500">Tricks</span>
                              <span className="font-black text-xl">{gameState.lastRoundResult.team1Tricks}</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-white/10">
                              <span className="text-xs text-neutral-500">Score</span>
                              <span className={`font-black text-xl ${gameState.lastRoundResult.team1RoundScore > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                +{gameState.lastRoundResult.team1RoundScore}
                              </span>
                            </div>
                            {gameState.lastRoundResult.biddingTeam === 1 && (
                              <div className="mt-4 text-[10px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-500/20 py-1 rounded-full">
                                Bid: {gameState.lastRoundResult.highestBid}
                              </div>
                            )}
                          </div>

                          {/* Team 2 */}
                          <div className={`p-6 rounded-3xl border ${gameState.lastRoundResult.biddingTeam === 2 ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/5 bg-white/5'}`}>
                            <h4 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-4">{gameState.team2Name || 'Team 2'}</h4>
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs text-neutral-500">Tricks</span>
                              <span className="font-black text-xl">{gameState.lastRoundResult.team2Tricks}</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-white/10">
                              <span className="text-xs text-neutral-500">Score</span>
                              <span className={`font-black text-xl ${gameState.lastRoundResult.team2RoundScore > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                +{gameState.lastRoundResult.team2RoundScore}
                              </span>
                            </div>
                            {gameState.lastRoundResult.biddingTeam === 2 && (
                              <div className="mt-4 text-[10px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-500/20 py-1 rounded-full">
                                Bid: {gameState.lastRoundResult.highestBid}
                              </div>
                            )}
                          </div>
                        </div>

                        {gameState.players[0]?.id === socket?.id && (
                          <button 
                            onClick={() => socket?.emit('nextRound', gameState.roomCode)}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 py-5 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-emerald-900/20"
                          >
                            Next Round
                          </button>
                        )}
                      </>
                    )}
                  </motion.div>
                )}

                {gameState?.phase === 'GAME_OVER' && (
                  <motion.div 
                    key="gameover"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    className="bg-neutral-900/90 backdrop-blur-2xl p-6 md:p-12 rounded-[3rem] border border-emerald-500/50 shadow-[0_0_100px_rgba(16,185,129,0.3)] text-center max-w-lg w-full"
                  >
                    <Trophy className="w-24 h-24 text-emerald-400 mx-auto mb-6" />
                    <h3 className="text-4xl font-black mb-4 italic tracking-tight text-emerald-400">GAME OVER</h3>
                    <p className="text-xl font-bold mb-8">
                      {gameState.team1Score >= gameState.pointLimit ? 'Team 1 Wins!' : 'Team 2 Wins!'}
                    </p>
                    
                    <div className="flex justify-center gap-12 mb-10">
                      <div className="text-center">
                        <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">{gameState.team1Name || 'Team 1'}</div>
                        <div className="text-5xl font-black">{gameState.team1Score}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">{gameState.team2Name || 'Team 2'}</div>
                        <div className="text-5xl font-black">{gameState.team2Score}</div>
                      </div>
                    </div>

                    {gameState.players[0]?.id === socket?.id && (
                      <button 
                        onClick={startGame}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 py-5 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-emerald-900/20"
                      >
                        Play Again
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {gameState?.phase === 'PLAYING' && (
                <>
                  <AnimatePresence>
                    {gameState?.tableCards?.map((card, i) => {
                      const pos = getCardPosition(card, i);
                      return (
                        <motion.div
                          key={`${card.suit}-${card.value}-${card.playerId}`}
                          initial={{ scale: 0, rotate: pos.rotate - 180, x: 0, y: 0, opacity: 0 }}
                          animate={{ scale: 1, rotate: pos.rotate, x: pos.x, y: pos.y, opacity: 1 }}
                          className="absolute"
                          style={{ zIndex: i + 10 }}
                        >
                          <CardVisual card={card} isBurned={card.isBurned} />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {(gameState?.tableCards?.length ?? 0) === 0 && (
                    <div className="w-40 h-56 border-4 border-dashed border-emerald-950/40 rounded-[2rem] flex flex-col items-center justify-center text-emerald-950/40 gap-4 z-0">
                      <div className="w-12 h-12 rounded-full border-4 border-emerald-950/40 flex items-center justify-center">
                        <ChevronRight className="w-6 h-6" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-center px-2">Waiting for<br/>Lead</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Player Hand */}
      {gameState?.gameStarted && (
        <footer className="p-8 bg-gradient-to-t from-neutral-950 to-neutral-900/90 backdrop-blur-3xl border-t border-white/5 relative z-50 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
          <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-neutral-500">Your Arsenal</h3>
                <div className="h-4 w-px bg-white/10" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-500">{myPlayer?.cards?.length || 0} Cards</span>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Team Tricks</p>
                  <p className="text-xl font-black text-emerald-400">
                    {gameState && myPlayer && gameState.players && gameState.players.length >= 4 ? (
                      (myPlayer?.tricks || 0) + 
                      (gameState.players[(gameState.players.findIndex(p => p.id === activePlayerId) + 2) % 4]?.tricks || 0)
                    ) : 0}
                  </p>
                </div>
                {isMyTurn && gameState.tableCards.length < 4 && (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-emerald-500 text-black px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse"
                  >
                    Your Turn
                  </motion.div>
                )}
              </div>
            </div>

            <div className="relative overflow-visible">
              <Reorder.Group 
                axis="x" 
                values={localCards} 
                onReorder={(newCards) => {
                  setLocalCards(newCards);
                }}
                className="flex justify-center gap-3 pb-6 px-4 list-none m-0 overflow-visible"
              >
                <AnimatePresence mode="popLayout">
                  {(localCards || []).map((card, i) => {
                  return (
                    <Reorder.Item
                      key={`${card.suit}-${card.value}`}
                      value={card}
                      layout
                      initial={{ y: 60, opacity: 0, scale: 0.9, rotate: (Math.random() - 0.5) * 10 }}
                      animate={{ 
                        y: 0, 
                        opacity: 1,
                        scale: 1,
                        rotate: (i - (localCards.length - 1) / 2) * 2,
                        transition: {
                          type: "spring",
                          stiffness: 500,
                          damping: 40,
                          delay: i * 0.03
                        }
                      }}
                      exit={{ 
                        scale: 0.8, 
                        opacity: 0, 
                        y: -100,
                        transition: { duration: 0.2 } 
                      }}
                      whileHover={{ 
                        y: -20, 
                        scale: 1.05, 
                        zIndex: 50,
                        transition: { type: "spring", stiffness: 400, damping: 25 }
                      }}
                      whileDrag={{ 
                        scale: 1.2, 
                        zIndex: 1000, 
                        rotate: 0,
                        boxShadow: "0 30px 60px rgba(0,0,0,0.5), 0 0 30px rgba(16, 185, 129, 0.4)",
                        filter: "brightness(1.1) contrast(1.1)",
                        transition: { type: "spring", stiffness: 300, damping: 20 }
                      }}
                      onDragStart={() => {
                        setIsDragging(true);
                        setDraggedCard(card);
                      }}
                      onDrag={(e, info) => {
                        setDragY(info.offset.y);
                      }}
                      onDragEnd={(_, info) => {
                        setIsDragging(false);
                        setDraggedCard(null);
                        setDragY(0);
                        
                        // Sync reorder to server on drop
                        socket?.emit('reorderCards', { roomCode: gameState?.roomCode, newCards: localCards });
                        
                        // Professional Play Detection: Dragged up significantly
                        if (info.offset.y < -140 && isEligibleToPlay) {
                          playCard(card, i);
                        }
                      }}
                      onClick={() => {
                        if (isEligibleToPlay) {
                          if (selectedCardIndex === i) {
                            playCard(card, i);
                          } else {
                            setSelectedCardIndex(i);
                          }
                        }
                      }}
                      onDoubleClick={() => {
                        if (isEligibleToPlay) {
                          playCard(card, i);
                        }
                      }}
                      className="list-none"
                    >
                      <CardVisual 
                        card={card} 
                        className={`cursor-grab active:cursor-grabbing ${selectedCardIndex === i ? 'ring-4 ring-emerald-500 -translate-y-8' : ''} ${!isEligibleToPlay && gameState?.phase !== 'BIDDING' && gameState?.phase !== 'DEALER_FORCED_BID' ? ((card.suit === '♠' || card.suit === '♣' || (card.type === 'joker' && card.value === 'Black')) ? 'opacity-40 grayscale brightness-50' : 'opacity-60 grayscale') : ''}`}
                      />
                      
                      {selectedCardIndex === i && (
                        <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-emerald-500 text-black px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-2xl whitespace-nowrap z-[1001] animate-bounce border-2 border-white/20">
                          Release or Click to Play
                        </div>
                      )}
                    </Reorder.Item>
                  );
                })}
              </AnimatePresence>
              {(!myPlayer?.cards || myPlayer.cards.length === 0) && gameState?.phase === 'PLAYING' && (
                <div className="flex flex-col items-center gap-3 text-neutral-600 py-12">
                  <Trophy className="w-10 h-10 text-emerald-500/20" />
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]">Arsenal Depleted</p>
                </div>
              )}
            </Reorder.Group>
          </div>
        </div>
      </footer>
      )}
        </div>
      )}
    </div>
  );
}
