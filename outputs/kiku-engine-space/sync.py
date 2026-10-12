"""Put generated music on a recording's own bar lines.

YuE2 plays a score at the score's tempo, but it does not promise exact
timing, and the singer's recording breathes: bars are never all the same
length. So the new audio is matched to the recording bar by bar and time-warped
until each of its bars starts where the recording's bar starts.

- `bar_starts` turns SheetSage2's beats into the start time of every score bar.
- `match` pairs the generated audio's bars with the score's bars by harmony,
  using dynamic time warping so a bar YuE2 added, dropped or smeared costs a
  little and does not shift everything after it.
- `warp` stretches the generated audio between matched bar lines.
"""
import logging
import shutil

import numpy as np

# A bar that has to shrink or grow more than this is a bad match, not a tempo
# wobble, and is left out of the warp.
MIN_RATIO, MAX_RATIO = 0.6, 1.7


def beat_rows(text):
    """SheetSage2's beat.lab: (time, position in bar, beats per bar)."""
    rows = []
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) >= 3:
            rows.append((float(parts[0]), int(parts[1]), int(parts[2])))
    return rows


def bar_starts(beats, bars, duration):
    """Start times of `bars` score bars, plus the end of the last one.

    SheetSage2 builds its score from the same beats: a bar starts on each
    downbeat, a pickup bar on the first beat, and past the last detected beat
    the final beat period carries on. Returns None when there are too few beats.
    """
    if len(beats) < 2 or bars < 1:
        return None
    times = [b[0] for b in beats]
    period = float(np.median(np.diff(times[-9:])))
    if period <= 0:
        return None
    starts = [t for i, (t, position, _) in enumerate(beats) if i == 0 or position == 1]
    per_bar = beats[-1][2] * period
    while len(starts) < bars + 1:
        starts.append(starts[-1] + per_bar)
    starts = starts[:bars + 1]
    # The notation pads its last bar out to the end of the audio.
    starts[-1] = max(starts[-1], min(duration, starts[-2] + per_bar))
    return [round(float(t), 4) for t in starts]


def uniform_starts(bars, seconds_per_bar, offset=0.0):
    return [round(offset + i * seconds_per_bar, 4) for i in range(bars + 1)]


def bar_chroma(audio, sr, starts):
    """Mean chroma of each bar [starts[i], starts[i+1]), normalised."""
    import librosa
    mono = audio.mean(axis=0) if audio.ndim == 2 else audio
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=mono.astype(np.float32), sr=sr, hop_length=hop)
    frames = chroma.shape[1]
    rows = []
    for a, b in zip(starts, starts[1:]):
        lo, hi = int(a * sr / hop), max(int(a * sr / hop) + 1, int(b * sr / hop))
        lo, hi = min(lo, frames - 1), min(hi, frames)
        vector = chroma[:, lo:hi].mean(axis=1) if hi > lo else np.zeros(12)
        norm = np.linalg.norm(vector)
        rows.append(vector / norm if norm else vector)
    return np.array(rows)


def match(expected, heard, skip=0.35, stretch=0.25):
    """Pair score bars (rows of `expected`) with generated bars (rows of `heard`).

    Every score bar is placed. Generated bars can be skipped at a cost, or two
    score bars can land on one generated bar at a cost; skipping generated bars
    before the first match and after the last is free, since YuE2 can lead in
    or ring out. Returns a list of (score bar, generated bar) diagonal matches.
    """
    n, m = len(expected), len(heard)
    if not n or not m:
        return []
    cost = 1.0 - np.clip(expected @ heard.T, 0.0, 1.0)
    big = 1e9
    total = np.full((n + 1, m + 1), big)
    total[0, :] = 0.0  # free lead-in on the generated side
    step = np.zeros((n + 1, m + 1), dtype=np.int8)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            options = (total[i - 1, j - 1] + cost[i - 1, j - 1],  # 0: bar for bar
                       total[i - 1, j] + cost[i - 1, j - 1] + stretch,  # 1: score bar shares a heard bar
                       total[i, j - 1] + skip)  # 2: skip a heard bar
            choice = int(np.argmin(options))
            total[i, j], step[i, j] = options[choice], choice
    i, j = n, int(np.argmin(total[n, 1:])) + 1  # free ring-out
    pairs = []
    while i > 0 and j > 0:
        choice = step[i, j]
        if choice == 0:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif choice == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def beats_within(pairs, target, heard, target_beats, heard_beats):
    """(generated, recording) points for the beats inside matched bars.

    A bar is only subdivided when both sides found the same number of beats in
    it; otherwise its bar line alone holds it, which is still correct, just
    looser inside the bar.
    """
    if target_beats is None or heard_beats is None:
        return []
    ours, theirs = np.asarray(target_beats, dtype=float), np.asarray(heard_beats, dtype=float)
    points = []
    for i, j in pairs:
        # A small margin keeps a beat that sits right on a bar line in its own bar.
        want = ours[(ours > target[i] + 0.03) & (ours < target[i + 1] - 0.03)]
        got = theirs[(theirs > heard[j] + 0.03) & (theirs < heard[j + 1] - 0.03)]
        if len(want) and len(want) == len(got):
            points.extend(zip(got.tolist(), want.tolist()))
    return points


