import { useSyncExternalStore } from 'react';

/**
 * Delegate's notification sound (public/sounds/delegate-notification.mp3: a doorbell "ding-dong",
 * trimmed and levelled for notifications). It plays when news arrives — a new task, a message on a
 * task, a blocker ping, an audit. People can switch it off in the avatar menu; the choice is kept per browser.
 *
 * Browsers only allow sound after someone has clicked or typed on the page, so the audio is
 * unlocked on the first interaction and the file is decoded once.
 */

const KEY = 'delegate.sound';
const SRC = '/sounds/delegate-notification.mp3';
const listeners = new Set<() => void>();

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: the setting lasts until the page reloads */
  }
  memory = on;
  listeners.forEach((l) => l());
  if (on) void playNotificationSound({ force: true });
}

let memory: boolean | null = null;
export function useSoundOn() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => memory ?? soundOn(),
    () => true,
  );
}

let ctx: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function load(ac: AudioContext) {
  buffer ??= fetch(SRC)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => ac.decodeAudioData(data))
    .catch(() => {
      buffer = null; // try again next time
      return null;
    });
  return buffer;
}

/** Call once: the first click/tap/key on the page unlocks audio and preloads the sound. */
export function primeSound() {
  const unlock = () => {
    const ac = audio();
    if (!ac) return;
    void ac.resume().catch(() => {});
    void load(ac);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export async function playNotificationSound(opts: { force?: boolean } = {}) {
  if (!opts.force && !(memory ?? soundOn())) return;
  // Marks that the chime was due (tests and debugging read it; harmless otherwise).
  document.documentElement.dataset.notifySound = String(Date.now());
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') await ac.resume();
    const buf = await load(ac);
    if (!buf || ac.state !== 'running') return;
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    src.buffer = buf;
    src.connect(gain).connect(ac.destination);
    src.start();
  } catch {
    /* no audio device, or the browser said no: stay silent */
  }
}
