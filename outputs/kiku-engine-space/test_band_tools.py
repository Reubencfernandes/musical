"""Verify the band-following helpers: beat grid, chords, guide track and alignment."""
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio_tools as tools

SR = 22050
BPM = 100.0
BEAT = 60.0 / BPM
# Two beats of pickup, then C, Am, F, G for a bar each, twice.
PROGRESSION = ["C", "Am", "F", "G"] * 2
PICKUP = 2
failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + detail))
    if not condition:
        failures.append(label)


def pluck(freq, seconds):
    t = np.arange(int(seconds * SR)) / SR
    wave = sum(np.sin(2 * np.pi * freq * h * t) / h ** 1.3 for h in (1, 2, 3))
    envelope = np.exp(-3.0 * t)
    envelope[:40] *= np.linspace(0, 1, 40)
    return wave * envelope


def freq(name, octave=4):
    return 440.0 * 2 ** ((tools.NOTES.index(name) - 9) / 12 + (octave - 4))


def triad(symbol):
    root = symbol.rstrip("m")
    shape = tools.QUALITIES["minor" if symbol.endswith("m") else "major"]
    index = tools.NOTES.index(root)
    return [tools.NOTES[(index + step) % 12] for step in shape]


def build():
    """A plucked arpeggio: one chord tone per beat, a new chord every bar."""
    beats = []
    for symbol in PROGRESSION:
        tones = triad(symbol)
        beats += [tones[0], tones[1], tones[2], tones[1]]
    beats = [triad("G")[0], triad("G")[2]] + beats
    audio = np.zeros(int((len(beats) + 1) * BEAT * SR))
    for number, name in enumerate(beats):
        start = int(number * BEAT * SR)
        note = pluck(freq(name), BEAT * 1.5) + 0.6 * pluck(freq(name, 3), BEAT * 1.5)
        end = min(len(audio), start + len(note))
        audio[start:end] += note[: end - start]
    return audio / np.max(np.abs(audio)) * 0.8


audio = build()
duration = len(audio) / SR

print("1. beat_grid() finds a steady grid")
beats, tempo = tools.beat_grid(audio, SR)
print("  tempo=%.2f beats=%d first=%.3f" % (tempo, len(beats), beats[0] if len(beats) else -1))
check("tempo within 1 BPM of 100 (or its octaves)",
      any(abs(tempo - c) <= 1.0 for c in (50, 100, 200)), "got %.2f" % tempo)
check("grid covers the recording", len(beats) and beats[-1] > duration - 2 * BEAT)
if abs(tempo - 100) <= 1.0:
    drift = np.abs(((beats - 0.0) / BEAT) - np.round(beats / BEAT)) * BEAT
    check("beats sit on the true grid (< 40 ms)", float(np.median(drift)) < 0.04,
          "median error %.3f s" % float(np.median(drift)))

print("\n2. bpm override builds an exact grid")
fixed, fixed_tempo = tools.beat_grid(audio, SR, bpm=100)
check("override keeps the given tempo", fixed_tempo == 100.0)
check("override spacing is exact", np.allclose(np.diff(fixed), BEAT))

print("\n3. chords() recovers the progression")
path = str(Path(tempfile.mkdtemp(prefix="kiku-band-")) / "arpeggio.wav")
sf.write(path, audio, SR)
_, key, _, _ = tools.analyse(path)
grid = np.arange(0, duration, BEAT)
found = tools.chords(audio, SR, grid, key)
names = [tools.chord_name(c) for c in found]
print("  key=%s chords=%s" % (key, " ".join(names)))
bars = (found[1]["time"] - PICKUP * BEAT) / (4 * BEAT) if len(found) > 1 else 0.5
check("bar lines fall after the pickup", abs(bars - round(bars)) < 0.02,
      "second chord at %.3f" % (found[1]["time"] if len(found) > 1 else -1))
hits = sum(a == b for a, b in zip(names[1:], PROGRESSION))
check("at least 6 of 8 bars named correctly", hits >= 6, "%d correct: %s" % (hits, names))