def anchors(pairs, target, heard, extra=()):
    """(generated time, recording time) points for every trustworthy bar line,
    plus any beat points inside the bars, in time order."""
    points = []
    for i, j in pairs:
        points.append((heard[j], target[i]))
    last_i, last_j = pairs[-1] if pairs else (None, None)
    if pairs:
        points.append((heard[last_j + 1], target[last_i + 1]))
    points = sorted(points + list(extra))
    kept = []
    for source, dest in points:
        if kept:
            gap_in, gap_out = source - kept[-1][0], dest - kept[-1][1]
            if gap_in <= 0.05 or gap_out <= 0.05:
                continue
            if not MIN_RATIO <= gap_out / gap_in <= MAX_RATIO:
                continue
        kept.append((source, dest))
    return kept


def _stretch_segment(segment, sr, length):
    import librosa
    if length <= 0 or segment.shape[-1] == 0:
        return np.zeros((segment.shape[0], max(0, length)), dtype=np.float32)
    rate = segment.shape[-1] / length
    out = np.stack([librosa.effects.time_stretch(ch, rate=rate) for ch in segment])
    if out.shape[1] < length:
        out = np.pad(out, ((0, 0), (0, length - out.shape[1])))
    return out[:, :length]


def timemap(points, length, sr, duration):
    """Sample positions (source, destination) for the warp, both strictly rising.

    Material before the first bar line and after the last keeps its natural
    speed. Bar lines past the end of the audio (the render can be shorter than
    the bars it was matched to) are dropped, so the map always ends inside the
    audio, which Rubber Band requires.
    """
    if len(points) < 2:
        return None
    seconds = length / float(sr)
    first_in, first_out = points[0]
    lead = min(first_in, first_out)
    kept = []
    for a, b in [(first_in - lead, first_out - lead)] + list(points):
        if a > seconds:
            break
        if kept and (a <= kept[-1][0] or b <= kept[-1][1]):
            continue
        kept.append((a, b))
    last_in, last_out = kept[-1]
    tail = max(0.0, min(seconds - last_in, duration - last_out))
    if tail > 1e-3:
        kept.append((last_in + tail, last_out + tail))
    src, dst = [], []
    for a, b in kept:
        s, d = min(length, int(round(a * sr))), int(round(b * sr))
        if src and (s <= src[-1] or d <= dst[-1]):
            continue
        src.append(s)
        dst.append(d)
    return (src, dst) if len(src) >= 2 else None


def warp(audio, sr, points, duration):
    """Stretch stereo `audio` so each anchor's generated time lands on its
    recording time, and return exactly `duration` seconds.

    Uses Rubber Band's time map when it is installed (one pass, high quality),
    and a per-segment phase vocoder otherwise.
    """
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[None, :]
    total = int(round(duration * sr))
    out = np.zeros((audio.shape[0], total), dtype=np.float32)
    marks = timemap(points, audio.shape[1], sr, duration)
    if marks is None:
        return None
    src, dst = marks
    piece = audio[:, src[0]:src[-1]]
    stretched = None
    if shutil.which("rubberband"):
        import pyrubberband
        mapping = [(s - src[0], d - dst[0]) for s, d in zip(src, dst)]
        try:
            stretched = pyrubberband.timemap_stretch(piece.T, sr, mapping).T.astype(np.float32)
        except Exception:
            logging.exception("Rubber Band refused the time map; using the phase vocoder")
    if stretched is None:
        stretched = np.concatenate([_stretch_segment(audio[:, a:b], sr, d - c)
                                    for a, b, c, d in zip(src, src[1:], dst, dst[1:])], axis=1)
    begin = dst[0]
    end = min(total, begin + stretched.shape[1])
    if end > begin:
        out[:, begin:end] = stretched[:, :end - begin]
    return out


def lock(audio, sr, score, target, heard, duration, target_beats=None, heard_beats=None):
    """The whole job: match bars by harmony, then warp on every bar line and,
    when both beat lists are known, every beat. Returns (audio, report)."""
    expected = np.array([_profile(score, i) for i in range(len(target) - 1)])
    heard_chroma = bar_chroma(audio, sr, heard)
    pairs = match(expected, heard_chroma)
    inside = beats_within(pairs, target, heard, target_beats, heard_beats)
    points = anchors(pairs, target, heard, inside)
    warped = warp(audio, sr, points, duration)
    report = {"bars": len(target) - 1, "heard_bars": len(heard) - 1, "matched": len(pairs),
              "beats": len(inside), "anchors": len(points), "warped": warped is not None}
    return warped, report


def _profile(score, index):
    import scores
    return scores.profile(score, index)
