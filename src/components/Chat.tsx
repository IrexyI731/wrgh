import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Send, X } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface ChatMessage {
  id: string;
  username: string;
  seat: string;
  message: string;
  time: number;
  channel?: 'global' | 'team';
}

interface ChatProps {
  socket: Socket | null;
  roomCode: string;
  playerName: string;
  isHost: boolean;
  onNewMessage?: () => void;
  onChatMessage?: (msg: ChatMessage) => void;
}

const Chat: React.FC<ChatProps> = ({ socket, roomCode, playerName, isHost, onNewMessage, onChatMessage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'global' | 'team'>('global');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [typingStatus, setTypingStatus] = useState<{ seat: string, channel?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const onChatMessageRef = useRef(onChatMessage);
  const onNewMessageRef = useRef(onNewMessage);

  useEffect(() => {
    onChatMessageRef.current = onChatMessage;
    onNewMessageRef.current = onNewMessage;
  }, [onChatMessage, onNewMessage]);

  useEffect(() => {
    if (!socket || !roomCode || !playerName) return;

    const handleMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev.slice(-49), msg]);
      if (onNewMessageRef.current) onNewMessageRef.current();
      if (onChatMessageRef.current) onChatMessageRef.current(msg);
    };

    const handleDeleteMessage = (messageId: string) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    };

    const handleTyping = ({ seat, isTyping, channel }: { seat: string, isTyping: boolean, channel?: string }) => {
      if (isTyping) {
        setTypingStatus({ seat, channel });
      } else {
        setTypingStatus(null);
      }
    };

    const handleChatCleared = () => {
      setMessages([]);
    };

    socket.on('chatMessage', handleMessage);
    socket.on('deleteChatMessage', handleDeleteMessage);
    socket.on('typing', handleTyping);
    socket.on('chatCleared', handleChatCleared);

    // Initial join message
    socket.emit('playerJoinedChat', { roomCode, playerName });

    return () => {
      socket.off('chatMessage', handleMessage);
      socket.off('deleteChatMessage', handleDeleteMessage);
      socket.off('typing', handleTyping);
      socket.off('chatCleared', handleChatCleared);
      socket.emit('playerLeftChat', { roomCode, playerName });
    };
  }, [socket, roomCode, playerName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingStatus]);

  const handleSend = () => {
    if (!inputValue.trim() || !socket) return;
    socket.emit('chatMessage', { roomCode, message: inputValue.trim(), channel: activeTab });
    setInputValue('');
    socket.emit('typing', { roomCode, isTyping: false, channel: activeTab });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (!socket) return;

    socket.emit('typing', { roomCode, isTyping: true, channel: activeTab });
    
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { roomCode, isTyping: false, channel: activeTab });
    }, 2000);
  };

  const getSeatColor = (seat: string) => {
    switch (seat) {
      case 'P1': return 'text-red-500';
      case 'P2': return 'text-blue-500';
      case 'P3': return 'text-green-500';
      case 'P4': return 'text-yellow-500';
      case 'SYS': return 'text-neutral-500 italic';
      default: return 'text-white';
    }
  };

  const filteredMessages = messages.filter(msg => {
    if (msg.seat === 'SYS') return true;
    if (activeTab === 'global') return msg.channel === 'global' || !msg.channel;
    if (activeTab === 'team') return msg.channel === 'team';
    return true;
  });

  return (
    <div className="fixed bottom-8 right-8 z-[100] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="mb-4 w-80 h-96 bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex flex-col border-b border-white/5 bg-white/5">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-xs font-black uppercase tracking-widest">Table Chat</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X className="w-4 h-4 text-neutral-500" />
                  </button>
                </div>
              </div>
              <div className="flex px-4 gap-4">
                <button
                  onClick={() => setActiveTab('global')}
                  className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${
                    activeTab === 'global' ? 'border-emerald-500 text-emerald-500' : 'border-transparent text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Global
                </button>
                <button
                  onClick={() => setActiveTab('team')}
                  className={`pb-2 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${
                    activeTab === 'team' ? 'border-emerald-500 text-emerald-500' : 'border-transparent text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Team
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
              {filteredMessages.map((msg) => (
                <div key={`${msg.id}-${msg.time}`} className="flex flex-col group">
                  <div className="flex items-baseline gap-2 justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[10px] font-black uppercase ${getSeatColor(msg.seat)}`}>
                        {msg.seat === 'P1' || msg.seat === 'P4' ? msg.username : msg.seat}
                      </span>
                      {msg.seat !== 'P1' && msg.seat !== 'P4' && (
                        <span className="text-[10px] font-bold text-white/40">
                          {msg.username}
                        </span>
                      )}
                    </div>
                    {msg.username === playerName && (
                      <button
                        onClick={() => socket?.emit('deleteChatMessage', { roomCode, messageId: msg.id })}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-400 transition-opacity"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-white/90 leading-relaxed break-words">
                    {msg.message}
                  </p>
                </div>
              ))}
              {typingStatus && (typingStatus.channel === activeTab || (!typingStatus.channel && activeTab === 'global')) && (
                <div className="text-[10px] italic text-neutral-500 animate-pulse">
                  {typingStatus.seat} is typing...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 bg-white/5 border-t border-white/5 flex flex-col gap-2">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1">
                {['👍', '👎', '♠️', '♥️', '♦️', '♣️'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setInputValue(prev => prev + emoji)}
                    className="p-1.5 hover:bg-white/10 rounded-lg text-lg transition-colors flex-shrink-0"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="relative flex items-center gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Type a message..."
                  className="flex-1 bg-neutral-800 border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <button
                  onClick={handleSend}
                  className="p-2 bg-emerald-500 text-neutral-950 rounded-xl hover:bg-emerald-400 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-neutral-900 border border-white/10 rounded-full flex items-center justify-center shadow-2xl text-emerald-500 hover:text-emerald-400 transition-colors relative"
      >
        <MessageSquare className="w-6 h-6" />
        {!isOpen && messages.length > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-neutral-950 text-[10px] font-black rounded-full flex items-center justify-center border-2 border-neutral-900">
            {messages.length}
          </div>
        )}
      </motion.button>
    </div>
  );
};

export default Chat;
