import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type AudioApi = {
  soundEnabled: boolean;
  ambientEnabled: boolean;
  toggleSound: () => void;
  toggleAmbient: () => void;
  unlock: () => void;
  playDomino: () => void;
  playShuffle: () => void;
  playScore: () => void;
};

const AudioContext = createContext<AudioApi | null>(null);
let sharedContext: globalThis.AudioContext | null = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  if (!sharedContext) {
    const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Constructor) sharedContext = new Constructor();
  }
  return sharedContext;
}

function makeNoise(context: AudioContext, duration: number, gainValue: number, filterFrequency: number) {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = filterFrequency;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(gainValue, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  source.stop(context.currentTime + duration);
  window.setTimeout(() => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  }, duration * 1000 + 80);
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const enabledRef = useRef(soundEnabled);
  const ambientCleanupRef = useRef<(() => void) | null>(null);
  enabledRef.current = soundEnabled;

  const unlock = () => {
    const context = getContext();
    if (context?.state === 'suspended') void context.resume();
  };

  useEffect(() => {
    const handleFirstTap = () => unlock();
    document.addEventListener('pointerdown', handleFirstTap, { once: true, passive: true });
    return () => document.removeEventListener('pointerdown', handleFirstTap);
  }, []);

  useEffect(() => {
    ambientCleanupRef.current?.();
    ambientCleanupRef.current = null;
    if (!ambientEnabled || !soundEnabled) return;

    const context = getContext();
    if (!context) return;
    unlock();

    const master = context.createGain();
    const lowpass = context.createBiquadFilter();
    const hum = context.createOscillator();
    const harmony = context.createOscillator();
    const humGain = context.createGain();
    const harmonyGain = context.createGain();
    const chatterBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const chatterData = chatterBuffer.getChannelData(0);
    for (let index = 0; index < chatterData.length; index += 1) {
      chatterData[index] = (Math.random() * 2 - 1) * 0.35;
    }
    const chatter = context.createBufferSource();
    const chatterGain = context.createGain();

    master.gain.value = 0.035;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1250;
    lowpass.Q.value = 0.6;
    hum.type = 'sine';
    hum.frequency.value = 196;
    harmony.type = 'triangle';
    harmony.frequency.value = 247;
    humGain.gain.value = 0.34;
    harmonyGain.gain.value = 0.16;
    chatter.buffer = chatterBuffer;
    chatter.loop = true;
    chatterGain.gain.value = 0.045;

    hum.connect(humGain).connect(lowpass);
    harmony.connect(harmonyGain).connect(lowpass);
    chatter.connect(chatterGain).connect(lowpass);
    lowpass.connect(master).connect(context.destination);
    hum.start();
    harmony.start();
    chatter.start();

    const cleanup = () => {
      hum.stop();
      harmony.stop();
      chatter.stop();
      [hum, harmony, chatter, humGain, harmonyGain, chatterGain, lowpass, master].forEach((node) => node.disconnect());
    };
    ambientCleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (ambientCleanupRef.current === cleanup) ambientCleanupRef.current = null;
    };
  }, [ambientEnabled, soundEnabled]);

  const api = useMemo<AudioApi>(() => ({
    soundEnabled,
    ambientEnabled,
    unlock,
    toggleSound: () => {
      unlock();
      setSoundEnabled((value) => !value);
    },
     toggleAmbient: () => {
       unlock();
       setAmbientEnabled((value) => !value);
     },
    playDomino: () => {
      const context = getContext();
      if (!enabledRef.current || !context) return;
      unlock();
       makeNoise(context, 0.1, 0.2, 1800);
    },
    playShuffle: () => {
      const context = getContext();
      if (!enabledRef.current || !context) return;
      unlock();
      [0, 0.08, 0.16, 0.25, 0.35].forEach((offset, index) => {
        window.setTimeout(() => {
           if (enabledRef.current) makeNoise(context, 0.09, 0.08, 3600 + index * 180);
        }, offset * 1000);
      });
    },
    playScore: () => {
      const context = getContext();
      if (!enabledRef.current || !context) return;
      unlock();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(990, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
      window.setTimeout(() => {
        oscillator.disconnect();
        gain.disconnect();
      }, 300);
    },
  }), [ambientEnabled, soundEnabled]);

  return <AudioContext.Provider value={api}>{children}</AudioContext.Provider>;
}

export function useTableAudio() {
  const value = useContext(AudioContext);
  if (!value) throw new Error('useTableAudio must be used inside AudioProvider');
  return value;
}