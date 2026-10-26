"""Turn a sung vocal into lyrics with section tags: [intro], [verse], [chorus],
[bridge], [inst] and [outro].

HeartTranscriptor writes the words but gives no timings, so the vocal is cut
where the singing stops and each sung stretch is transcribed on its own. That
places every line roughly in time. Long stretches without singing become
[intro], [inst] or [outro]; lines that come back later in the song are the
chorus, the rest are verses, and new words after the second chorus are the
bridge. Everything here is plain numpy, so it is tested without the models.
"""
import difflib
import re

import numpy as np

WINDOW = 28.0   # longest stretch sent to the transcriber (Whisper hears 30 s)
JOIN = 1.0      # pauses shorter than this stay inside one sung stretch
SHORTEST = 0.6  # shorter blips are breaths or bleed, not singing
EDGE = 4.0      # this much music before the first or after the last word is an intro/outro
BREAK = 6.0     # this much music between words is an instrumental break
AGAIN = 10.0    # a line heard again at least this much later counts as a repeat
ALIKE = 0.72    # how close two lines must read to be the same line
CJK = re.compile("[぀-ヿ㐀-鿿가-힯]")  # kana, CJK ideographs, Hangul


def lines_of(text):
    """HeartTranscriptor writes the lyrics as one run, starting each sung line with a
    capital (the pronoun I aside) and sometimes ending sentences: start a line at either."""
    text = " ".join((text or "").split())
    if CJK.search(text) and not re.search(r"[A-Z]", text):
        # Chinese, Japanese and Korean have no capitals; the transcriber puts a space
        # between sung phrases instead, so each phrase is a line.
        return [line for line in re.split(r"(?<=[。！？!?])|\s+", text) if line.strip()]
    lines = re.split(r"(?<=[.!?。！？])\s*|\s+(?=[A-Z])(?!(?:I|Ill|Im|Ive|Id)\b|I['’])", text)
    return [line.strip() for line in lines if line and line.strip()]


def sung_spans(mono, sr, top_db=32.0):
    """(start, end) seconds of each sung stretch, cut at pauses and at most WINDOW long."""
    import librosa
    hop = max(1, sr // 50)
    found = librosa.effects.split(np.asarray(mono, dtype=np.float32), top_db=top_db,
                                  frame_length=hop * 4, hop_length=hop)
    pieces = []
    for start, end in found / float(sr):
        if pieces and start - pieces[-1][-1][1] < JOIN:
            pieces[-1].append((start, end))
        else:
            pieces.append([(start, end)])
    spans = []
    for group in pieces:
        if group[-1][1] - group[0][0] < SHORTEST:
            continue
        # Pack the stretch into windows, cutting only in its short pauses...
        begin, last = group[0][0], group[0][1]
        for start, end in group[1:]:
            if end - begin > WINDOW:
                spans.append((begin, last))
                begin = start
            last = end
        spans.append((begin, last))
    # ...and cut any single stretch still too long into equal pieces.
    out = []
    for start, end in spans:
        parts = int(np.ceil((end - start) / WINDOW)) or 1
        step = (end - start) / parts
        out += [(start + i * step, start + (i + 1) * step) for i in range(parts)]
    return out


def _plain(line):
    return re.sub(r"[^\w\s]", "", line.lower()).strip()


def _timed(heard):
    """Each line with a rough time: a stretch's lines share its span by length."""
    timed = []
    for (start, end), text in heard:
        lines = lines_of(text)
        total = sum(len(line) for line in lines) or 1
        at = start
        for line in lines:
            timed.append((at, line))
            at += (end - start) * len(line) / total
    return timed


def _runs(timed, gaps):
    """Lines grouped into runs of repeated (chorus) and new (verse) words."""
    plain = [_plain(line) for _, line in timed]
    repeated = []
    for i, (at, _) in enumerate(timed):
        repeated.append(bool(plain[i]) and any(
            abs(at - other) >= AGAIN and plain[j]
            and difflib.SequenceMatcher(None, plain[i], plain[j]).ratio() >= ALIKE
            for j, (other, _) in enumerate(timed) if j != i))
    # A lone line that disagrees with both neighbours is noise, not a new section.
    for i in range(1, len(repeated) - 1):
        if repeated[i - 1] == repeated[i + 1] != repeated[i]:
            repeated[i] = repeated[i - 1]
    runs = []
    for i, (at, line) in enumerate(timed):
        # A long pause always ends a section, even between lines of the same kind.
        if runs and runs[-1][0] == repeated[i] and not gaps.get(i):
            runs[-1][1].append(line)
        else:
            runs.append((repeated[i], [line]))
    return runs


def sections(heard, duration):
    """Lyrics with section tags from [((start, end), text), ...] in singing order."""
    heard = [(span, text) for span, text in heard if lines_of(text)]
    if not heard:
        return ""
    timed = _timed(heard)
    # Where an instrumental break falls, as "before line i".
    first_line, breaks, at = {}, {}, 0
    for index, ((start, end), text) in enumerate(heard):
        first_line[index] = at
        at += len(lines_of(text))
    for index in range(1, len(heard)):
        if heard[index][0][0] - heard[index - 1][0][1] >= BREAK:
            breaks[first_line[index]] = True
    blocks = []
    if heard[0][0][0] >= EDGE:
        blocks.append(("intro", []))
    choruses = 0
    runs = _runs(timed, breaks)
    line = 0
    for position, (repeated, lines) in enumerate(runs):
        if breaks.get(line) and blocks and blocks[-1][0] != "intro":
            blocks.append(("inst", []))
        if repeated:
            label = "chorus"
            choruses += 1
        else:
            later = any(r for r, _ in runs[position + 1:])
            label = "bridge" if choruses >= 2 and later else "verse"
        blocks.append((label, lines))
        line += len(lines)
    if duration - heard[-1][0][1] >= EDGE:
        blocks.append(("outro", []))
    return "\n\n".join("[%s]%s" % (label, "".join("\n" + l for l in lines))
                       for label, lines in blocks) + "\n"
