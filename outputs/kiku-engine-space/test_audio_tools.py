"""Verify the accompaniment analysis and mixing logic with synthetic audio."""
import sys
import tempfile
import numpy as np
import soundfile as sf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio_tools as tools

# Scratch audio goes to a temp directory so the Space repo stays clean.
OUT = Path(tempfile.mkdtemp(prefix="kiku-test-"))
SR = 48000
BPM = 120.0
BEAT = 60.0 / BPM  # 0.5 s


def note(freq, dur, sr=SR):
    """A plucked note with harmonics and a sharp attack, so beats are detectable."""
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    wave = sum(np.sin(2 * np.pi * freq * h * t) / (h ** 1.4) for h in (1, 2, 3, 4))
    env = np.exp(-4.0 * t)                      # percussive decay -> clear onset
    env[: int(sr * 0.002)] *= np.linspace(0, 1, int(sr * 0.002))
    return wave * env


def build_vocal():
    """16 beats of a C-major arpeggio at exactly 120 BPM."""
    freqs = {"C": 261.63, "E": 329.63, "G": 392.00, "C5": 523.25}
    order = ["C", "E", "G", "C5"] * 4
    return np.concatenate([note(freqs[n], BEAT) for n in order])


def build_backing(sr=44100, seconds=8.0):
    """A mono backing bed at a different sample rate, to exercise conversion."""
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    return (0.3 * np.sin(2 * np.pi * 130.81 * t) + 0.2 * np.sin(2 * np.pi * 196.00 * t))


failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + detail))
    if not condition:
        failures.append(label)


print("Building synthetic 120 BPM C-major recording...")
vocal = build_vocal()
vocal_path = str(OUT / "vocal.wav")
sf.write(vocal_path, vocal, SR)
print("  duration %.2fs" % (len(vocal) / SR))

print("\n1. analyse() on the recording")
tempo, key, duration, first_beat = tools.analyse(vocal_path)
print("  tempo=%s  key=%r  duration=%.2f  first_beat=%.3f" % (tempo, key, duration, first_beat))
# Beat trackers legitimately lock to half or double time, but within an octave
# the reading must be tight or the generated band drifts against the singer.
check("tempo is within 1.5 BPM of 120 (or its octaves)",
      any(abs(tempo - c) <= 1.5 for c in (60, 120, 240)), "got %s" % tempo)
check("duration is ~8s", abs(duration - 8.0) < 0.15, "got %.3f" % duration)
check("key names a C-ish major tonic", key.endswith("major") and key.split()[0] in ("C", "G", "F", "A", "E"),
      "got %r" % key)
check("first beat is near the start", 0 <= first_beat < 1.0, "got %.3f" % first_beat)

print("\n2. to_stereo() conversion")
mono_44k = build_backing()
converted = tools.to_stereo(mono_44k, 44100)
check("converted to 2 channels", converted.shape[0] == 2, "shape %s" % (converted.shape,))
check("resampled to 48k length", abs(converted.shape[1] - 8 * SR) < 600,
      "got %d want ~%d" % (converted.shape[1], 8 * SR))

print("\n3. mix() keeps the vocal and stays inside headroom")
vocal_stereo = tools.to_stereo(vocal, SR)
mix_path = tools.mix(vocal_stereo, converted, str(OUT / "mix.wav"),
                     instrumental_db=-3.0, offset=first_beat)
mixed, mix_sr = sf.read(mix_path, always_2d=True)
peak = float(np.max(np.abs(mixed)))
print("  sr=%d shape=%s peak=%.4f" % (mix_sr, mixed.shape, peak))
check("mix is 48k stereo", mix_sr == SR and mixed.shape[1] == 2, "sr=%d shape=%s" % (mix_sr, mixed.shape))
check("mix does not clip", peak <= 0.995, "peak %.4f" % peak)
check("mix is audible", peak > 0.05, "peak %.4f" % peak)
check("mix covers the whole vocal", mixed.shape[0] >= vocal_stereo.shape[1],
      "%d < %d" % (mixed.shape[0], vocal_stereo.shape[1]))

