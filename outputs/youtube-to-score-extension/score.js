// Turns SheetSage2's ABC into sheet music a pianist expects: the melody over a
// left hand written from the chords (or a one-staff lead sheet), as MusicXML
// with beat-grouped rhythms, beams, ties, accidentals and chord symbols.

// ---- reading the native dialect -------------------------------------------
// A port of parseNative in the Kiku AI web app (outputs/kiku-ai/lib/engrave.ts),
// which follows the engine's abc_tools.py. It rejects anything else.

const TOKEN = /"([^"\n]*)"|\[K:([^\]\n]+)\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)(\d*)(-?)/y;
const LETTERS = 'CDEFGAB';
const NATURAL = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const ALTER = {'=': 0, _: -1, __: -2, '^': 1, '^^': 2};
const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
const VOICE_DEFS = ['V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."'];

const fail = (message) => { throw new Error(`Not a SheetSage2 score: ${message}`); };

function fifthsOf(key) {
  const index = Math.max(MAJOR.indexOf(key), MINOR.indexOf(key));
  if (index < 0) fail(`key ${key}`);
  return index - 7;
}

function signature(fifths) {
  const result = {C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0};
  for (const letter of (fifths > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0, Math.abs(fifths))) result[letter] = fifths > 0 ? 1 : -1;
  return result;
}

function meterOf(text) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(text.trim());
  if (!match) fail(`meter ${text}`);
  return [Number(match[1]), Number(match[2])];
}

function parseBar(body, voice, grid, bars) {
  const [n, d] = voice.meter;
  const length = n * grid / d;
  if (!Number.isInteger(length)) fail('meter does not fit the grid');
  const start = voice.time;
  const local = {};
  if (bars) bars.push({start, length, meter: voice.meter, key: voice.key, sections: []});
  let offset = 0;
  if (body === 'Z') {
    if (voice.pending) fail('tie into a rest');
    offset = length;
  } else {
    for (let cursor = 0; cursor < body.length;) {
      if (/\s/.test(body[cursor])) { cursor++; continue; }
      TOKEN.lastIndex = cursor;
      const match = TOKEN.exec(body);
      if (!match) fail(`token at ${body.slice(cursor, cursor + 12)}`);
      cursor = TOKEN.lastIndex;
      const [, chord, key, acc, name, marks, count, tie] = match;
      if (chord !== undefined) { voice.chords.push([start + offset, chord]); continue; }
      if (key !== undefined) {
        fifthsOf(key);
        voice.key = key;
        voice.keys.push([start + offset, key]);
        for (const letter in local) delete local[letter];
        continue;
      }
      const units = Number(count || 1);
      if (offset + units > length) fail('bar too long');
      if (name === 'z') {
        if (voice.pending) fail('tie into a rest');
        offset += units;
        continue;
      }
      const letter = name.toUpperCase();
      const octave = (name === letter ? 0 : 1) + [...marks].filter((c) => c === "'").length - [...marks].filter((c) => c === ',').length;
      const written = 60 + NATURAL[letter] + 12 * octave;
      // The native dialect carries an accidental to that letter in every octave of the bar.
      let alt = local[letter] ?? signature(fifthsOf(voice.key))[letter];
      if (acc) { alt = ALTER[acc]; local[letter] = alt; }
      let pitch = written + alt;
      if (voice.pending) {
        // An unmarked continuation keeps its tied accidental across a bar line.
        if (!acc && written === voice.pending.written) pitch = voice.pending.pitch;
        if (pitch !== voice.pending.pitch) fail('tie changes pitch');
        voice.notes[voice.notes.length - 1].units += units;
      } else {
        voice.notes.push({start: start + offset, units, letter, octave, alt: pitch - written, pitch});
      }
      voice.pending = tie ? {pitch, written} : null;
      offset += units;
    }
  }
  if (offset !== length) fail('bar too short');
  voice.time += length;
}

