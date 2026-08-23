/**
 * Synthetic console sounds (concept §7.8: Web Audio, no audio assets).
 *
 * Everything is generated: a relay clack for a switch, a low rumble for
 * ignition, a short beep for telemetry milestones. Browsers refuse to start
 * audio before a user gesture, so the context is created lazily on the first
 * sound a click or keypress causes.
 */

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context !== null) return context;
  if (typeof AudioContext === 'undefined') return null;
  context = new AudioContext();
  return context;
}

/** Resumes a context the browser suspended. Safe to call on every gesture. */
export function unlockAudio(): void {
  const audio = ensureContext();
  if (audio !== null && audio.state === 'suspended') {
    void audio.resume();
  }
}

let muted = false;

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function envelope(
  audio: AudioContext,
  gainValue: number,
  attack: number,
  duration: number,
): GainNode {
  const gain = audio.createGain();
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainValue, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(audio.destination);
  return gain;
}

/** A relay clack: short noise burst through a band-pass. */
export function playSwitchClick(): void {
  const audio = ensureContext();
  if (audio === null || muted) return;

  const length = Math.floor(audio.sampleRate * 0.05);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // Decaying noise: the tail is what makes it a clack and not a tick.
    channel[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;

  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  filter.Q.value = 1.2;

  source.connect(filter);
  filter.connect(envelope(audio, 0.35, 0.001, 0.06));
  source.start();
}

/** Ignition: a low sawtooth swell with noise on top, a couple of seconds long. */
export function playIgnitionRumble(): void {
  const audio = ensureContext();
  if (audio === null || muted) return;
  const now = audio.currentTime;

  const oscillator = audio.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(28, now);
  oscillator.frequency.exponentialRampToValueAtTime(46, now + 1.8);

  const lowPass = audio.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.setValueAtTime(120, now);
  lowPass.frequency.linearRampToValueAtTime(340, now + 1.5);

  oscillator.connect(lowPass);
  lowPass.connect(envelope(audio, 0.5, 0.35, 2.6));
  oscillator.start(now);
  oscillator.stop(now + 2.8);

  const length = Math.floor(audio.sampleRate * 2.6);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    channel[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = audio.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 260;
  noise.connect(noiseFilter);
  noiseFilter.connect(envelope(audio, 0.28, 0.4, 2.6));
  noise.start(now);
}

/** Telemetry beep. `high` marks a milestone, `low` a routine tick. */
export function playBeep(high = false): void {
  const audio = ensureContext();
  if (audio === null || muted) return;

  const oscillator = audio.createOscillator();
  oscillator.type = 'square';
  oscillator.frequency.value = high ? 1180 : 720;
  oscillator.connect(envelope(audio, 0.12, 0.005, high ? 0.18 : 0.09));
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.25);
}

/** Alarm for an off-nominal milestone: two falling tones. */
export function playAlert(): void {
  const audio = ensureContext();
  if (audio === null || muted) return;
  const now = audio.currentTime;

  for (const [index, frequency] of [520, 390].entries()) {
    const oscillator = audio.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    const gain = audio.createGain();
    const start = now + index * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
    gain.connect(audio.destination);
    oscillator.connect(gain);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
}
