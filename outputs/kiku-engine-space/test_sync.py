"""Lock a strict-tempo rendering onto a performance whose bars breathe."""
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scores
import sync

SR = 22050
failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + str(detail)))
    if not condition:
        failures.append(label)


def play(score, bar_times, sr=SR, lead=0.0, total=None, beat_times=None):
    """Sine rendering: chord tones plus melody, bar i spanning bar_times[i:i+2].
    `beat_times`, one per quarter note, overrides the even spread inside bars."""
    end = total or bar_times[-1] + lead + 0.5
    out = np.zeros(int(end * sr))

    def to_time(q):
        if beat_times is not None:
            return lead + float(np.interp(float(q), np.arange(len(beat_times)), beat_times))
        i = next(k for k, bar in enumerate(score.bars) if bar.start <= q < bar.end or k == len(score.bars) - 1)
        bar = score.bars[i]
        share = float((q - bar.start) / bar.length)
        return lead + bar_times[i] + share * (bar_times[i + 1] - bar_times[i])

    def tone(pitch, a, b, level):
        lo, hi = int(a * sr), min(len(out), int(b * sr))
        if hi <= lo:
            return
        t = np.arange(hi - lo) / sr
        env = np.exp(-2.5 * t) * np.minimum(1, t * 200)
        out[lo:hi] += level * env * np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * t)

    for onset, pitch, duration in score.vocal + score.ins:
        tone(pitch, to_time(onset), to_time(min(onset + duration, score.length - scores.Fraction(1, 64))), 0.3)
    for i, bar in enumerate(score.bars):
        for symbol in scores.bar_chords(score, i)[:1]:
            match = scores.ROOT.match(symbol)
            root = scores.PITCH_CLASS[match.group(1)]
            for step in scores.QUALITY_TONES.get(match.group(2), (0, 4, 7)):
                tone(48 + (root + step) % 12, lead + bar_times[i], lead + bar_times[i + 1], 0.2)
    return out


score = scores.read((Path(__file__).resolve().parent / "fixtures" / "score.abc").read_text(encoding="utf-8"))
bars = len(score.bars)
per_bar = score.seconds(score.bars[0].length)
rng = np.random.default_rng(7)
# The singer: bars wander up to 12% either way, starting 0.4 s in.
lengths = per_bar * (1 + rng.uniform(-0.12, 0.12, bars))
target = [0.4] + list(0.4 + np.cumsum(lengths))
duration = target[-1] + 0.3
performance = play(score, target, total=duration)

# YuE2: strict tempo, 1.1 s of lead-in, and it rings on for a second.
strict = sync.uniform_starts(bars, per_bar)
lead = 1.1
generated = play(score, strict, lead=lead, total=strict[-1] + lead + 1.0)
heard = [t + lead for t in strict]

print("bar_starts from beat rows")
rows = [(0.5 + k * 0.5, k % 4 + 1, 4) for k in range(10)]
found = sync.bar_starts(rows, 4, 6.0)
check("bars start on each downbeat and extrapolate", found[:3] == [0.5, 2.5, 4.5], found)
pickup = sync.bar_starts([(0.2, 3, 4), (0.7, 4, 4), (1.2, 1, 4), (1.7, 2, 4)], 2, 4.0)
check("a pickup bar starts on the first beat", pickup[:2] == [0.2, 1.2], pickup)