print("\n4. guide() renders a usable track")
track = tools.guide(grid, found, duration)
check("guide has the recording's length", abs(len(track) / tools.GUIDE_SR - duration) < 0.01)
check("guide is audible and headroom-safe", 0.3 < float(np.max(np.abs(track))) <= 0.81)
drums_only = tools.guide(grid, found, duration, parts=("drums",))
check("parts can be isolated", not np.allclose(drums_only, track))
guide_beats, guide_tempo = tools.beat_grid(
    tools.librosa.resample(track, orig_sr=tools.GUIDE_SR, target_sr=SR), SR)
check("the guide carries the same tempo",
      any(abs(guide_tempo - c) <= 1.0 for c in (50, 100, 200)), "got %.2f" % guide_tempo)

print("\n5. offset_between() measures a known delay")
delayed = tools.shift(audio, 0.12, SR)[0]
measured = tools.offset_between(delayed, audio, SR)
print("  measured %.3f s for a 0.120 s delay" % measured)
check("offset within 25 ms", abs(measured - 0.12) < 0.025, "got %.3f" % measured)
restored = tools.shift(audio, measured, SR, length=len(audio))
check("shift() keeps the requested length", restored.shape == (1, len(audio)))

print("\n6. has_backing() separates noise from music")
noise = np.random.default_rng(1).standard_normal(len(audio)) * 0.01
check("room noise is not backing", not tools.has_backing(audio, noise))
check("a full-level bed is backing", tools.has_backing(audio, audio * 0.7))

print("\n7. loudness() ignores the gaps between phrases")
phrase = np.concatenate([audio[: SR * 2], np.zeros(SR * 6)])
check("a phrase with long gaps measures as loud as the phrase",
      abs(tools.loudness(phrase, SR) - tools.loudness(audio[: SR * 2], SR)) < 0.2 * tools.loudness(audio[: SR * 2], SR),
      "%.4f vs %.4f" % (tools.loudness(phrase, SR), tools.loudness(audio[: SR * 2], SR)))

print("\n8. has_voice() tells a take from an instrumental idea")
quiet_residue = audio * 0.01
check("a near-silent vocal stem under a loud bed is no voice",
      not tools.has_voice(quiet_residue, audio, SR))
check("a real vocal over a backing is a voice", tools.has_voice(audio, audio * 0.8, SR))
check("a clean vocal with an empty backing is a voice", tools.has_voice(audio, audio * 0.001, SR))

print("\n9. mix() never lets a near-silent vocal mute the band")
mix_dir = Path(tempfile.mkdtemp(prefix="kiku-mix-"))
band = tools.to_stereo(audio, SR)
out = tools.mix(tools.to_stereo(audio * 0.0005, SR), band, str(mix_dir / "quiet.wav"), sr=SR)
mixed, _ = sf.read(out, always_2d=True)
check("the band stays audible under a failed separation",
      float(np.sqrt(np.mean(mixed ** 2))) > 0.01, "rms %.4f" % float(np.sqrt(np.mean(mixed ** 2))))

print("\n10. put_back() keeps the voice and the original balance")
voice = tools.to_stereo(audio, SR)
old_backing = tools.to_stereo(np.roll(audio, SR // 3) * 0.5, SR)
new_backing = tools.to_stereo(np.roll(audio, SR // 5) * 3.0, SR)[:, : voice.shape[1] - 1000]
# The Spaces call put_back with everything already at tools.SR (48 kHz).
out, _ = sf.read(tools.put_back(voice, new_backing, old_backing, str(mix_dir / "kept.wav")),
                 always_2d=True)
out = out.T
check("result is exactly as long as the vocal", out.shape[1] == voice.shape[1],
      "%d vs %d" % (out.shape[1], voice.shape[1]))
residual = out - voice
check("new backing sits at the old backing's loudness",
      abs(tools.loudness(residual) - tools.loudness(old_backing)) < 0.15 * tools.loudness(old_backing),
      "%.4f vs %.4f" % (tools.loudness(residual), tools.loudness(old_backing)))
check("the vocal is still there", float(np.corrcoef(out[0], voice[0])[0, 1]) > 0.3)

print("\n" + ("ALL CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
sys.exit(1 if failures else 0)
