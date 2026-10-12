"use strict";
/**
 * Lay out SheetSage2's native score for reading, without changing a note.
 *
 * The native dialect writes each bar as one unbroken run, so abcjs beams a
 * whole bar together and a note that crosses a beat is not split. It always
 * uses a treble clef, even for a low voice, keeps an Ins staff that is often
 * all rests, and carries an accidental to that letter in every octave of the
 * bar, where abcjs reads it for one octave only, so such a note is drawn and
 * played a semitone off.
 *
 * `engrave` reads the native score into notes with the rules of the engine's
 * abc_tools.py and writes it again grouped by beat, with a clef that fits each
 * part and accidentals abcjs reads the same way. The result is only for
 * display and playback; downloads and the editor keep the native text. A score
 * that is not in the native dialect, such as one edited by hand, throws, and
 * the caller shows it as written.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeSignature = nativeSignature;
exports.parseNative = parseNative;
exports.engrave = engrave;
const TOKEN = /"([^"\n]*)"|\[K:([^\]\n]+)\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)(\d*)(-?)/y;
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER = { '=': 0, '_': -1, '__': -2, '^': 1, '^^': 2 };
const MARK = { [-2]: '__', [-1]: '_', 0: '=', 1: '^', 2: '^^' };
const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
const VOICE_DEFS = ['V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."'];
function fail(message) { throw new Error('Not a native score: ' + message); }
function nativeSignature(key) {
    const index = Math.max(MAJOR.indexOf(key), MINOR.indexOf(key));
    if (index < 0)
        fail(`key ${key}`);
    const count = index - 7, result = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    for (const letter of (count > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0, Math.abs(count)))
        result[letter] = count > 0 ? 1 : -1;
    return result;
}
const signature = nativeSignature;
function meterOf(text) {
    const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(text.trim());
    if (!match)
        fail(`meter ${text}`);
    return [Number(match[1]), Number(match[2])];
}
function parseBar(body, voice, grid, bars) {
    const [n, d] = voice.meter, length = n * grid / d;
    if (!Number.isInteger(length))
        fail('meter does not fit the grid');
    const start = voice.time, local = {};
    if (bars)
        bars.push({ start, length, meter: voice.meter, key: voice.key, sections: [] });
    let offset = 0;
    if (body === 'Z') {
        if (voice.pending)
            fail('tie into a rest');
        offset = length;
    }
    else
        for (let cursor = 0; cursor < body.length;) {
            if (/\s/.test(body[cursor])) {
                cursor++;
                continue;
            }
            TOKEN.lastIndex = cursor;
            const match = TOKEN.exec(body);
            if (!match)
                fail(`token at ${body.slice(cursor, cursor + 12)}`);
            cursor = TOKEN.lastIndex;
            const [, chord, key, acc, name, marks, count, tie] = match;
            if (chord !== undefined) {
                voice.chords.push([start + offset, chord]);
                continue;
            }
            if (key !== undefined) {
                signature(key);
                voice.key = key;
                voice.keys.push([start + offset, key]);
                for (const k in local)
                    delete local[k];
                continue;
            }
            const units = Number(count || 1);
            if (offset + units > length)
                fail('bar too long');
            if (name === 'z') {
                if (voice.pending)
                    fail('tie into a rest');
                offset += units;
                continue;
            }
            const letter = name.toUpperCase(), octave = (name === letter ? 0 : 1) + [...marks].filter(c => c === "'").length - [...marks].filter(c => c === ',').length;
            const written = 60 + NATURAL[letter] + 12 * octave;
            let alt = local[letter] ?? signature(voice.key)[letter];
            if (acc) {
                alt = ALTER[acc];
                local[letter] = alt;
            }
            let pitch = written + alt;
            if (voice.pending) {
                // An unmarked continuation keeps its tied accidental across a bar line.
                if (!acc && written === voice.pending.written)
                    pitch = voice.pending.pitch;
                if (pitch !== voice.pending.pitch)
                    fail('tie changes pitch');
                voice.notes[voice.notes.length - 1].units += units;
            }
            else
                voice.notes.push({ start: start + offset, units, letter, octave, alt: pitch - written, pitch });
            voice.pending = tie ? { pitch, written } : null;
            offset += units;
        }
    if (offset !== length)
        fail('bar too short');
    voice.time += length;
}
function parseNative(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 12 || lines[0] !== 'X:1' || !lines[1].startsWith('T:') || !lines[2].startsWith('M:'))
        fail('header');
    const unit = /^L:1\/(\d+)$/.exec(lines[3]), tempo = /^Q:1\/4=(\d+)$/.exec(lines[4]);
    if (!unit || !tempo || lines[5] !== VOICE_DEFS[0] || lines[6] !== VOICE_DEFS[1] || !lines[7].startsWith('K:'))
        fail('header');
    const grid = Number(unit[1]), meter = meterOf(lines[2].slice(2)), key = lines[7].slice(2).trim();
    if (grid < 1 || grid > 1024 || (grid & (grid - 1)) || Number(tempo[1]) < 1)
        fail('grid or tempo');
    signature(key);
    const make = () => ({ meter, key, time: 0, notes: [], chords: [], keys: [[0, key]], pending: null });
    const vocal = make(), ins = make(), bars = [];
    let cursor = 8;
    while (cursor < lines.length) {
        const sections = [];
        while (cursor < lines.length && lines[cursor].startsWith('%')) {
            sections.push(lines[cursor].replace(/^%\s*/, ''));
            cursor++;
        }
        if (cursor >= lines.length)
            fail('section without music');
        const first = bars.length;
        for (const [name, voice] of [['Vocal', vocal], ['Ins', ins]]) {
            if (lines[cursor]?.trim() !== 'V: ' + name)
                fail(`expected V: ${name}`);
            cursor++;
            while (cursor < lines.length && /^[MK]:/.test(lines[cursor])) {
                const value = lines[cursor].slice(2).trim();
                if (lines[cursor][0] === 'M')
                    voice.meter = meterOf(value);
                else {
                    signature(value);
                    voice.key = value;
                    voice.keys.push([voice.time, value]);
                }
                cursor++;
            }
            const line = lines[cursor++]?.trim();
            if (!line?.endsWith('|'))
                fail('music line');
            for (const raw of line.slice(0, -1).split('|')) {
                const body = raw.trim(), rest = /^Z([2-4])?$/.exec(body);
                if (!body)
                    fail('empty bar');
                for (let i = 0; i < (rest ? Number(rest[1] || 1) : 1); i++)
                    parseBar(rest ? 'Z' : body, voice, grid, name === 'Vocal' ? bars : null);
            }
        }
        if (vocal.time !== ins.time)
            fail('voices differ in length');
        if (bars[first])
            bars[first].sections = sections;
    }
    if (vocal.pending || ins.pending)
        fail('unresolved tie');
    if (!bars.length || bars.length > 1000)
        fail('score length');
    // A key change written at the very start of a bar belongs to that bar.
    for (const bar of bars)
        bar.key = vocal.keys.filter(([t]) => t <= bar.start).pop()[1];
    return { header: lines.slice(0, 5), grid, bars, vocal, ins };
}
/** A length abcjs draws as one note: plain or dotted. */
function drawable(units) { while (units % 2 === 0)
    units /= 2; return units === 1 || units === 3; }