/** Reads SheetSage2's ABC into bars, two voices of notes, chord symbols and keys. */
export function readScore(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 12 || lines[0] !== 'X:1' || !lines[1].startsWith('T:') || !lines[2].startsWith('M:')) fail('header');
  const unit = /^L:1\/(\d+)$/.exec(lines[3]);
  const tempo = /^Q:1\/4=(\d+)$/.exec(lines[4]);
  if (!unit || !tempo || lines[5] !== VOICE_DEFS[0] || lines[6] !== VOICE_DEFS[1] || !lines[7].startsWith('K:')) fail('header');
  const grid = Number(unit[1]);
  const meter = meterOf(lines[2].slice(2));
  const key = lines[7].slice(2).trim();
  if (grid < 4 || grid > 1024 || (grid & (grid - 1)) || Number(tempo[1]) < 1) fail('grid or tempo');
  fifthsOf(key);
  const make = () => ({meter, key, time: 0, notes: [], chords: [], keys: [[0, key]], pending: null});
  const vocal = make();
  const ins = make();
  const bars = [];
  let cursor = 8;
  while (cursor < lines.length) {
    const sections = [];
    while (cursor < lines.length && lines[cursor].startsWith('%')) sections.push(lines[cursor++].replace(/^%\s*/, ''));
    if (cursor >= lines.length) fail('section without music');
    const first = bars.length;
    for (const [name, voice] of [['Vocal', vocal], ['Ins', ins]]) {
      if (lines[cursor]?.trim() !== `V: ${name}`) fail(`expected V: ${name}`);
      cursor++;
      while (cursor < lines.length && /^[MK]:/.test(lines[cursor])) {
        const value = lines[cursor].slice(2).trim();
        if (lines[cursor][0] === 'M') voice.meter = meterOf(value);
        else { fifthsOf(value); voice.key = value; voice.keys.push([voice.time, value]); }
        cursor++;
      }
      const line = lines[cursor++]?.trim();
      if (!line?.endsWith('|')) fail('music line');
      for (const raw of line.slice(0, -1).split('|')) {
        const body = raw.trim();
        const rest = /^Z([2-4])?$/.exec(body);
        if (!body) fail('empty bar');
        for (let i = 0; i < (rest ? Number(rest[1] || 1) : 1); i++) parseBar(rest ? 'Z' : body, voice, grid, name === 'Vocal' ? bars : null);
      }
    }
    if (vocal.time !== ins.time) fail('voices differ in length');
    if (bars[first]) bars[first].sections = sections;
  }
  if (vocal.pending || ins.pending) fail('unresolved tie');
  if (!bars.length || bars.length > 1000) fail('score length');
  // A key change written at the very start of a bar belongs to that bar.
  for (const bar of bars) bar.key = vocal.keys.filter(([t]) => t <= bar.start).pop()[1];
  return {grid, tempo: Number(tempo[1]), bars, vocal, ins};
}

/** The pickup length SheetSage2 padded into bar 1, in grid units, from result.json's diagnostics. */
export function pickupUnits(diagnostics, grid) {
  for (const line of diagnostics || []) {
    const match = /^measure 0: padded leading (\d+)\/(\d+) span/.exec(line);
    if (match) return Number(match[1]) * grid / Number(match[2]);
  }
  return 0;
}

// ---- pitches, keys and chords ----------------------------------------------

const midiOf = ({letter, alter, octave}) => 12 * (octave + 1) + NATURAL[letter] + alter;
const pcOf = ({letter, alter}) => (((NATURAL[letter] + alter) % 12) + 12) % 12;

/** A spelled pitch moved by `steps` letters and `semitones`. */
function move(pitch, steps, semitones) {
  const index = LETTERS.indexOf(pitch.letter) + steps;
  const letter = LETTERS[((index % 7) + 7) % 7];
  const octave = (pitch.octave ?? 4) + Math.floor(index / 7);
  const target = midiOf({octave: 4, alter: 0, ...pitch}) + semitones;
  return {letter, octave, alter: target - midiOf({letter, octave, alter: 0})};
}

function parseKey(key) {
  const match = /^([A-G])([#b]?)(m?)$/.exec(key);
  return {letter: match[1], alter: match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0, minor: !!match[3]};
}

function keyName({letter, alter}, minor) {
  return letter + (alter === 1 ? '#' : alter === -1 ? 'b' : alter ? '?' : '') + (minor ? 'm' : '');
}

/** The key on this pitch class with the fewest accidentals. */
function simplestKey(pc, minor) {
  return (minor ? MINOR : MAJOR).filter((k) => pcOf(parseKey(k)) === pc)
    .sort((a, b) => Math.abs(fifthsOf(a)) - Math.abs(fifthsOf(b)))[0];
}

/** The key with this tonic, or its enharmonic twin when that one does not exist. */
function nearestKey(tonic, minor) {
  const name = keyName(tonic, minor);
  return (minor ? MINOR : MAJOR).includes(name) ? name : simplestKey(pcOf(tonic), minor);
}

/** The letter steps that move a whole score by `semitones` into the simplest new key. */
function transposition(key, semitones) {
  if (!semitones) return {steps: 0, semitones: 0};
  const from = parseKey(key);
  const to = parseKey(simplestKey((pcOf(from) + semitones + 120) % 12, from.minor));
  let steps = (LETTERS.indexOf(to.letter) - LETTERS.indexOf(from.letter) + 7) % 7;
  if (semitones < 0 && steps > 0) steps -= 7;
  return {steps, semitones};
}

function moveKey(key, shift) {
  if (!shift.semitones) return key;
  const tonic = parseKey(key);
  const moved = move({...tonic, octave: 4}, shift.steps, shift.semitones);
  return nearestKey(moved, tonic.minor);
}

const SCALE = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 11]};

