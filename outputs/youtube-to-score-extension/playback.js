// Plays the engraved score on Score Studio's sampled piano (FluidR3 GM), note
// for note as written. The scheduler is a port of the Kiku AI web app's
// lib/score-playback.ts: samples per pitch, queued a second ahead every 100 ms.

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const midiOf = (p) => 12 * (p.octave + 1) + NATURAL[p.letter] + p.alter;
const RELEASE = 0.2;
// FluidR3's piano samples peak near −21 dB; this lifts them to the loudness of
// mastered music (+16 dB), and a limiter keeps stacked chords from clipping.
const BOOST = 6;

/** Keeps decoded piano samples, one per pitch, for every score played on the page. */
class SampleCache {
  constructor() { this.samples = new Map(); }
  load(context, pitch) {
    const clamped = Math.max(21, Math.min(108, pitch));
    if (!this.samples.has(clamped)) {
      const name = NAMES[clamped % 12] + (Math.floor(clamped / 12) - 1);
      this.samples.set(clamped, fetch(`soundfonts/acoustic_grand_piano-mp3/${name}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error('The piano sounds could not load.');
          return r.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data))
        .catch((err) => { this.samples.delete(clamped); throw err; }));
    }
    return this.samples.get(clamped);
  }
}

/**
 * The notes and bar times of an arranged score. Tied notes sound once, for
 * their whole length; the melody sits a little above the left hand.
 *
 * By default it keeps the written tempo. Given `times` (each bar's {start, end}
 * in the recording), every bar is stretched to when it really sounds, so the
 * sheet can play along with the video it came from.
 */
export function performance(arranged, speed = 1, times = null) {
  const written = 60 / arranged.tempo / (arranged.grid / 4) / speed;
  const notes = [];
  const bars = [];
  const open = new Map();
  let time = 0;
  arranged.measures.forEach((m, i) => {
    const real = times?.[i];
    const start = real ? real.start / speed : time;
    const end = real ? real.end / speed : time + m.length * written;
    time = start;
    const unit = (end - start) / m.length;
    bars.push({start, end});
    m.staves.forEach((items, staff) => {
      for (const item of items) {
        if (item.rest) continue;
        const start = time + item.at * unit;
        const end = start + item.units * unit;
        for (const p of item.pitches) {
          const pitch = midiOf(p);
          const key = `${staff}:${pitch}`;
          const held = item.tieStop && open.get(key);
          if (held) held.end = end;
          else {
            const note = {pitch, start, end, volume: staff ? 0.6 : 1};
            notes.push(note);
            if (item.tieStart) open.set(key, note);
          }
          if (!item.tieStart) open.delete(key);
          else if (held) open.set(key, held);
        }
      }
    });
    time = end;
  });
  // A hair of space before a repeated key, as a pianist would leave.
  for (const n of notes) n.end = Math.max(n.start + 0.05, n.end - Math.min(0.04, (n.end - n.start) * 0.1));
  notes.sort((a, b) => a.start - b.start);
  return {notes, bars, duration: time};
}

/** Plays performances, with play, pause, seek, loop and volume. */
export class SheetPlayer {
  constructor() {
    this.cache = new SampleCache();
    this.context = null;
    this.gain = null;
    this.piece = null;
    this.samples = new Map();
    this.offset = 0;
    this.origin = 0;
    this.playing = false;
    this.loop = false;
    this.volume = 1;
    this.timer = 0;
    this.active = new Set();
    this.onend = null;
  }

  get duration() { return this.piece?.duration ?? 0; }
  get position() {
    return this.playing ? Math.min(this.duration, this.context.currentTime - this.origin) : this.offset;
  }

  /** Swaps in a new performance, keeping the place in it (as a fraction) when it changes length. */
  async load(piece) {
    const fraction = this.duration ? this.position / this.duration : 0;
    const wasPlaying = this.playing;
    this.pause();
    this.piece = piece;
    this.offset = fraction * piece.duration;
    if (wasPlaying) await this.play();
  }

  async play(at = this.offset) {
    if (!this.piece) return;
    this.context ??= new AudioContext();
    if (!this.gain) {
      // notes → volume slider → boost → limiter → speakers
      this.gain = this.context.createGain();
      const boost = this.context.createGain();
      boost.gain.value = BOOST;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      this.gain.connect(boost);
      boost.connect(limiter);
      limiter.connect(this.context.destination);
    }
    this.gain.gain.value = this.volume;
    await this.context.resume();
    const pitches = [...new Set(this.piece.notes.map((n) => n.pitch))].filter((p) => !this.samples.has(p));
    await Promise.all(pitches.map(async (p) => this.samples.set(p, await this.cache.load(this.context, p))));
    this.stopSources();
    this.offset = Math.max(0, Math.min(at, this.duration - 0.001));
    this.origin = this.context.currentTime - this.offset;
    this.playing = true;
    let index = 0;
    while (index < this.piece.notes.length && this.piece.notes[index].end + RELEASE <= this.offset) index++;
    const notes = this.piece.notes;
    const tick = () => {
      const ctx = this.context;
      const now = ctx.currentTime;
      const position = now - this.origin;
      while (index < notes.length && notes[index].start < position + 1) {
        const note = notes[index++];
        const sample = this.samples.get(note.pitch);
        const elapsed = Math.max(0, position - note.start);
        if (!sample || note.end + RELEASE <= position || elapsed >= sample.duration) continue;
        const source = ctx.createBufferSource();
        const envelope = ctx.createGain();
        source.buffer = sample;
        const when = Math.max(now, this.origin + note.start);
        const end = this.origin + note.end;
        envelope.gain.setValueAtTime(note.volume, when);
        if (end > when) envelope.gain.setValueAtTime(note.volume, end);
        envelope.gain.linearRampToValueAtTime(0, Math.max(when + 0.001, end + RELEASE));
        source.connect(envelope);
        envelope.connect(this.gain);
        this.active.add(source);
        source.onended = () => { this.active.delete(source); source.disconnect(); envelope.disconnect(); };
        source.start(when, elapsed);
        source.stop(Math.max(when + 0.001, end + RELEASE));
      }
      if (position >= this.duration) {
        this.stopSources();
        this.playing = false;
        this.offset = 0;
        if (this.loop) this.play(0);
        else this.onend?.();
      }
    };
    clearInterval(this.timer);
    this.timer = setInterval(tick, 100);
    tick();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.playing = false;
    this.stopSources();
  }

  seek(at) {
    if (this.playing) this.play(at);
    else this.offset = Math.max(0, Math.min(at, this.duration));
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }

  stopSources() {
    clearInterval(this.timer);
    for (const source of this.active) { try { source.stop(); } catch {} }
    this.active.clear();
  }
}
