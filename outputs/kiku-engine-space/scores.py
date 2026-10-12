"""Read, edit and rewrite the two-voice ABC scores SheetSage2 writes and YuE2 plays.

A score is read into plain events: bars (with meter, key and section labels),
the Vocal and Ins melodies as (onset, MIDI pitch, duration) in quarter notes,
and chord changes. Every edit works on those events and `write` serialises
them back into the native dialect, so an edit can never leave a bar with the
wrong length or a tie that changes pitch. `abc_tools.parse_abc` re-reads each
result as a check.

The note spelling rules follow the yue2-music skill's compile_score.py (MIT).
"""
from dataclasses import dataclass, field, replace
from fractions import Fraction
from math import lcm
import re

from abc_tools import CHORD, DURATIONS, KEYS, NATURAL, PITCH_NAME, key_accidentals, parse_abc

SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PITCH_CLASS = {name: i for i, name in enumerate(SHARPS)} | {name: i for i, name in enumerate(FLATS)} | {
    "Cb": 11, "Fb": 4, "E#": 5, "B#": 0}
ROOT = re.compile(r"^(" + PITCH_NAME + r")(.*?)(?:/(" + PITCH_NAME + r"))?$")
QUALITY_TONES = {"": (0, 4, 7), "m": (0, 3, 7), "dim": (0, 3, 6), "aug": (0, 4, 8), "7": (0, 4, 7, 10),
                 "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "dim7": (0, 3, 6, 9), "m7b5": (0, 3, 6, 10),
                 "sus4": (0, 5, 7), "sus2": (0, 2, 7), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9),
                 "7sus4": (0, 5, 7, 10), "m(maj7)": (0, 3, 7, 11)}


@dataclass
class Bar:
    start: Fraction
    length: Fraction
    meter: tuple
    key: str
    sections: list = field(default_factory=list)

    @property
    def end(self):
        return self.start + self.length


@dataclass
class Score:
    bpm: int
    bars: list
    vocal: list
    ins: list
    chords: list
    # The source's L: denominator. Kept so a rewrite reads like the original.
    grid: int = 32

    @property
    def length(self):
        return self.bars[-1].end if self.bars else Fraction(0)

    def seconds(self, quarters):
        return float(quarters) * 60.0 / self.bpm


def _section_labels(text, parsed):
    """Section comments by the index of the bar they start on."""
    labels, pending, cursor = {}, [], 0
    for index, line in enumerate(text.splitlines()):
        if line.startswith("% "):
            pending.append(" ".join(line[2:].split()))
            continue
        if parsed.music_lines.get(index) != "Vocal":
            continue
        if pending:
            labels.setdefault(cursor, []).extend(pending)
            pending = []
        for bar in line[:-1].split("|"):
            rest = re.fullmatch(r"Z([2-4])?", bar.strip())
            cursor += int(rest.group(1) or 1) if rest else 1
    return labels


def read(text):
    # Blank lines are not part of the dialect; scores pasted or passed around gain them.
    text = "\n".join(line for line in text.strip().splitlines() if line.strip()) + "\n"
    parsed = parse_abc(text)
    vocal, ins = parsed.voices["Vocal"], parsed.voices["Ins"]
    labels = _section_labels(text, parsed)
    bars = []
    for index, (start, length, meter) in enumerate(vocal.bars):
        key = next(k for t, k in reversed(vocal.keys) if t <= start)
        bars.append(Bar(start, length, tuple(meter), key, list(labels.get(index, []))))
    chords = []
    for when, symbol in vocal.chords:
        if chords and chords[-1][1] == symbol:
            continue
        if chords and chords[-1][0] == when:
            chords[-1] = (when, symbol)
            continue
        chords.append((when, symbol))
    return Score(parsed.bpm, bars, [tuple(n) for n in vocal.notes], [tuple(n) for n in ins.notes], chords,
                 parsed.unit.denominator)


# ------------------------------------------------------------------- writing

def _lengths(units):
    if units.denominator != 1 or units <= 0:
        raise ValueError("Unrepresentable duration: %s" % units)
    left, result = int(units), []
    for part in sorted(DURATIONS, reverse=True):
        while left >= part:
            result.append(part)
            left -= part
    return result


def _count(n):
    return "" if n == 1 else str(n)