/** The spelled notes of a key's scale; minor keys include the raised seventh. */
function scaleOf(key) {
  const tonic = parseKey(key);
  return SCALE[tonic.minor ? 'minor' : 'major'].map((semi, step) => {
    const p = move({...tonic, octave: 4}, step, semi);
    return `${p.letter}${p.alter}`;
  });
}

/** Names a pitch class the way this key would: in its scale, natural, then by the key's side. */
function spell(pc, key) {
  const candidates = [];
  for (const letter of LETTERS) for (const alter of [-1, 0, 1]) if (pcOf({letter, alter}) === pc) candidates.push({letter, alter});
  const scale = scaleOf(key);
  const inScale = candidates.find((c) => scale.includes(`${c.letter}${c.alter}`));
  if (inScale) return inScale;
  const natural = candidates.find((c) => c.alter === 0);
  if (natural) return natural;
  const fifths = fifthsOf(key);
  const side = fifths > 0 || (fifths === 0 && pc === 6) ? 1 : -1;
  return candidates.find((c) => c.alter === side) || candidates[0];
}

/** A pitch with a double or triple sharp or flat (transposing makes them) respelled the way the key would. */
function plain(p, key) {
  if (Math.abs(p.alter) < 2) return p;
  const m = midiOf(p);
  const spelled = spell(((m % 12) + 12) % 12, key);
  return {...p, letter: spelled.letter, alter: spelled.alter, octave: (m - NATURAL[spelled.letter] - spelled.alter) / 12 - 1};
}

// Every chord quality SheetSage2 writes (abc_tools.QUALITIES), as MusicXML kinds
// and as spelled tones: [semitones above the root, letter steps above the root].
const QUALITIES = {
  '': {kind: 'major', text: '', tones: [[0, 0], [4, 2], [7, 4]]},
  m: {kind: 'minor', text: 'm', tones: [[0, 0], [3, 2], [7, 4]]},
  dim: {kind: 'diminished', text: 'dim', tones: [[0, 0], [3, 2], [6, 4]]},
  aug: {kind: 'augmented', text: 'aug', tones: [[0, 0], [4, 2], [8, 4]]},
  7: {kind: 'dominant', text: '7', tones: [[0, 0], [4, 2], [7, 4], [10, 6]]},
  maj7: {kind: 'major-seventh', text: 'maj7', tones: [[0, 0], [4, 2], [7, 4], [11, 6]]},
  m7: {kind: 'minor-seventh', text: 'm7', tones: [[0, 0], [3, 2], [7, 4], [10, 6]]},
  dim7: {kind: 'diminished-seventh', text: 'dim7', tones: [[0, 0], [3, 2], [6, 4], [9, 6]]},
  m7b5: {kind: 'half-diminished', text: 'm7b5', tones: [[0, 0], [3, 2], [6, 4], [10, 6]]},
  sus4: {kind: 'suspended-fourth', text: 'sus4', tones: [[0, 0], [5, 3], [7, 4]]},
  sus2: {kind: 'suspended-second', text: 'sus2', tones: [[0, 0], [2, 1], [7, 4]]},
  6: {kind: 'major-sixth', text: '6', tones: [[0, 0], [4, 2], [7, 4], [9, 5]]},
  m6: {kind: 'minor-sixth', text: 'm6', tones: [[0, 0], [3, 2], [7, 4], [9, 5]]},
  '7sus4': {kind: 'suspended-fourth', text: '7sus4', tones: [[0, 0], [5, 3], [7, 4], [10, 6]]},
  'm(maj7)': {kind: 'major-minor', text: 'm(maj7)', tones: [[0, 0], [3, 2], [7, 4], [11, 6]]},
};
const CHORD = /^([A-G])(bb|##|b|#)?(m\(maj7\)|7sus4|maj7|m7b5|dim7|sus4|sus2|aug|dim|m6|m7|6|7|m)?(?:\/([A-G])(bb|##|b|#)?)?$/;
const ACCIDENTAL = {bb: -2, b: -1, '': 0, '#': 1, '##': 2};

/** Reads a chord symbol, moves it, and spells it for the key it sits in. */
function readChord(symbol, key, shift) {
  const match = CHORD.exec(symbol.trim());
  if (!match) return null;
  const [, letter, acc = '', quality = '', bassLetter, bassAcc = ''] = match;
  const respell = (l, a) => spell(pcOf(move({letter: l, alter: ACCIDENTAL[a], octave: 4}, shift.steps, shift.semitones)), key);
  const root = respell(letter, acc);
  const bass = bassLetter ? respell(bassLetter, bassAcc) : null;
  const {kind, text, tones} = QUALITIES[quality];
  const spelled = tones.map(([semi, steps]) => {
    const p = plain(move({...root, octave: 4}, steps, semi), key);
    return {letter: p.letter, alter: p.alter, steps};
  });
  return {root, bass, kind, text, tones: spelled, symbol};
}

const chordLabel = (c) => {
  const name = ({letter, alter}) => letter + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter));
  return name(c.root) + c.text + (c.bass ? `/${name(c.bass)}` : '');
};

