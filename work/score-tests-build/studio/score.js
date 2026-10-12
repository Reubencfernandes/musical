"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pitchName = exports.scoreSeconds = exports.scoreLength = void 0;
exports.readScore = readScore;
exports.validateScore = validateScore;
exports.writeScore = writeScore;
exports.transposeScore = transposeScore;
exports.changeBar = changeBar;
const engrave_1 = require("../engrave");
const scoreLength = (score) => score.bars.at(-1).start + score.bars.at(-1).length;
exports.scoreLength = scoreLength;
const scoreSeconds = (score) => (0, exports.scoreLength)(score) * 240 / score.grid / score.bpm;
exports.scoreSeconds = scoreSeconds;
const pitchName = (pitch) => ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pitch % 12] + (Math.floor(pitch / 12) - 1);
exports.pitchName = pitchName;
function readScore(text) {
    const parsed = (0, engrave_1.parseNative)(text), scale = Math.max(32, parsed.grid) / parsed.grid;
    const notes = [];
    for (const [voice, part] of [['Vocal', parsed.vocal], ['Ins', parsed.ins]])
        part.notes.forEach((note, index) => notes.push({ id: `${voice}-${index}`, voice, start: note.start * scale, duration: note.units * scale, pitch: note.pitch }));
    const chords = [];
    parsed.vocal.chords.forEach(([start, name]) => {
        if (chords.at(-1)?.name === name)
            return;
        if (chords.at(-1)?.start === start * scale)
            chords.pop();
        chords.push({ id: `chord-${chords.length}`, start: start * scale, name });
    });
    const keys = parsed.vocal.keys.filter((item, index, all) => index === 0 || item[1] !== all[index - 1][1]).map(([t, k]) => [t * scale, k]);
    const score = { grid: parsed.grid * scale, bpm: Number(parsed.header[4].split('=')[1]),
        bars: parsed.bars.map(bar => ({ ...bar, start: bar.start * scale, length: bar.length * scale })), notes, chords, keys };
    validateScore(score);
    return score;
}
const CHORD = /^[A-G](?:#|b)?(?:m\(maj7\)|maj7|m7b5|dim7|dim|aug|m7|sus4|sus2|7sus4|m6|m|7|6)?(?:\/[A-G](?:#|b)?)?$/;
function validateScore(score) {
    if (!score || !Array.isArray(score.bars) || !score.bars.length || score.bars.length > 1000)
        throw new Error('The score needs 1–1000 bars.');
    if (!Number.isInteger(score.grid) || score.grid < 32 || score.grid > 1024 || (score.grid & (score.grid - 1)))
        throw new Error('Unsupported note grid.');
    if (!Number.isInteger(score.bpm) || score.bpm < 1 || score.bpm > 1000)
        throw new Error('Choose a whole-number tempo from 1 to 1000.');
    if (!Array.isArray(score.notes) || score.notes.length > 20000 || !Array.isArray(score.chords) || score.chords.length > 10000 || !Array.isArray(score.keys))
        throw new Error('That score is too large.');
    let cursor = 0;
    for (const bar of score.bars) {
        if (!Array.isArray(bar.meter) || bar.meter.length !== 2 || !bar.meter.every(n => Number.isInteger(n) && n > 0 && n <= 64)
            || bar.start !== cursor || bar.length !== score.grid * bar.meter[0] / bar.meter[1] || !Number.isInteger(bar.length))
            throw new Error('The bar grid is inconsistent.');
        (0, engrave_1.nativeSignature)(bar.key);
        if (!Array.isArray(bar.sections) || bar.sections.some(s => typeof s !== 'string' || s.length > 80 || /[\r\n]/.test(s)))
            throw new Error('Use a short section name.');
        cursor += bar.length;
    }
    const ids = new Set();
    for (const note of score.notes) {
        if (typeof note.id !== 'string' || ids.has(note.id))
            throw new Error('Each note needs a unique ID.');
        ids.add(note.id);
        if (!['Vocal', 'Ins'].includes(note.voice) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)
            throw new Error('Choose a note in the MIDI range.');
        if (!Number.isInteger(note.start) || note.start < 0 || !Number.isInteger(note.duration) || note.duration <= 0 || note.start + note.duration > cursor)
            throw new Error('A note extends beyond the score or has an invalid length.');
    }
    for (const voice of ['Vocal', 'Ins']) {
        const notes = score.notes.filter(n => n.voice === voice).sort((a, b) => a.start - b.start);
        for (let i = 1; i < notes.length; i++)
            if (notes[i - 1].start + notes[i - 1].duration > notes[i].start)
                throw new Error('Melody notes cannot overlap. Move or shorten the neighbouring note.');
    }
    let at = -1;
    for (const chord of [...score.chords].sort((a, b) => a.start - b.start)) {
        if (!Number.isInteger(chord.start) || chord.start < 0 || chord.start >= cursor || chord.start === at || !CHORD.test(chord.name))
            throw new Error('Use a supported chord such as C, Am7, Fmaj7, or G/B at a unique position.');
        at = chord.start;
    }
    at = -1;
    for (const [start, key] of score.keys) {
        if (!Number.isInteger(start) || start < 0 || start >= cursor || start <= at)
            throw new Error('Invalid key-change position.');
        (0, engrave_1.nativeSignature)(key);
        at = start;
    }
    if (score.keys[0]?.[0] !== 0 || score.keys[0]?.[1] !== score.bars[0].key)
        throw new Error('The score needs its initial key.');
}
const VALUES = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function spell(pitch, key, active) {
    const sig = (0, engrave_1.nativeSignature)(key), sharp = Object.values(sig).reduce((a, b) => a + b, 0) >= 0;
    const candidates = [];
    for (const [letter, pc] of Object.entries(NATURAL))
        for (let alt = -1; alt <= 1; alt++) {
            const base = pitch - alt - 60 - pc;
            if (base % 12)
                continue;
            candidates.push({ rank: Number(alt !== sig[letter]) * 10 + Math.abs(alt) * 2 + Number(sharp ? alt < 0 : alt > 0), letter, alt, octave: base / 12 });
        }
    const note = candidates.sort((a, b) => a.rank - b.rank)[0];
    const mark = note.alt !== (active[note.letter] ?? sig[note.letter]) ? ({ '-1': '_', 0: '=', 1: '^' }[note.alt]) : '';
    active[note.letter] = note.alt;
    return mark + (note.octave < 0 ? note.letter + ','.repeat(-note.octave) : note.octave === 0 ? note.letter : note.letter.toLowerCase() + "'".repeat(note.octave - 1));
}
function renderBar(score, bar, voice) {
    const end = bar.start + bar.length, notes = score.notes.filter(n => n.voice === voice && n.start < end && n.start + n.duration > bar.start);
    const chords = voice === 'Vocal' ? score.chords.filter(c => c.start >= bar.start && c.start < end) : [];
    const keys = score.keys.filter(([t]) => t > bar.start && t < end);
    if (!notes.length && !chords.length && !keys.length)
        return 'Z';
    const points = new Set([bar.start, end, ...chords.map(c => c.start), ...keys.map(([t]) => t)]);
    notes.forEach(n => { points.add(Math.max(bar.start, n.start)); points.add(Math.min(end, n.start + n.duration)); });
    const sorted = [...points].sort((a, b) => a - b);
    let key = bar.key, active = {}, out = '';
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1], change = keys.find(([t]) => t === a);
        if (change) {
            key = change[1];
            active = {};
            out += `[K:${key}]`;
        }
        const chord = chords.find(c => c.start === a);
        if (chord)
            out += `"${chord.name}"`;
        const note = notes.find(n => n.start <= a && n.start + n.duration > a);
        let left = b - a, at = a;
        while (left) {
            const length = VALUES.find(n => n <= left);
            out += (note ? spell(note.pitch, key, active) : 'z') + (length === 1 ? '' : length) + (note && at + length < note.start + note.duration ? '-' : '');
            left -= length;
            at += length;
        }
    }
    return out;
}
function writeScore(score) {
    validateScore(score);
    const first = score.bars[0];
    const lines = ['X:1', 'T:', `M:${first.meter.join('/')}`, `L:1/${score.grid}`, `Q:1/4=${score.bpm}`,
        'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."', `K:${first.key}`];
    // One bar per block preserves every section, meter and key boundary.
    score.bars.forEach((bar, index) => {
        lines.push(...bar.sections.map(s => '% ' + s));
        for (const voice of ['Vocal', 'Ins']) {
            lines.push('V: ' + voice);
            if (index && score.bars[index - 1].meter.join() !== bar.meter.join())
                lines.push('M:' + bar.meter.join('/'));
            if (index && score.bars[index - 1].key !== bar.key)
                lines.push('K:' + bar.key);
            lines.push(renderBar(score, bar, voice) + '|');
        }
    });
    const abc = lines.join('\n') + '\n', parsed = readScore(abc);
    const events = (s) => s.notes.map(n => [n.voice, n.start, n.duration, n.pitch].join(':')).sort().join('|');
    if (events(parsed) !== events(score))
        throw new Error('Saving this score would lose notes.');
    return abc;
}
const CHROMATIC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PITCH_CLASS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
function transposeScore(score, steps) {
    const move = (name) => CHROMATIC[(PITCH_CLASS[name] + steps + 120) % 12];
    const key = (name) => move(name.endsWith('m') ? name.slice(0, -1) : name) + (name.endsWith('m') ? 'm' : '');
    const next = { ...score, notes: score.notes.map(n => ({ ...n, pitch: n.pitch + steps })),
        chords: score.chords.map(c => ({ ...c, name: c.name.replace(/(^|\/)([A-G][#b]?)/g, (_, prefix, root) => prefix + move(root)) })),
        bars: score.bars.map(b => ({ ...b, key: key(b.key) })), keys: score.keys.map(([t, k]) => [t, key(k)]) };
    validateScore(next);
    return next;
}
/** Remove or duplicate a whole bar and shift every affected event consistently. */
function changeBar(score, index, action) {
    if (action === 'delete' && score.bars.length === 1)
        throw new Error('Keep at least one bar.');
    const bar = score.bars[index], end = bar.start + bar.length, amount = action === 'duplicate' ? bar.length : -bar.length;
    const cut = action === 'duplicate' ? end : bar.start;
    // A tied note crossing this boundary needs an explicit musical edit first.
    if (score.notes.some(n => n.start < cut && n.start + n.duration > cut || action === 'delete' && n.start < end && n.start + n.duration > end))
        throw new Error('A note crosses this bar boundary. Split or shorten it before changing the form.');
    const notes = score.notes.filter(n => action !== 'delete' || n.start < bar.start || n.start >= end).map(n => ({ ...n, start: n.start >= end ? n.start + amount : n.start }));
    if (action === 'duplicate')
        notes.push(...score.notes.filter(n => n.start >= bar.start && n.start < end).map(n => ({ ...n, id: crypto.randomUUID(), start: n.start + bar.length })));
    const chords = score.chords.filter(c => action !== 'delete' || c.start < bar.start || c.start >= end).map(c => ({ ...c, start: c.start >= end ? c.start + amount : c.start }));
    if (action === 'duplicate') {
        const held = [...score.chords].sort((a, b) => a.start - b.start).filter(c => c.start <= bar.start).at(-1);
        if (held && !score.chords.some(c => c.start === bar.start))
            chords.push({ ...held, id: crypto.randomUUID(), start: end });
        chords.push(...score.chords.filter(c => c.start >= bar.start && c.start < end).map(c => ({ ...c, id: crypto.randomUUID(), start: c.start + bar.length })));
    }
    const bars = score.bars.filter((_, i) => action !== 'delete' || i !== index).flatMap((b, i) => action === 'duplicate' && i === index ? [b, { ...b, sections: [] }] : [b]);
    let start = 0;
    const shifted = bars.map(b => { const next = { ...b, start }; start += b.length; return next; });
    // Form editing is limited to bar-boundary key changes to avoid guessing inline changes.
    if (score.keys.some(([t]) => !score.bars.some(b => b.start === t)))
        throw new Error('This score has a key change inside a bar. Keep its form unchanged.');
    const keys = [];
    shifted.forEach(b => { if (!keys.length || keys.at(-1)[1] !== b.key)
        keys.push([b.start, b.key]); });
    const next = { ...score, bars: shifted, notes, chords: chords.sort((a, b) => a.start - b.start), keys };
    validateScore(next);
    return next;
}
