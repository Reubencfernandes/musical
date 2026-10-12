"""Analysis, separation and mixing helpers for the accompaniment pipeline."""
import logging

import librosa
import numpy as np
import soundfile as sf
import torch

SR = 48000
# Krumhansl-Schmuckler profiles: correlating them against the averaged chroma
# is enough to name a key, which is all the style prompt needs.
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def load(path, sr=SR, mono=False):
    audio, rate = librosa.load(path, sr=sr, mono=mono)
    if audio.ndim == 1:
        audio = audio[None, :]
    return audio, rate


def analyse(path):
    """Return tempo, key and the first beat of a recording."""
    mono, _ = librosa.load(path, sr=22050, mono=True)
    duration = float(len(mono)) / 22050
    _, beats = librosa.beat.beat_track(y=mono, sr=22050, units="time")
    # A confident tempo needs actual onsets; humming with no transients gives
    # too few beats, and claiming a tempo there would detune the whole backing.
    if len(beats) < 4:
        tempo, first = 0.0, 0.0
    else:
        # librosa's own tempo estimate is quantised to tempogram bins and can
        # land several BPM off (117 for a true 120), which drifts audibly over
        # a song. The beat times are far more accurate, so read it from those.
        spacing = float(np.median(np.diff(beats)))
        tempo = 60.0 / spacing if spacing > 0 else 0.0
        first = float(beats[0])
    if not np.isfinite(tempo) or not 30 <= tempo <= 300:
        tempo, first = 0.0, 0.0
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(mono), sr=22050)
    profile = chroma.mean(axis=1)
    if profile.sum() <= 0:
        return round(tempo), "", duration, first
    scores = []
    for index in range(12):
        rotated = np.roll(profile, -index)
        scores.append((np.corrcoef(rotated, MAJOR)[0, 1], f"{NOTES[index]} major"))
        scores.append((np.corrcoef(rotated, MINOR)[0, 1], f"{NOTES[index]} minor"))
    best = max(scores, key=lambda item: (item[0] if np.isfinite(item[0]) else -2))
    return round(tempo), best[1], duration, first


def separate(path, model, want="vocals"):
    """Split a mix with Demucs and return the requested stem plus the rest."""
    from demucs.apply import apply_model

    audio, _ = load(path, sr=model.samplerate)
    if audio.shape[0] == 1:
        audio = np.repeat(audio, model.audio_channels, axis=0)
    tensor = torch.from_numpy(audio[: model.audio_channels]).float()
    # Demucs expects the loudness normalisation it was trained with, then the
    # original scale restored so the stems mix back to the source level.
    ref = tensor.mean(0)
    scale = ref.std() or torch.tensor(1.0)
    tensor = (tensor - ref.mean()) / scale
    with torch.inference_mode():
        stems = apply_model(model, tensor[None], device="cuda", progress=False)[0]
    stems = stems * scale + ref.mean()
    names = list(model.sources)
    index = names.index(want) if want in names else names.index("vocals")
    target = stems[index].cpu().numpy()
    rest = sum(stems[i] for i in range(len(names)) if i != index).cpu().numpy()
    return target, rest, model.samplerate


def to_stereo(audio, sr, target_sr=SR):
    if sr != target_sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
    if audio.ndim == 1:
        audio = audio[None, :]
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    return audio[:2]


def rms(audio):
    value = float(np.sqrt(np.mean(np.square(audio))))
    return value if value > 1e-6 else 1e-6


def mix(vocal, instrumental, path, vocal_db=0.0, instrumental_db=-3.0, offset=0.0, sr=SR):
    """Lay a vocal over a backing track and write a headroom-safe master."""
    vocal, instrumental = to_stereo(vocal, sr), to_stereo(instrumental, sr)
    # Nudging the backing track to the singer's first beat is the only timing
    # control available: the model matches tempo, not the exact performance.
    shift = int(round(offset * sr))
    if shift > 0:
        instrumental = np.pad(instrumental, ((0, 0), (shift, 0)))
    elif shift < 0:
        instrumental = instrumental[:, -shift:]
    length = max(vocal.shape[1], instrumental.shape[1])
    vocal = np.pad(vocal, ((0, 0), (0, length - vocal.shape[1])))
    instrumental = np.pad(instrumental, ((0, 0), (0, length - instrumental.shape[1])))
    # Match the backing track to the vocal before applying the requested
    # balance, so the blend does not depend on how loudly the user recorded.
    instrumental = instrumental * (rms(vocal) / rms(instrumental))
    blend = vocal * (10 ** (vocal_db / 20)) + instrumental * (10 ** (instrumental_db / 20))
    peak = float(np.max(np.abs(blend)))
    if peak > 0.99:
        blend = blend * (0.99 / peak)
    sf.write(path, blend.T, sr, subtype="PCM_16")
    return path


def write(audio, path, sr=SR):
    audio = to_stereo(audio, sr)
    sf.write(path, audio.T, SR, subtype="PCM_16")
    return path
