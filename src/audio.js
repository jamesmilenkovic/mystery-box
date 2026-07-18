// Synthesized sound effects via the Web Audio API (oscillator/noise nodes)
// — no bundled audio files, no dependency. Not a pure module: it touches
// AudioContext/DOM APIs, so it's covered by manual acceptance testing on
// a real device rather than node --test.
//
// iOS Safari hard constraint: an AudioContext can only be created/resumed
// from directly inside a real user gesture's event handler (synchronously,
// before any `await`). getAudioContext() must therefore be called at the
// very top of the kid's tap handler, not after any async work.

let sharedContext = null;

/**
 * Returns a shared AudioContext, creating and/or resuming it if needed.
 * MUST be called synchronously from within a user gesture handler (e.g.
 * the box tap) for iOS Safari to allow audio to play.
 */
export function getAudioContext() {
  if (!sharedContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    sharedContext = new AudioContextClass();
  }
  if (sharedContext.state === 'suspended') {
    sharedContext.resume();
  }
  return sharedContext;
}

/** Short percussive tick for the suspense rattle. */
export function playTick(ctx) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(320, now);
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.07);
}

/** Short noise-burst "pop" for the box bursting open. */
export function playPop(ctx) {
  const now = ctx.currentTime;
  const bufferSize = Math.floor(ctx.sampleRate * 0.15);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, now);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(now);
}

/** Rising three-note "ta-da" fanfare for the reveal. */
export function playTada(ctx) {
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const start = now + i * 0.11;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.36);
  });
}

/**
 * Vibrates if the device supports it, silently doing nothing otherwise
 * (iOS Safari doesn't expose navigator.vibrate at all — calling it there
 * would throw if not guarded).
 */
export function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // no-op: some browsers report the API but still throw (e.g. denied
      // by a permissions policy) — never let haptics break the reveal.
    }
  }
}