def _spell(pitch, key, active):
    signature = key_accidentals(key)
    prefer_sharp = sum(signature.values()) >= 0
    candidates = []
    for letter, pc in NATURAL.items():
        for alteration in (-1, 0, 1):
            base = pitch - alteration - 60 - pc
            if base % 12:
                continue
            candidates.append(((alteration != signature[letter], abs(alteration),
                                (alteration < 0) if prefer_sharp else (alteration > 0)),
                               letter, alteration, base // 12))
    _, letter, alteration, octave = min(candidates)
    accidental = ""
    if alteration != active.get(letter, signature[letter]):
        accidental = {-1: "_", 0: "=", 1: "^"}[alteration]
        active[letter] = alteration
    name = letter + "," * (-octave) if octave < 0 else (
        letter if octave == 0 else letter.lower() + "'" * (octave - 1))
    return accidental + name


def _render(bar, notes, chords, unit):
    """One bar of one voice. `chords` is None for Ins, which never carries them."""
    start, end = bar.start, bar.end
    inside = [n for n in notes if n[0] < end and n[0] + n[2] > start]
    changes = []
    if chords is not None:
        current = next((s for t, s in reversed(chords) if t <= start), None)
        changes = ([(start, current)] if current else []) + [(t, s) for t, s in chords if start < t < end]
    if not inside and not changes:
        return "Z"
    points = {start, end} | {t for t, _ in changes}
    for onset, _, duration in inside:
        points |= {max(start, onset), min(end, onset + duration)}
    points = sorted(points)
    symbols = dict(changes)
    pieces, active = [], {}
    for a, b in zip(points, points[1:]):
        if a in symbols:
            pieces.append('"' + symbols[a] + '"')
        note = next((n for n in inside if n[0] <= a < n[0] + n[2]), None)
        parts = _lengths((b - a) / unit)
        if note is None:
            pieces.extend("z" + _count(n) for n in parts)
            continue
        onset, pitch, duration = note
        for i, n in enumerate(parts):
            tie = "-" if i < len(parts) - 1 or b < onset + duration else ""
            pieces.append(_spell(pitch, bar.key, active) + _count(n) + tie)
    return "".join(pieces)


def _compress(bars):
    out, i = [], 0
    while i < len(bars):
        if bars[i] != "Z":
            out.append(bars[i] + "|")
            i += 1
            continue
        j = i
        while j < len(bars) and bars[j] == "Z":
            j += 1
        out.append("Z" + _count(j - i) + "|")
        i = j
    return "".join(out)


def write(score):
    if not score.bars:
        raise ValueError("A score needs at least one bar.")
    denominator = score.grid
    for bar in score.bars:
        denominator = lcm(denominator, 4 * bar.meter[1])
    for onset, _, duration in score.vocal + score.ins:
        denominator = lcm(denominator, (onset / 4).denominator, (duration / 4).denominator)
    for when, _ in score.chords:
        denominator = lcm(denominator, (when / 4).denominator)
    if denominator > 1024 or denominator & (denominator - 1):
        raise ValueError("The rhythm does not fit the score's grid.")
    unit = Fraction(4, denominator)
    vocal = [_render(bar, score.vocal, score.chords, unit) for bar in score.bars]
    ins = [_render(bar, score.ins, None, unit) for bar in score.bars]
    first = score.bars[0]
    lines = ["X:1", "T:", "M:%d/%d" % first.meter, "L:1/%d" % denominator, "Q:1/4=%d" % score.bpm,
             'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"',
             'V: Ins clef=treble name="Ins Melody" snm="Inst."', "K:" + first.key]
    index = 0
    while index < len(score.bars):
        bar = score.bars[index]
        previous = score.bars[index - 1] if index else bar
        end = index + 1
        while (end < len(score.bars) and end - index < 4 and not score.bars[end].sections
               and score.bars[end].meter == bar.meter and score.bars[end].key == bar.key):
            end += 1
        lines.extend("% " + label for label in bar.sections)
        for name, rendered in (("Vocal", vocal), ("Ins", ins)):
            lines.append("V: " + name)
            if bar.meter != previous.meter:
                lines.append("M:%d/%d" % bar.meter)
            if bar.key != previous.key:
                lines.append("K:" + bar.key)
            lines.append(_compress(rendered[index:end]))
        index = end
    text = "\n".join(lines) + "\n"
    check = parse_abc(text)
    if ([tuple(n) for n in check.voices["Vocal"].notes] != sorted(score.vocal)
            or [tuple(n) for n in check.voices["Ins"].notes] != sorted(score.ins)):
        raise ValueError("The rewritten score lost notes.")
    return text


# ------------------------------------------------------------------- editing

def _overlapping(notes):
    ordered = sorted(notes)
    return any(a[0] + a[2] > b[0] for a, b in zip(ordered, ordered[1:]))


def without_vocal(score):
    """Chords and instrumental fills only: what a band plays around a singer."""
    return replace(score, vocal=[])


def vocal_to_ins(score):
    """Give the sung melody to the instrument, keeping the fills between phrases."""
    occupied = [(t, t + d) for t, _, d in score.vocal]
    merged = list(score.vocal)
    for onset, pitch, duration in score.ins:
        pieces = [(onset, onset + duration)]
        for left, right in occupied:
            kept = []
            for a, b in pieces:
                if right <= a or left >= b:
                    kept.append((a, b))
                    continue
                if a < left:
                    kept.append((a, left))
                if right < b:
                    kept.append((right, b))
            pieces = kept
        merged.extend((a, pitch, b - a) for a, b in pieces)
    return replace(score, vocal=[], ins=sorted(merged))


def without_chords(score):
    return replace(score, chords=[])


def _key_name(pc, minor, sharp_side):
    names = [k for k in KEYS if k.endswith("m") == minor]
    fits = [k for k in names if PITCH_CLASS[k[:-1] if minor else k] == pc]
    return min(fits, key=lambda k: (abs(KEYS[k]), (KEYS[k] < 0) == sharp_side))


def _shift_name(name, steps, sharp):
    return (SHARPS if sharp else FLATS)[(PITCH_CLASS[name] + steps) % 12]


def shift_chord(symbol, steps, sharp=True):
    match = ROOT.match(symbol)
    if not match:
        return symbol
    root, quality, bass = match.groups()
    result = _shift_name(root, steps, sharp) + quality
    if bass:
        result += "/" + _shift_name(bass, steps, sharp)
    return result


def transpose(score, steps):
    steps = int(steps)
    if not steps:
        return score
    if not -12 <= steps <= 12:
        raise ValueError("Transpose by at most an octave.")
    keys = {}
    for bar in score.bars:
        if bar.key not in keys:
            minor = bar.key.endswith("m")
            pc = PITCH_CLASS[bar.key[:-1] if minor else bar.key]
            keys[bar.key] = _key_name((pc + steps) % 12, minor, steps > 0)
    bars = [replace(bar, key=keys[bar.key], sections=list(bar.sections)) for bar in score.bars]

    def move(notes):
        moved = [(t, p + steps, d) for t, p, d in notes]
        if any(not 0 <= p <= 127 for _, p, _ in moved):
            raise ValueError("That transposition takes notes out of range.")
        return moved

    def chord_key(when):
        key = next((b.key for b in reversed(bars) if b.start <= when), bars[0].key)
        return KEYS[key] >= 0

    return replace(score, bars=bars, vocal=move(score.vocal), ins=move(score.ins),
                   chords=[(t, shift_chord(s, steps, chord_key(t))) for t, s in score.chords])


def with_tempo(score, bpm):
    bpm = int(round(float(bpm)))
    if not 30 <= bpm <= 300:
        raise ValueError("Choose a tempo from 30 to 300 BPM.")
    return replace(score, bpm=bpm)


def bar_chords(score, index):
    """Chord symbols sounding in bar `index`, including one held from before."""
    bar = score.bars[index]
    held = next((s for t, s in reversed(score.chords) if t <= bar.start), None)
    inside = [s for t, s in score.chords if bar.start < t < bar.end]
    return ([held] if held else []) + inside


def with_bar_chords(score, changes):
    """Replace the harmony of whole bars. `changes` maps bar index to symbols,
    spread evenly across the bar. An empty list leaves the bar unharmonised."""
    if not changes:
        return score
    for symbols in changes.values():
        for symbol in symbols:
            if not CHORD.fullmatch(symbol):
                raise ValueError("Unsupported chord %r. Use names like C, Am, F#m7, Bbmaj7 or G/B." % symbol)
    chords = list(score.chords)
    for index in sorted(changes):
        if not 0 <= index < len(score.bars):
            raise ValueError("There is no bar %d." % (index + 1))
        bar = score.bars[index]
        held = next((s for t, s in reversed(chords) if t <= bar.end - Fraction(1, 1024)), None)
        chords = [(t, s) for t, s in chords if not bar.start <= t < bar.end]
        symbols = changes[index]
        step = bar.length / max(1, len(symbols))
        chords.extend((bar.start + i * step, s) for i, s in enumerate(symbols))
        # Whatever was sounding at the end of the bar carries on into the next.
        if held and index + 1 < len(score.bars) and not any(t == bar.end for t, _ in chords):
            chords.append((bar.end, held))
        chords.sort()
    tidy = []
    for when, symbol in sorted(chords):
        if tidy and tidy[-1][1] == symbol:
            continue
        tidy.append((when, symbol))
    return replace(score, chords=tidy)


def edit(score, transpose_by=0, bpm=None, chords=None):
    """Apply the studio's score edits in a fixed order."""
    if chords:
        score = with_bar_chords(score, chords)
    if transpose_by:
        score = transpose(score, transpose_by)
    if bpm:
        score = with_tempo(score, bpm)
    return score


# ------------------------------------------------------------------- reading

def sections(score):
    """(first bar, label) for every section, in order; a score with none is one verse."""
    found = [(i, bar.sections[-1]) for i, bar in enumerate(score.bars) if bar.sections]
    if not found or found[0][0] != 0:
        found.insert(0, (0, found[0][1] if found else "verse"))
    return found


def tag(label):
    return "[" + "-".join(part.capitalize() for part in label.replace(" and ", " ").split()[0].split("-")) + "]"


def lyric_tags(score):
    """Section tags with no words, for renders that must not sing."""
    return "\n\n".join(tag(label) for _, label in sections(score)) + "\n"


def profile(score, index):
    """The pitch classes bar `index` should sound: its chords, then its melody."""
    import numpy as np
    bar = score.bars[index]
    weights = np.zeros(12)
    spans = []
    held = next(((t, s) for t, s in reversed(score.chords) if t <= bar.start), None)
    changes = ([(bar.start, held[1])] if held else []) + [(t, s) for t, s in score.chords if bar.start < t < bar.end]
    for i, (when, symbol) in enumerate(changes):
        stop = changes[i + 1][0] if i + 1 < len(changes) else bar.end
        spans.append((symbol, float((stop - when) / bar.length)))
    for symbol, share in spans:
        match = ROOT.match(symbol)
        if not match:
            continue
        root = PITCH_CLASS[match.group(1)]
        for step in QUALITY_TONES.get(match.group(2), (0, 4, 7)):
            weights[(root + step) % 12] += share
    for onset, pitch, duration in score.vocal + score.ins:
        overlap = min(bar.end, onset + duration) - max(bar.start, onset)
        if overlap > 0:
            weights[pitch % 12] += 0.7 * float(overlap / bar.length)
    total = np.linalg.norm(weights)
    return weights / total if total else weights


# -------------------------------------------------------------- lyrics & time

def lyrics_by_time(lines, score, clock):
    """Put each transcribed line under the section it was sung in."""
    parts = sections(score)
    blocks = []
    for k, (bar, label) in enumerate(parts):
        lo = clock[bar] if k else float("-inf")
        hi = clock[parts[k + 1][0]] if k + 1 < len(parts) else float("inf")
        words = [line["text"] for line in lines if lo <= (line["start"] + line["end"]) / 2 < hi]
        blocks.append("\n".join([tag(label)] + words))
    return "\n\n".join(blocks) + "\n"


def lyrics_by_notes(text, score):
    """Spread untagged lyrics over the sections that have sung notes."""
    if re.search(r"^\s*\[[^\]]+\]\s*$", text, re.M):
        return text.strip() + "\n"
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    parts = sections(score)
    bounds = [score.bars[bar].start for bar, _ in parts] + [score.length]
    notes = [sum(1 for t, _, _ in score.vocal if a <= t < b) for a, b in zip(bounds, bounds[1:])]
    total = sum(notes) or 1
    blocks, used = [], 0
    for k, (_, label) in enumerate(parts):
        share = round(len(lines) * sum(notes[:k + 1]) / total)
        blocks.append("\n".join([tag(label)] + lines[used:share]))
        used = share
    return "\n\n".join(blocks) + "\n"


def key_words(key):
    return (key[:-1] + " minor") if key.endswith("m") else (key + " major")


def time_of(score, clock):
    """Seconds, in the original recording, of a time in quarter notes."""
    starts = [bar.start for bar in score.bars] + [score.length]

    def at(q):
        i = max(0, min(len(score.bars) - 1, next((k for k in range(len(score.bars)) if q < starts[k + 1]),
                                                   len(score.bars) - 1)))
        share = float((q - starts[i]) / (starts[i + 1] - starts[i]))
        return clock[i] + share * (clock[i + 1] - clock[i])
    return at
