// One <audio> element plays everything. If a stream errors, never starts, or stops
// moving for ~8 seconds, the player quietly moves on to the next station in the list.
// A station that was playing fine gets one reconnect first (Wi-Fi to cellular handoff).

import { failures, recents, last } from './store.js';
import { reportClick } from './directory.js';

const START_TIMEOUT_MS = 12000;  // time allowed to start (HLS on cellular can be slow)
const STALL_MS = 8000;           // no forward progress for this long = dead or silent
const MAX_SKIPS = 10;            // give up after this many failures in a row

export class Player {
  constructor(audio) {
    this.audio = audio;
    this.queue = []; this.index = 0; this.source = null;
    this.status = 'idle';         // idle | loading | playing | paused | failed
    this.notice = '';             // short message, e.g. "Skipped a station that didn't answer"
    this.wantPlaying = false;
    this.attempt = 0; this.skips = 0; this.reconnects = 0; this.played = false;
    this.listeners = new Set();
    this.onDead = null;           // (station, source) => replacement {queue, index, source, notice} or null
    this.bind();
  }

  get station() { return this.queue[this.index] || null; }
  on(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this); this.updateMediaSession(); }
  set(status, notice) { this.status = status; if (notice !== undefined) this.notice = notice; this.emit(); }

  // Start playing queue[index]. Must be called from a tap the first time (Safari rule).
  play(queue, index = 0, source = null) {
    this.queue = queue; this.index = Math.max(0, Math.min(index, queue.length - 1)); this.source = source;
    this.skips = 0; this.notice = '';
    this.start();
  }

  start() {
    const st = this.station;
    if (!st) { this.set('failed', 'No stations to play here yet.'); return; }
    const id = ++this.attempt;
    this.wantPlaying = true; this.played = false; this.lastTime = -1; this.lastMove = Date.now();
    this.set('loading');
    const a = this.audio;
    a.src = st.url;
    const p = a.play();
    if (p && p.catch) p.catch(err => {
      if (id !== this.attempt) return;
      if (err && err.name === 'NotAllowedError') { this.wantPlaying = false; this.set('paused', 'Tap play to start.'); }
      else if (err && err.name !== 'AbortError') this.fail('play() rejected');
    });
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => { if (id === this.attempt && !this.played && this.wantPlaying) this.fail('start timeout'); }, START_TIMEOUT_MS);
  }

  fail(reason) {
    if (!this.wantPlaying) return;
    const st = this.station; if (!st) return;
    clearTimeout(this.startTimer);
    // Was playing fine, then stopped: probably the network changed. Reconnect once
    // (and again later if it then played steadily for a minute).
    if (this.played && Date.now() - this.playingSince > 60000) this.reconnects = 0;
    if (this.played && this.reconnects < 1 && navigator.onLine !== false) {
      this.reconnects++; this.start(); return;
    }
    if (navigator.onLine === false) { this.set('loading', 'No connection. Will resume when it comes back.'); return; }
    failures.mark(st.id);
    const replacement = this.onDead && this.onDead(st, this.source, reason);
    if (replacement) {
      this.queue = replacement.queue; this.index = replacement.index || 0; this.source = replacement.source;
      this.notice = replacement.notice || ''; this.skips++; this.reconnects = 0;
      if (this.skips < MAX_SKIPS) { this.start(); return; }
    }
    this.skips++;
    if (this.skips >= Math.min(MAX_SKIPS, this.queue.length)) {
      this.wantPlaying = false; this.audio.pause();
      this.set('failed', "Couldn't reach any station here. Check the connection, then tap play.");
      return;
    }
    this.index = (this.index + 1) % this.queue.length; this.reconnects = 0;
    this.notice = `Skipped ${st.name}, it ${this.played ? 'stopped playing' : "didn't play"}.`;
    this.start();
  }

  toggle() { this.wantPlaying ? this.pause() : this.resume(); }
  pause() { this.wantPlaying = false; clearTimeout(this.startTimer); this.audio.pause(); this.set('paused', ''); }
  resume() {
    if (!this.station) return;
    this.skips = 0; this.reconnects = 0;
    this.start(); // live radio: reconnect to "now" instead of resuming old buffered audio
  }
  step(delta) {
    if (!this.queue.length) return;
    this.index = (this.index + delta + this.queue.length) % this.queue.length;
    this.skips = 0; this.reconnects = 0; this.notice = '';
    this.start();
  }
  stop() { this.wantPlaying = false; clearTimeout(this.startTimer); this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.set('idle', ''); }

  bind() {
    const a = this.audio;
    a.addEventListener('playing', () => {
      if (!this.wantPlaying) return;
      const st = this.station;
      clearTimeout(this.startTimer);
      if (!this.played) {
        this.played = true; this.skips = 0; this.playingSince = Date.now();
        failures.clear(st.id); recents.add(st);
        last.set({ station: st, source: this.source });
        if (this.reconnects === 0) reportClick(st.id);
      }
      this.lastMove = Date.now();
      this.set('playing');
    });
    a.addEventListener('error', () => { if (this.wantPlaying && a.getAttribute('src')) this.fail('media error ' + (a.error && a.error.code)); });
    a.addEventListener('pause', () => {
      // Paused from outside the page (lock screen, headphones unplugged, phone call).
      if (this.wantPlaying && this.status === 'playing' && !a.ended) { this.wantPlaying = false; clearTimeout(this.startTimer); this.set('paused', ''); }
    });
    a.addEventListener('timeupdate', () => {
      if (a.currentTime !== this.lastTime) { this.lastTime = a.currentTime; this.lastMove = Date.now(); }
    });
    a.addEventListener('ended', () => this.fail('ended'));
    // Watchdog: playing but the clock hasn't moved for STALL_MS = stalled or dead.
    setInterval(() => {
      if (this.wantPlaying && this.played && Date.now() - this.lastMove > STALL_MS) { this.lastMove = Date.now(); this.fail('stalled'); }
    }, 1000);
    window.addEventListener('online', () => { if (this.wantPlaying) { this.reconnects = 0; this.start(); } });

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const h = (name, fn) => { try { ms.setActionHandler(name, fn); } catch {} };
      h('play', () => this.resume());
      h('pause', () => this.pause());
      h('stop', () => this.pause());
      h('previoustrack', () => this.step(-1));
      h('nexttrack', () => this.step(1));
      h('seekbackward', null); h('seekforward', null); h('seekto', null); // show next/previous, not ±15 s
    }
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const st = this.station, ms = navigator.mediaSession;
    ms.playbackState = this.wantPlaying ? 'playing' : this.status === 'idle' ? 'none' : 'paused';
    if (!st) return;
    const key = st.id + '|' + (this.source && this.source.label);
    if (key === this.msKey) return;
    this.msKey = key;
    try {
      ms.metadata = new MediaMetadata({
        title: st.name,
        artist: (this.source && this.source.label) || 'Car Radio',
        album: 'Car Radio',
        artwork: st.favicon ? [{ src: st.favicon, sizes: '512x512' }] : [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch {}
  }
}