// ---- rhythm ---------------------------------------------------------------

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
/** A length written as one note: plain or dotted. */
const drawable = (units) => isPow2(units) || (units % 3 === 0 && isPow2(units / 3));

function meterInfo([n, d], grid) {
  const compound = d === 8 && n % 3 === 0 && n > 3;
  let beat = compound ? 3 * grid / 8 : grid / d;
  const length = n * grid / d;
  if (!Number.isInteger(beat) || beat < 1) beat = length;
  // Eighth notes beam by the beat, except in short x/8 bars, which beam whole.
  const group = d === 8 && !compound ? (n <= 3 ? length : 3 * grid / 8) : beat;
  const middle = (n === 4 && d === 4) || (n === 12 && d === 8) ? 2 * beat : 0;
  return {beat, group, middle, compound, length};
}

/**
 * Splits a note or rest so it reads by the beat: one that starts off the beat
 * stops at the next beat, and in 4/4 only a note from the downbeat crosses the
 * middle of the bar. Notes may be dotted; rests only within a beat, or in
 * compound time.
 */
function pieces(position, units, {beat, middle, compound}, rest) {
  const out = [];
  while (units > 0) {
    let take = units;
    if (position % beat) take = Math.min(take, beat - (position % beat));
    else if (middle && position && position < middle && position + take > middle) take = middle - position;
    const ok = (u) => rest && !compound ? isPow2(u) || (u < beat && drawable(u)) : drawable(u);
    while (!ok(take)) take--;
    out.push(take);
    position += take;
    units -= take;
  }
  return out;
}