print("\nlock()")
stereo = np.stack([generated, generated])
warped, report = sync.lock(stereo, SR, score, target, heard, duration)
print("  report:", report)
check("most bars matched", report["matched"] >= bars - 2, report)
check("a warp was produced", warped is not None)
if warped is not None:
    check("output is exactly the recording's length", warped.shape[1] == int(round(duration * SR)),
          warped.shape)
    import librosa
    env_w = librosa.onset.onset_strength(y=warped[0], sr=SR, hop_length=256)
    env_p = librosa.onset.onset_strength(y=performance, sr=SR, hop_length=256)
    errors = []
    for t in target[1:-1]:
        frame = int(t * SR / 256)
        window = slice(max(0, frame - 40), frame + 40)
        peak_w = int(np.argmax(env_w[window])) + window.start
        peak_p = int(np.argmax(env_p[window])) + window.start
        errors.append(abs(peak_w - peak_p) * 256 / SR)
    median = float(np.median(errors))
    print("  bar-line error: median %.3f s, worst %.3f s" % (median, max(errors)))
    check("bar lines land within 30 ms of the performance", median < 0.03, median)

    # Without the warp, the same bars are far out.
    plain = np.zeros_like(warped[0])
    shift = int((target[0] - heard[0]) * SR)
    src = generated[max(0, -shift):]
    plain[max(0, shift):max(0, shift) + len(src)] = src[:len(plain) - max(0, shift)]
    env_n = librosa.onset.onset_strength(y=plain, sr=SR, hop_length=256)
    drift = []
    for t in target[1:-1]:
        frame = int(t * SR / 256)
        window = slice(max(0, frame - 40), frame + 40)
        drift.append(abs(int(np.argmax(env_n[window])) - int(np.argmax(env_p[window]))) * 256 / SR)
    print("  unwarped error for comparison: median %.3f s" % float(np.median(drift)))

print("\nlock() on every beat")
# A singer who pushes and pulls inside the bar, not only across bars.
quarters = int(score.length)
spacing = score.seconds(1) * (1 + rng.uniform(-0.18, 0.18, quarters))
beat_times = np.concatenate([[0.4], 0.4 + np.cumsum(spacing)])
bar_lines = [float(beat_times[int(bar.start)]) for bar in score.bars] + [float(beat_times[-1])]
swing_len = bar_lines[-1] + 0.3
swung = play(score, bar_lines, total=swing_len, beat_times=beat_times)
strict_beats = [lead + score.seconds(q) for q in range(quarters + 1)]


def beat_error(y):
    import librosa
    env_y = librosa.onset.onset_strength(y=y, sr=SR, hop_length=256)
    env_p = librosa.onset.onset_strength(y=swung, sr=SR, hop_length=256)
    errors = []
    for t in beat_times[1:-1]:
        frame = int(t * SR / 256)
        window = slice(max(0, frame - 12), frame + 12)
        errors.append(abs(int(np.argmax(env_y[window])) - int(np.argmax(env_p[window]))) * 256 / SR)
    return float(np.median(errors)), float(np.mean(np.array(errors) < 0.03))


by_bar, _ = sync.lock(stereo, SR, score, bar_lines, heard, swing_len)
by_beat, report = sync.lock(stereo, SR, score, bar_lines, heard, swing_len,
                            target_beats=beat_times.tolist(), heard_beats=strict_beats)
print("  report:", report)
bar_med, bar_hit = beat_error(by_bar[0])
beat_med, beat_hit = beat_error(by_beat[0])
print("  every-beat error: bars only %.3f s (%.0f%% within 30 ms), with beats %.3f s (%.0f%% within 30 ms)"
      % (bar_med, 100 * bar_hit, beat_med, 100 * beat_hit))
check("beat anchors were used", report["beats"] > 0, report)
check("beat anchors put more beats within 30 ms", beat_hit > bar_hit, (bar_hit, beat_hit))
check("beats land within 30 ms of the performance", beat_med < 0.03, beat_med)

print("\ntimemap()")
# Bar lines matched past the end of a short render must not reach the map.
src, dst = sync.timemap([(1.0, 0.5), (3.0, 2.6), (5.0, 4.4), (9.0, 8.0)], 6 * SR, SR, 7.0)
check("the map ends inside the audio", src[-1] <= 6 * SR, src)
check("both sides strictly rise", all(b > a for a, b in zip(src, src[1:])) and all(b > a for a, b in zip(dst, dst[1:])))
check("the lead-in keeps its natural speed", src[0] == int(0.5 * SR) and dst[0] == 0, (src[0], dst[0]))
check("too few bar lines give no map", sync.timemap([(1.0, 1.0)], SR, SR, 1.0) is None)

print("\n" + ("ALL CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
sys.exit(1 if failures else 0)
