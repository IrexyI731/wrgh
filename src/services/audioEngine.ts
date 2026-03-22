// /src/services/audioEngine.ts

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

const playTone = (freq: number, type: OscillatorType, duration: number, volume: number = 0.1) => {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
};

const playNoise = (duration: number, volume: number = 0.05) => {
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
  
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  
  noise.start();
};

export const playProceduralSound = (type: string) => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  switch (type) {
    case 'card':
      // Card tap: a short burst of noise for paper texture, plus a low frequency thump
      playNoise(0.05, 0.02);
      playTone(150, 'sine', 0.05, 0.05);
      break;
    case 'click':
    case 'select':
    case 'turn':
      playTone(440, 'sine', 0.1, 0.1);
      break;
    case 'hover':
    case 'slider':
      playTone(880, 'sine', 0.05, 0.05);
      break;
    case 'winTrick':
    case 'success':
    case 'gameWin':
      playTone(523.25, 'triangle', 0.2);
      playTone(659.25, 'triangle', 0.2);
      break;
    case 'bound':
    case 'openMenu':
    case 'back':
      playNoise(0.3, 0.05);
      break;
    case 'reverseBound':
    case 'closeMenu':
      playNoise(0.2, 0.03);
      break;
    case 'voting':
    case 'notification':
      playTone(600, 'sine', 0.15);
      break;
    case 'error':
    case 'gameLoss':
      playTone(200, 'square', 0.3, 0.05);
      break;
    case 'toggleOn':
      playTone(500, 'sine', 0.1);
      break;
    case 'toggleOff':
      playTone(300, 'sine', 0.1);
      break;
    case 'switchTab':
      playTone(400, 'sine', 0.1);
      break;
    case 'bid':
      playTone(550, 'sine', 0.15);
      break;
    case 'round':
      playTone(700, 'triangle', 0.3);
      break;
    default:
      break;
  }
};