const TYPES = {1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th', 128: '128th'};

function valueOf(units, grid) {
  const dots = isPow2(units) ? 0 : 1;
  const base = dots ? units * 2 / 3 : units;
  const denominator = grid / base;
  return {type: TYPES[denominator] || 'whole', dots, beams: denominator >= 8 ? Math.log2(denominator) - 2 : 0};
}

function beam(items, info, offset) {
  let run = [];
  let group = -1;
  const flush = () => {
    if (run.length > 1) {
      const deepest = Math.max(...run.map((item) => item.value.beams));
      for (let level = 1; level <= deepest; level++) {
        run.forEach((item, i) => {
          if (item.value.beams < level) return;
          const before = i > 0 && run[i - 1].value.beams >= level;
          const after = i < run.length - 1 && run[i + 1].value.beams >= level;
          item.beams[level] = before && after ? 'continue' : before ? 'end' : after ? 'begin' : i === 0 ? 'forward hook' : 'backward hook';
        });
      }
    }
    run = [];
  };
  for (const item of items) {
    const g = Math.floor((offset + item.at) / info.group);
    if (item.rest || !item.value.beams || g !== group) flush();
    if (!item.rest && item.value.beams) {
      group = g;
      run.push(item);
    }
  }
  flush();
}

const ACCIDENTAL_NAMES = {[-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'};

/**
 * Shows an accidental whenever the key and earlier notes of the bar would
 * read the note differently, in its own octave or (as a courtesy) in another.
 * A note tied over the bar line shows none and does not carry one.
 */
function accidentals(items, fifths) {
  const sig = signature(fifths);
  const byOctave = new Map();
  const byLetter = new Map();
  for (const item of items) {
    for (const p of item.pitches) {
      if (item.tieStop) continue;
      const natural = sig[p.letter];
      const id = p.letter + p.octave;
      const needed = p.alter !== (byOctave.get(id) ?? natural) || p.alter !== (byLetter.get(p.letter) ?? natural);
      if (needed) p.accidental = ACCIDENTAL_NAMES[p.alter];
      byOctave.set(id, p.alter);
      byLetter.set(p.letter, p.alter);
    }
  }
}

/** Events of one staff in one measure → written notes and rests. */
function notate(events, measure, grid) {
  const info = meterInfo(measure.meter, grid);
  const sorted = events.filter((e) => e.units > 0).sort((a, b) => a.at - b.at);
  if (!sorted.some((e) => e.pitches.length)) {
    if (!measure.implicit) return [{at: 0, units: measure.length, rest: true, whole: true, pitches: [], beams: {}}];
    sorted.length = 0;
  }
  const filled = [];
  let at = 0;
  for (const e of sorted) {
    if (e.at > at) filled.push({at, units: e.at - at, pitches: []});
    filled.push(e);
    at = e.at + e.units;
  }
  if (at < measure.length) filled.push({at, units: measure.length - at, pitches: []});
  const merged = [];
  for (const e of filled) {
    const last = merged[merged.length - 1];
    if (last && !last.pitches.length && !e.pitches.length) last.units += e.units;
    else merged.push({...e});
  }
  const items = [];
  for (const e of merged) {
    const rest = !e.pitches.length;
    const parts = pieces(measure.offset + e.at, e.units, info, rest);
    let position = e.at;
    parts.forEach((units, k) => {
      items.push({
        at: position, units, rest, beams: {}, value: valueOf(units, grid),
        pitches: e.pitches.map((p) => ({...p})),
        tieStop: !rest && (k > 0 || !!e.tieIn),
        tieStart: !rest && (k < parts.length - 1 || !!e.tieOut),
      });
      position += units;
    });
  }
  beam(items, info, measure.offset);
  accidentals(items, measure.key.fifths);
  return items;
}

// ---- arranging --------------------------------------------------------------

/** Octaves that move a part into a range, weighted by how long notes sound outside it. */
function octaveShift(notes, low, high) {
  let best = 0;
  let cost = Infinity;
  for (const k of [0, 1, -1, 2, -2]) {
    const c = notes.reduce((sum, n) => {
      const p = n.pitch + 12 * k;
      return sum + (p < low ? low - p : p > high ? p - high : 0) * n.units;
    }, 0);
    if (c < cost) { best = k; cost = c; }
  }
  return best;
}

/** Treble for most melodies, treble-8 for low voices, bass below that. */
function clefFor(pitches) {
  if (!pitches.length) return {sign: 'G', line: 2};
  const sorted = [...pitches].sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  return middle >= 59 ? {sign: 'G', line: 2} : middle >= 47 ? {sign: 'G', line: 2, octave: -1} : {sign: 'F', line: 4};
}

function place(pc, low, high) {
  for (let octave = 0; octave <= 8; octave++) {
    const m = midiOf({...pc, octave});
    if (m >= low && m <= high) return {...pc, octave};
  }
  return {...pc, octave: 3};
}

/** Close voicings of up to three chord tones above the bass, nearest the last one. */
function voice(chord, bassMidi, previous) {
  let tones = chord.tones;
  const bassPc = pcOf(chord.bass || chord.root);
  if (tones.length > 3) tones = tones.filter((t) => pcOf(t) !== bassPc);
  if (tones.length > 3) tones = tones.filter((t) => t.steps !== 4);
  tones = tones.slice(0, 3);
  let best = null;
  for (let r = 0; r < tones.length; r++) {
    const order = [...tones.slice(r), ...tones.slice(0, r)];
    for (let octave = 2; octave <= 4; octave++) {
      const stack = [];
      for (const t of order) {
        let p = {letter: t.letter, alter: t.alter, octave: stack.length ? stack[stack.length - 1].octave : octave};
        while (stack.length && midiOf(p) <= midiOf(stack[stack.length - 1])) p = {...p, octave: p.octave + 1};
        stack.push(p);
      }
      const values = stack.map(midiOf);
      const lowest = Math.min(...values);
      const highest = Math.max(...values);
      if (lowest <= bassMidi + 2 || lowest < 46 || highest > 64) continue;
      const centre = values.reduce((a, b) => a + b, 0) / values.length;
      const cost = Math.abs(centre - (previous ?? 55));
      if (!best || cost < best.cost) best = {stack, centre, cost};
    }
  }
  return best;
}

/** The left hand under one measure, from the chords sounding in it. */
function leftHand(measure, chords, grid, style, state) {
  const info = meterInfo(measure.meter, grid);
  const end = measure.start + measure.length;
  let active = null;
  const changes = [];
  for (const c of chords) {
    if (c.time <= measure.start) { active = c; continue; }
    if (c.time >= end) break;
    // The accompaniment changes on the nearest beat of the bar.
    const at = Math.round((measure.offset + c.time - measure.start) / info.beat) * info.beat - measure.offset;
    if (at <= 0) active = c;
    else if (at < measure.length) {
      if (changes.length && changes[changes.length - 1].at === at) changes[changes.length - 1].chord = c;
      else changes.push({at, chord: c});
    }
  }
  const segments = [{at: 0, chord: active}, ...changes];
  const events = [];
  segments.forEach((segment, i) => {
    const stop = i + 1 < segments.length ? segments[i + 1].at : measure.length;
    const chord = segment.chord?.chord;
    if (!chord || stop <= segment.at) return;
    const bass = place(chord.bass || chord.root, 41, 52);
    const voicing = voice(chord, midiOf(bass), state.centre);
    if (voicing) state.centre = voicing.centre;
    const stack = voicing ? voicing.stack : [];
    if (style === 'held') {
      events.push({at: segment.at, units: stop - segment.at, pitches: [bass, ...stack]});
      return;
    }
    // 4/4 and 12/8 alternate the bass: root on beat one, the fifth on beat three.
    const fifth = chord.tones.find((t) => t.steps === 4);
    const alternate = !!info.middle;
    for (let at = segment.at, k = 0; at < stop; at += info.beat, k++) {
      const beatInBar = Math.round((measure.offset + at) / info.beat);
      const units = Math.min(info.beat, stop - at);
      let pitches;
      if (k === 0) pitches = [bass];
      else if (alternate && beatInBar % 2 === 0 && fifth) pitches = [place(fifth, 41, 52)];
      else pitches = stack.length ? stack : [bass];
      events.push({at, units, pitches});
    }
  });
  return events;
}

const SECTION_NAMES = {inst: 'Instrumental', instrumental: 'Instrumental', prechorus: 'Pre-chorus', 'pre-chorus': 'Pre-chorus'};
const sectionName = (text) => SECTION_NAMES[text.toLowerCase()] || text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Arranges a read score.
 *   layout: 'piano' (melody over a left hand from the chords) or 'lead' (one staff)
 *   accompaniment: 'pattern' (bass then chords on the beats) or 'held' (one chord per change)
 *   transpose: semitones; pickup: grid units of a pickup bar SheetSage2 padded out
 */
export function arrange(score, {layout = 'piano', accompaniment = 'pattern', transpose = 0, pickup = 0} = {}) {
  const {grid, bars, vocal, ins} = score;
  const shift = transposition(bars[0].key, transpose);
  const lift = (p) => (shift.semitones ? move(p, shift.steps, shift.semitones) : p);
  const end = (n) => n.start + n.units;
  const overlaps = (notes, a, b) => notes.some((n) => n.start < b && end(n) > a);

  // Chords from both voices, one per moment, spelled for the key they sound in.
  const byTime = new Map();
  for (const [time, symbol] of [...ins.chords, ...vocal.chords]) byTime.set(time, symbol);
  const keyAt = (time) => moveKey(bars.filter((b) => b.start <= time).pop()?.key ?? bars[0].key, shift);
  const chords = [...byTime].sort((a, b) => a[0] - b[0])
    .map(([time, symbol]) => ({time, chord: readChord(symbol, keyAt(time), shift)}))
    .filter((c) => c.chord);
  const hasChords = chords.length > 0;
  const piano = layout === 'piano' && hasChords;

  // The melody: the vocal line wherever it sings in a bar, the instrumental line elsewhere.
  const sources = bars.map((bar) => (overlaps(vocal.notes, bar.start, bar.start + bar.length) ? vocal
    : overlaps(ins.notes, bar.start, bar.start + bar.length) ? ins : null));
  const octaves = new Map();
  for (const source of [vocal, ins]) {
    const used = source.notes.filter((n) => bars.some((bar, i) => sources[i] === source && n.start < bar.start + bar.length && end(n) > bar.start));
    octaves.set(source, piano ? octaveShift(used.map((n) => ({...n, pitch: n.pitch + shift.semitones})), 60, 84) : 0);
  }
  const melody = [];
  bars.forEach((bar, i) => {
    const source = sources[i];
    if (!source) return;
    const barEnd = bar.start + bar.length;
    for (const note of source.notes) {
      if (note.start >= barEnd || end(note) <= bar.start) continue;
      const spelled = plain(lift({letter: note.letter, alter: note.alt, octave: 4 + note.octave}), keyAt(note.start));
      melody.push({
        start: Math.max(note.start, bar.start),
        end: Math.min(end(note), barEnd),
        pitch: {...spelled, octave: spelled.octave + octaves.get(source)},
        tieIn: note.start < bar.start && sources[i - 1] === source,
        tieOut: end(note) > barEnd && sources[i + 1] === source,
      });
    }
  });

  // Measures, with SheetSage2's padded first bar written as a real pickup.
  const measures = bars.map((bar, index) => ({
    index, start: bar.start, length: bar.length, offset: 0, meter: bar.meter,
    key: {name: moveKey(bar.key, shift)}, sections: bar.sections.map(sectionName), implicit: false,
  }));
  const first = measures[0];
  if (pickup > 0 && pickup < first.length) {
    const cut = first.start + first.length - pickup;
    if (!melody.some((m) => m.start < cut)) {
      if (melody.some((m) => m.start < first.start + first.length)) {
        Object.assign(first, {start: cut, length: pickup, offset: first.length - pickup, implicit: true});
      } else if (measures.length > 1) {
        // An empty pickup: start at the first full bar, keeping its section name.
        if (!measures[1].sections.length) measures[1].sections = first.sections;
        measures.shift();
      }
    }
  }
  let number = measures[0].implicit ? 0 : 1;
  for (const m of measures) {
    m.number = number++;
    m.key.fifths = fifthsOf(m.key.name);
    m.key.mode = m.key.name.endsWith('m') ? 'minor' : 'major';
  }

  // Chord symbols where the harmony changes, and one on the first bar.
  let shown = null;
  for (const m of measures) {
    const stop = m.start + m.length;
    m.harmonies = [];
    for (const c of chords) {
      const opening = m === measures[0] && c.time <= m.start && !chords.some((d) => d.time > c.time && d.time <= m.start);
      if (!opening && (c.time < m.start || c.time >= stop)) continue;
      const label = chordLabel(c.chord);
      if (label === shown) continue;
      shown = label;
      m.harmonies.push({at: Math.max(0, c.time - m.start), chord: c.chord});
    }
  }

  // Staves: melody events per measure, and the left hand when there is one.
  const state = {centre: null};
  for (const m of measures) {
    const stop = m.start + m.length;
    const tune = melody.filter((n) => n.start < stop && n.end > m.start).map((n) => ({
      at: Math.max(n.start, m.start) - m.start,
      units: Math.min(n.end, stop) - Math.max(n.start, m.start),
      pitches: [n.pitch],
      tieIn: n.tieIn || n.start < m.start,
      tieOut: n.tieOut || n.end > stop,
    }));
    m.staves = [notate(tune, m, grid)];
    if (piano) m.staves.push(notate(leftHand(m, chords, grid, accompaniment, state), m, grid));
  }

  const pitches = melody.map((n) => midiOf(n.pitch));
  const clefs = piano ? [{sign: 'G', line: 2}, {sign: 'F', line: 4}] : [clefFor(pitches)];
  return {grid, tempo: score.tempo, measures, clefs, layout: piano ? 'piano' : 'lead', hasChords, key: measures[0].key};
}

// ---- MusicXML -------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c]);

function pitchXml(p) {
  return `<pitch><step>${p.letter}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
}

function noteXml(item, staff, voiceNumber) {
  const out = [];
  if (item.rest) {
    out.push(`<note>${item.whole ? '<rest measure="yes"/>' : '<rest/>'}<duration>${item.units}</duration><voice>${voiceNumber}</voice>`
      + (item.whole ? '' : `<type>${item.value.type}</type>${'<dot/>'.repeat(item.value.dots)}`) + `<staff>${staff}</staff></note>`);
    return out.join('');
  }
  item.pitches.forEach((p, i) => {
    const ties = (item.tieStop ? '<tie type="stop"/>' : '') + (item.tieStart ? '<tie type="start"/>' : '');
    const tied = (item.tieStop ? '<tied type="stop"/>' : '') + (item.tieStart ? '<tied type="start"/>' : '');
    const beams = i === 0 ? Object.entries(item.beams).map(([level, kind]) => `<beam number="${level}">${kind}</beam>`).join('') : '';
    out.push(`<note>${i ? '<chord/>' : ''}${pitchXml(p)}<duration>${item.units}</duration>${ties}<voice>${voiceNumber}</voice>`
      + `<type>${item.value.type}</type>${'<dot/>'.repeat(item.value.dots)}`
      + (p.accidental ? `<accidental>${p.accidental}</accidental>` : '')
      + `<staff>${staff}</staff>${beams}${tied ? `<notations>${tied}</notations>` : ''}</note>`);
  });
  return out.join('');
}

function harmonyXml({chord}, offset) {
  const alter = (a) => (a ? `<root-alter>${a}</root-alter>` : '');
  const bass = chord.bass
    ? `<bass><bass-step>${chord.bass.letter}</bass-step>${chord.bass.alter ? `<bass-alter>${chord.bass.alter}</bass-alter>` : ''}</bass>` : '';
  return `<harmony print-frame="no"><root><root-step>${chord.root.letter}</root-step>${alter(chord.root.alter)}</root>`
    + `<kind text="${esc(chord.text)}">${chord.kind}</kind>${bass}${offset ? `<offset>${offset}</offset>` : ''}<staff>1</staff></harmony>`;
}

function tempoXml(tempo, meter) {
  const compound = meter[1] === 8 && meter[0] % 3 === 0 && meter[0] > 3;
  const unit = compound ? '<beat-unit>quarter</beat-unit><beat-unit-dot/>' : '<beat-unit>quarter</beat-unit>';
  const value = compound ? Math.round(tempo * 2 / 3) : tempo;
  return `<direction placement="above"><direction-type><metronome parentheses="no">${unit}<per-minute>${value}</per-minute></metronome></direction-type>`
    + `<staff>1</staff><sound tempo="${tempo}"/></direction>`;
}

const clefXml = (clef, number) => `<clef${number ? ` number="${number}"` : ''}><sign>${clef.sign}</sign><line>${clef.line}</line>`
  + (clef.octave ? `<clef-octave-change>${clef.octave}</clef-octave-change>` : '') + '</clef>';

/** MusicXML for an arranged score, with the title block. */
export function toMusicXML(arranged, {title = 'Untitled', composer = '', arranger = '', software = 'YouTube to Score'} = {}) {
  const {grid, measures, clefs} = arranged;
  const staves = clefs.length;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${esc(title)}</work-title></work>`,
    '<identification>',
    composer ? `<creator type="composer">${esc(composer)}</creator>` : '',
    arranger ? `<creator type="arranger">${esc(arranger)}</creator>` : '',
    // Editors such as MuseScore keep these fields: the notes were written by an AI model.
    '<creator type="transcriber">SheetSage2 (AI)</creator>',
    `<encoding><software>SheetSage2 (m-a-p/SheetSage2), AI music transcription</software><software>${esc(software)}</software>`
      + `<encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`
      + '<encoding-description>AI-generated transcription: melody and chords by SheetSage2 from a recording, piano arrangement generated from its chords. May contain errors.</encoding-description></encoding>',
    '<miscellaneous><miscellaneous-field name="ai-generated">true</miscellaneous-field><miscellaneous-field name="ai-model">m-a-p/SheetSage2</miscellaneous-field></miscellaneous>',
    '</identification>',
    // The title block: title centred, then the artist and the transcription credit on the right.
    `<credit page="1"><credit-type>title</credit-type><credit-words justify="center" valign="top" font-size="22">${esc(title)}</credit-words></credit>`,
    composer ? `<credit page="1"><credit-type>composer</credit-type><credit-words justify="right" valign="top" font-size="12">${esc(composer)}</credit-words></credit>` : '',
    arranger ? `<credit page="1"><credit-type>arranger</credit-type><credit-words justify="right" valign="top" font-size="10" font-style="italic">${esc(arranger)}</credit-words></credit>` : '',
    `<part-list><score-part id="P1"><part-name print-object="no">${staves > 1 ? 'Piano' : 'Melody'}</part-name></score-part></part-list>`,
    '<part id="P1">',
  ];
  measures.forEach((m, i) => {
    const previous = measures[i - 1];
    out.push(`<measure number="${m.number}"${m.implicit ? ' implicit="yes"' : ''}>`);
    const attributes = [];
    if (!previous) attributes.push(`<divisions>${grid / 4}</divisions>`);
    if (!previous || previous.key.name !== m.key.name) attributes.push(`<key><fifths>${m.key.fifths}</fifths><mode>${m.key.mode}</mode></key>`);
    if (!previous || previous.meter.join() !== m.meter.join()) attributes.push(`<time><beats>${m.meter[0]}</beats><beat-type>${m.meter[1]}</beat-type></time>`);
    if (!previous) {
      if (staves > 1) attributes.push(`<staves>${staves}</staves>`);
      clefs.forEach((clef, k) => attributes.push(clefXml(clef, staves > 1 ? k + 1 : 0)));
    }
    if (attributes.length) out.push(`<attributes>${attributes.join('')}</attributes>`);
    if (!previous) out.push(tempoXml(arranged.tempo, m.meter));
    for (const section of m.sections) {
      out.push(`<direction placement="above"><direction-type><rehearsal enclosure="rectangle">${esc(section)}</rehearsal></direction-type><staff>1</staff></direction>`);
    }
    m.staves.forEach((items, s) => {
      if (s) out.push(`<backup><duration>${m.length}</duration></backup>`);
      const pending = s === 0 ? [...m.harmonies] : [];
      for (const item of items) {
        // A chord symbol sits on the note it starts with, offset when it starts inside one.
        while (pending.length && pending[0].at < item.at + item.units) {
          const harmony = pending.shift();
          out.push(harmonyXml(harmony, harmony.at - item.at));
        }
        out.push(noteXml(item, s + 1, s ? 5 : 1));
      }
    });
    if (i === measures.length - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('</measure>');
  });
  out.push('</part>', '</score-partwise>');
  return out.filter(Boolean).join('\n');
}

export {chordLabel};