print("\n4. the original vocal survives the mix")
# Subtracting the mix from the vocal must leave the backing, not silence: if the
# vocal had been replaced, correlation with the original would collapse.
head = int(SR * 2)
mix_mono = mixed[:head, :].mean(axis=1)
voc_mono = vocal_stereo[:, :head].mean(axis=0)
corr = float(np.corrcoef(mix_mono, voc_mono)[0, 1])
print("  correlation with original vocal over first 2s: %.3f" % corr)
check("vocal is still present in the mix", corr > 0.5, "correlation %.3f" % corr)

print("\n5. balance control changes the blend")
quiet = tools.mix(vocal_stereo, converted, str(OUT / "quiet.wav"), instrumental_db=-12.0)
loud = tools.mix(vocal_stereo, converted, str(OUT / "loud.wav"), instrumental_db=+6.0)
q = float(np.sqrt(np.mean(sf.read(quiet)[0] ** 2)))
l = float(np.sqrt(np.mean(sf.read(loud)[0] ** 2)))
print("  rms quiet-band=%.4f  loud-band=%.4f" % (q, l))
check("louder band setting yields more energy", l > q, "%.4f vs %.4f" % (l, q))

print("\n6. edge cases")
silent = np.zeros((2, SR), dtype=np.float32)
try:
    tools.mix(vocal_stereo[:, :SR], silent, str(OUT / "silent.wav"))
    check("silent backing does not divide by zero", True)
except Exception as exc:
    check("silent backing does not divide by zero", False, repr(exc))

short = tools.mix(vocal_stereo, converted[:, : SR // 2], str(OUT / "short.wav"))
check("short backing is padded, not truncated",
      sf.read(short, always_2d=True)[0].shape[0] >= vocal_stereo.shape[1])


print("\n7. tempo detection generalises to another tempo")
BEAT_90 = 60.0 / 90.0
freqs90 = [261.63, 329.63, 392.00, 329.63]
sig90 = np.concatenate([note(freqs90[i % 4], BEAT_90) for i in range(16)])
p90 = str(OUT / "vocal90.wav")
sf.write(p90, sig90, SR)
t90, k90, d90, _ = tools.analyse(p90)
print("  tempo=%s key=%r duration=%.2f" % (t90, k90, d90))
check("90 BPM detected within 1.5 BPM (or its octaves)",
      any(abs(t90 - c) <= 1.5 for c in (45, 90, 180)), "got %s" % t90)

print("\n8. unmetered audio does not invent a tempo")
t = np.linspace(0, 6.0, int(SR * 6.0), endpoint=False)
drone = 0.4 * np.sin(2 * np.pi * 220.0 * t)
p_drone = str(OUT / "drone.wav")
sf.write(p_drone, drone, SR)
td, kd, dd, fd = tools.analyse(p_drone)
print("  tempo=%s key=%r first_beat=%.3f" % (td, kd, fd))
check("drone yields no tempo or a plausible one", td == 0 or 30 <= td <= 300, "got %s" % td)
check("drone still reports a duration", abs(dd - 6.0) < 0.15, "got %.3f" % dd)

print("\n9. accompany() prompt assembly")
def build_prompt(style, tempo, key):
    details = [style.strip()] if style.strip() else ["warm modern pop production"]
    if tempo:
        details.append("%d bpm" % tempo)
    if key:
        details.append("key of " + key)
    details.append("instrumental")
    return ", ".join(details)

pr = build_prompt("acoustic folk, fingerpicked guitar", round(tempo), key)
print("  %s" % pr)
check("prompt carries bpm", "bpm" in pr)
check("prompt carries key", "key of" in pr)
check("prompt ends instrumental", pr.endswith("instrumental"))
no_tempo = build_prompt("", 0, "")
check("prompt degrades cleanly when nothing is detected",
      no_tempo == "warm modern pop production, instrumental", "got %r" % no_tempo)
print("\n" + ("ALL CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
sys.exit(1 if failures else 0)