/**
 * Split a note or rest so it reads by the beat: one that starts off the beat
 * stops at the next beat, and in 4/4 nothing but a note from the downbeat
 * crosses the middle of the bar. Each piece is a plain or dotted value.
 */
function pieces(position, units, beat, middle) {
    const out = [];
    while (units > 0) {
        let take = units;
        if (position % beat)
            take = Math.min(take, beat - position % beat);
        else if (middle && position && position < middle && position + take > middle)
            take = middle - position;
        while (!drawable(take))
            take--;
        out.push(take);
        position += take;
        units -= take;
    }
    return out;
}
/** Treble for most parts, treble-8 (written an octave up) for low voices, bass below that. */
function clefFor(notes) {
    if (!notes.length)
        return { clef: 'treble', shift: 0 };
    const sorted = notes.map(note => note.pitch).sort((a, b) => a - b), middle = sorted[sorted.length >> 1];
    return middle >= 59 ? { clef: 'treble', shift: 0 } : middle >= 47 ? { clef: 'treble-8', shift: 1 } : { clef: 'bass', shift: 0 };
}
const FLAT_OF = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
const SHARP_OF = Object.fromEntries(Object.entries(FLAT_OF).map(([sharp, flat]) => [flat, sharp]));
/** SheetSage2 names chords with sharps whatever the key; name them as the key signature does. */
function chordName(symbol, sig) {
    const values = Object.values(sig), table = values.some(v => v < 0) ? FLAT_OF : values.some(v => v > 0) ? SHARP_OF : null;
    return table ? symbol.replace(/(^|\/)([A-G][#b]?)/g, (all, slash, root) => slash + (table[root] || root)) : symbol;
}
const noteName = (letter, octave) => octave < 0 ? letter + ','.repeat(-octave) : octave === 0 ? letter : letter.toLowerCase() + "'".repeat(octave - 1);
const count = (units) => units === 1 ? '' : String(units);
const label = (text) => text.charAt(0).toUpperCase() + text.slice(1);
function renderBar(bar, voice, grid, shift, lead) {
    const end = bar.start + bar.length;
    const inside = voice.notes.filter(note => note.start < end && note.start + note.units > bar.start);
    const chords = lead ? voice.chords.filter(([t]) => t >= bar.start && t < end) : [];
    const keys = voice.keys.filter(([t]) => t > bar.start && t < end);
    const sections = lead ? bar.sections : [];
    const [n, d] = bar.meter, compound = d === 8 && n % 3 === 0;
    let beat = compound ? 3 * grid / 8 : grid / d;
    if (!Number.isInteger(beat) || beat < 1)
        beat = bar.length;
    const middle = n === 4 && d === 4 ? 2 * beat : 0;
    const points = new Set([bar.start, end, ...chords.map(([t]) => t), ...keys.map(([t]) => t)]);
    for (const note of inside) {
        points.add(Math.max(bar.start, note.start));
        points.add(Math.min(end, note.start + note.units));
    }
    const times = [...points].sort((a, b) => a - b);
    // Accidentals are written whenever abcjs (by octave) or the native dialect
    // (by letter) would otherwise read the note differently.
    let sig = signature(bar.key);
    const byOctave = new Map(), byLetter = new Map();
    const accidental = (note) => {
        const natural = sig[note.letter], id = note.letter + note.octave;
        const needed = note.alt !== (byOctave.get(id) ?? natural) || note.alt !== (byLetter.get(note.letter) ?? natural);
        byOctave.set(id, note.alt);
        byLetter.set(note.letter, note.alt);
        return needed ? MARK[note.alt] : '';
    };
    const gap = (at) => at > bar.start && (at - bar.start) % beat === 0 ? ' ' : '';
    let out = '';
    for (let i = 0; i < times.length - 1; i++) {
        const a = times[i], b = times[i + 1];
        out += gap(a);
        for (const [t, key] of keys)
            if (t === a) {
                out += `[K:${key}]`;
                sig = signature(key);
                byOctave.clear();
                byLetter.clear();
            }
        // Chord names first, so a section label stacks above them, not between them and the staff.
        for (const [t, symbol] of chords)
            if (t === a)
                out += `"${chordName(symbol, sig)}"`;
        if (a === bar.start)
            out += sections.map(text => `"^${label(text)}"`).join('');
        const note = inside.find(item => item.start <= a && a < item.start + item.units);
        let at = a;
        pieces(a - bar.start, b - a, beat, middle).forEach((units, k) => {
            if (k)
                out += gap(at);
            if (!note)
                out += 'z' + count(units);
            else {
                // Only a note's first piece carries its accidental. A tied piece keeps the
                // pitch it is tied from, and abcjs ignores any accidental written on it
                // when it reads the rest of the bar.
                const mark = at > note.start ? '' : accidental(note);
                const tie = at + units < note.start + note.units ? '-' : '';
                out += mark + noteName(note.letter, note.octave + shift) + count(units) + tie;
            }
            at += units;
        });
    }
    return out;
}
function engrave(text) {
    const { header, grid, bars, vocal, ins } = parseNative(text);
    // Chords and section names ride on the first staff shown.
    const parts = [vocal.notes.length || !ins.notes.length ? { name: 'Vocal', voice: vocal } : null, ins.notes.length ? { name: 'Ins', voice: ins } : null]
        .filter((part) => !!part);
    if (parts[0].voice === ins) {
        ins.chords = vocal.chords;
    }
    const named = parts.length > 1;
    const defs = parts.map(({ name, voice }) => {
        const { clef } = clefFor(voice.notes);
        return `V:${name} clef=${clef}` + (named ? (name === 'Vocal' ? ' name="Vocal" snm="Vo."' : ' name="Instrument" snm="Ins."') : '');
    });
    const lines = [...header.slice(0, 2), `M:${bars[0].meter.join('/')}`, header[3], header[4], ...defs, `K:${bars[0].key}`];
    const rendered = parts.map(({ voice }, index) => {
        const { shift } = clefFor(voice.notes);
        return bars.map(bar => renderBar(bar, voice, grid, shift, index === 0));
    });
    // abcjs lets a key change in one voice's line leak into the next voice's
    // line, so a line breaks wherever the key or meter changes on a bar line and
    // every voice's line states its key.
    for (let first = 0; first < bars.length;) {
        let last = first + 1;
        while (last < bars.length && last - first < 4 && !bars[last].sections.length
            && bars[last].meter.join() === bars[first].meter.join() && bars[last].key === bars[first].key)
            last++;
        const meterChanged = first > 0 && bars[first - 1].meter.join() !== bars[first].meter.join();
        parts.forEach(({ name }, index) => {
            lines.push(`V:${name}`);
            if (meterChanged)
                lines.push(`M:${bars[first].meter.join('/')}`);
            lines.push(`K:${bars[first].key}`);
            lines.push(rendered[index].slice(first, last).join(' | ') + (last === bars.length ? ' |]' : ' |'));
        });
        first = last;
    }
    return lines.join('\n') + '\n';
}
