"""Analysis, separation and mixing helpers for the accompaniment pipeline."""
import logging
import shutil

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
    return round(tempo), key_of(mono, 22050), duration, first


def key_of(mono, sr):
    """Name the key of a recording, or return "" when it has no pitch content."""
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(mono), sr=sr)
    profile = chroma.mean(axis=1)
    if profile.sum() <= 0:
        return ""
    scores = []
    for index in range(12):
        rotated = np.roll(profile, -index)
        scores.append((np.corrcoef(rotated, MAJOR)[0, 1], f"{NOTES[index]} major"))
        scores.append((np.corrcoef(rotated, MINOR)[0, 1], f"{NOTES[index]} minor"))
    best = max(scores, key=lambda item: (item[0] if np.isfinite(item[0]) else -2))
    return best[1]


def separate(path, model, want="vocals"):
    """Split a mix with Demucs and return the requested stem plus the rest."""
    stems, names = _demucs(path, model)
    index = names.index(want) if want in names else names.index("vocals")
    target = stems[index].cpu().numpy()
    rest = sum(stems[i] for i in range(len(names)) if i != index).cpu().numpy()
    return target, rest, model.samplerate


def split_all(path, model):
    """Every Demucs stem by name: drums, bass, other and vocals."""
    stems, names = _demucs(path, model)
    return {name: stems[i].cpu().numpy() for i, name in enumerate(names)}, model.samplerate


def _demucs(path, model):
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
    return stems * scale + ref.mean(), list(model.sources)


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


# About -34 dBFS: quieter than any usable take, so a failed separation or a
# whisper cannot drag the band down to silence with it.
QUIETEST = 0.02


def loudness(audio, sr=SR):
    """RMS over the parts that are actually sounding.

    A take is full of gaps between phrases; averaging them in makes a singer
    measure quiet and the band gets turned down to match. Only 50 ms frames
    within 30 dB of the loudest one count.
    """
    mono = np.asarray(audio).reshape(-1, np.asarray(audio).shape[-1]).mean(axis=0)
    frame = max(1, int(sr * 0.05))
    count = len(mono) // frame
    if count < 1:
        return rms(mono)
    levels = np.sqrt(np.mean(np.square(mono[: count * frame].reshape(count, frame)), axis=1))
    active = levels[levels > levels.max() * 10 ** (-30 / 20)]
    return float(np.sqrt(np.mean(np.square(active)))) if len(active) else rms(mono)


def mix(vocal, instrumental, path, vocal_db=0.0, instrumental_db=-3.0, offset=0.0, sr=SR, report=None):
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
    target = max(loudness(vocal, sr), QUIETEST)
    vocal_gain = 10 ** (vocal_db / 20)
    backing_gain = target / max(loudness(instrumental, sr), 1e-6) * (10 ** (instrumental_db / 20))
    blend = vocal * vocal_gain + instrumental * backing_gain
    peak = float(np.max(np.abs(blend)))
    if peak > 0.99:
        blend = blend * (0.99 / peak)
        vocal_gain *= 0.99 / peak
        backing_gain *= 0.99 / peak
    if report is not None:
        report["mix"] = {"vocal": float(vocal_gain), "backing": float(backing_gain)}
    sf.write(path, blend.T, sr, subtype="PCM_16")
    return path


def put_back(vocal, backing, reference, path, sr=SR):
    """Lay the untouched vocal over a regenerated backing, at the original balance.

    The new backing is brought to the loudness of the backing it replaces, so a
    restyle changes the sound of the music and never how loud the singer sits.
    """
    vocal, backing = to_stereo(vocal, sr), to_stereo(backing, sr)
    length = vocal.shape[1]
    backing = shift(backing, 0.0, sr, length=length)
    backing = backing * (loudness(reference, sr) / max(loudness(backing, sr), 1e-6))
    blend = vocal + backing
    peak = float(np.max(np.abs(blend)))
    if peak > 0.99:
        blend = blend * (0.99 / peak)
    sf.write(path, blend.T, sr, subtype="PCM_16")
    return path


def write(audio, path, sr=SR):
    audio = to_stereo(audio, sr)
    sf.write(path, audio.T, SR, subtype="PCM_16")
    return path


# ------------------------------------------------------------ band following
#
# ACE-Step reads "120 bpm, key of C major" in a prompt as a loose hint, so a
# band written from text alone starts on its own downbeat, wanders in tempo and
# plays its own chords. What it follows closely is audio: audio2audio keeps the
# timing and harmony of a reference while the prompt restyles it. So the band
# is written over a guide track — a plain synth arrangement built on the
# singer's own beat grid and chords — and the model turns that into the style.

GUIDE_SR = 44100
ROOT_FREQ = 130.81  # C3
PARTS = ("drums", "bass", "chords")
QUALITIES = {"major": (0, 4, 7), "minor": (0, 3, 7)}
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)


def beat_grid(mono, sr, bpm=0.0):
    """Beat times across the whole recording, and the tempo they imply.

    A cappella singing has soft onsets, so tracked beats jitter. When they fit
    a straight line the take is steady and the fitted grid is used, which keeps
    the band from stumbling on every late syllable; a rubato take keeps its
    real beats. `bpm` overrides detection when the user knows the tempo.
    """
    duration = len(mono) / sr
    kwargs = {"start_bpm": float(bpm)} if bpm else {}
    _, beats = librosa.beat.beat_track(y=mono, sr=sr, units="time", **kwargs)
    if bpm:
        step = 60.0 / float(bpm)
        phase = float(beats[0]) % step if len(beats) else 0.0
        return np.arange(phase, duration, step), float(bpm)
    if len(beats) < 4:
        return np.array([]), 0.0
    index = np.arange(len(beats))
    slope, start = np.polyfit(index, beats, 1)
    if not 0.2 <= slope <= 2.0:
        return np.array([]), 0.0
    residual = float(np.median(np.abs(beats - (start + slope * index))))
    if residual < 0.05:
        grid = np.arange(start % slope, duration, slope)
    else:
        # Rubato: keep the tracked beats and extend them at the average spacing.
        head = np.arange(beats[0] - slope, 0, -slope)[::-1]
        tail = np.arange(beats[-1] + slope, duration, slope)
        grid = np.concatenate([head, beats, tail])
    grid = grid - _lag(mono, sr, grid, slope)
    return grid[grid >= 0], 60.0 / slope


def _lag(mono, sr, grid, spacing):
    """How far the tracker's beats trail the note attacks they stand for.

    Beat frames sit on onset-strength peaks, a frame or two after the attack
    a listener hears, and a band that late sounds like it is dragging.
    """
    onsets = librosa.onset.onset_detect(y=mono, sr=sr, units="time", backtrack=True)
    if len(onsets) < 4 or len(grid) < 2:
        return 0.0
    nearest = onsets[np.clip(np.searchsorted(onsets, grid), 1, len(onsets) - 1)]
    earlier = onsets[np.clip(np.searchsorted(onsets, grid) - 1, 0, len(onsets) - 1)]
    closest = np.where(np.abs(nearest - grid) < np.abs(earlier - grid), nearest, earlier)
    gap = grid - closest
    near = gap[np.abs(gap) < spacing / 4]
    return float(np.median(near)) if len(near) >= 4 else 0.0


def _beat_chroma(mono, sr, beats):
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(mono), sr=sr)
    frames = np.clip(librosa.time_to_frames(beats, sr=sr), 0, chroma.shape[1] - 1)
    edges = list(frames) + [chroma.shape[1]]
    return np.stack([chroma[:, a:max(b, a + 1)].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)


def _templates(key):
    tonic, scale = 0, MAJOR_SCALE
    if key:
        name, mode = key.split()
        tonic = NOTES.index(name)
        scale = MAJOR_SCALE if mode == "major" else MINOR_SCALE
    diatonic = {(tonic + degree) % 12 for degree in scale}
    templates = []
    for root in range(12):
        for quality, shape in QUALITIES.items():
            template = np.zeros(12)
            for weight, offset in zip((1.0, 0.8, 0.9), shape):
                template[(root + offset) % 12] = weight
            in_key = all((root + offset) % 12 in diatonic for offset in shape)
            templates.append((root, quality, template / np.linalg.norm(template), in_key))
    return templates


def _label(per_beat, beats, bounds, templates):
    """Best triad for each span of beats, and how well the spans fit overall."""
    found, previous, fits = [], None, []
    for first, last in bounds:
        column = per_beat[:, first:last].mean(axis=1)
        norm = float(np.linalg.norm(column))
        time = 0.0 if first == 0 else float(beats[first])
        if norm < 1e-6:
            if previous:
                found.append({"time": time, **previous})
            continue
        best, choice, fit = -9.0, None, 0.0
        for root, quality, template, in_key in templates:
            match = float(column @ template) / norm
            score = match + (0.12 if in_key else 0.0)
            if previous and previous["root"] == root and previous["quality"] == quality:
                score += 0.06
            if score > best:
                best, choice, fit = score, {"root": root, "quality": quality}, match
        previous = choice
        fits.append(fit)
        found.append({"time": time, **choice})
    return found, (float(np.mean(fits)) if fits else 0.0)


def chords(mono, sr, beats, key, per_bar=4):
    """Name one triad per bar from the harmony the recording implies.

    Each bar's chroma is scored against every major and minor triad. Chords in
    the detected key get a bonus, as does repeating the previous chord, which
    keeps a vocal line — a few notes per bar — from yielding a new chord on
    every passing tone.

    Where the bar lines fall is not known either. Neighbouring chords share two
    notes, so harmonic change is a weak clue; instead each of the `per_bar`
    possible placements is labelled and the one whose bars fit triads best
    wins, since a bar line in the wrong place blends two chords into a muddle.
    """
    if len(beats) < per_bar + 1:
        return []
    per_beat = _beat_chroma(mono, sr, beats)
    templates = _templates(key)
    count = per_beat.shape[1]
    best, result = -1.0, []
    for phase in range(per_bar):
        lines = list(range(phase, count, per_bar))
        bounds = [(a, min(a + per_bar, count)) for a in lines]
        if phase:
            bounds.insert(0, (0, phase))
        found, fit = _label(per_beat, beats, bounds, templates)
        if fit > best + 1e-6:
            best, result = fit, found
    # A chord held across bars is one chord; the guide sustains it.
    merged = []
    for chord in result:
        if not merged or (merged[-1]["root"], merged[-1]["quality"]) != (chord["root"], chord["quality"]):
            merged.append(chord)
    return merged


def chord_name(chord):
    return NOTES[chord["root"]] + ("m" if chord["quality"] == "minor" else "")


def _tone(freq, length, sr, harmonics=4, decay=0.0):
    t = np.arange(length) / sr
    wave = sum(np.sin(2 * np.pi * freq * h * t) / h for h in range(1, harmonics + 1))
    envelope = np.exp(-decay * t) if decay else np.ones(length)
    fade = min(length // 2, int(sr * 0.01))
    if fade:
        envelope[:fade] *= np.linspace(0, 1, fade)
        envelope[-fade:] *= np.linspace(1, 0, fade)
    return wave * envelope


def _place(track, sound, at):
    start = int(at)
    if start < 0 or start >= len(track):
        return
    end = min(len(track), start + len(sound))
    track[start:end] += sound[: end - start]


def guide(beats, progression, duration, parts=PARTS, sr=GUIDE_SR):
    """Synthesise a plain arrangement on the given beat grid and chords.

    It is deliberately simple — a kick and snare backbeat, a root-note bass and
    a sustained triad — because it only has to tell the model where the beats
    and changes are; the prompt supplies the actual sound.
    """
    length = int(duration * sr)
    drums, bass, pad = np.zeros(length), np.zeros(length), np.zeros(length)
    rng = np.random.default_rng(7)
    spacing = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    t = np.arange(int(sr * 0.18)) / sr
    kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-t * 30)) * t) * np.exp(-t * 18)
    snare = rng.standard_normal(int(sr * 0.14)) * np.exp(-np.arange(int(sr * 0.14)) / sr * 28)
    hat = np.diff(rng.standard_normal(int(sr * 0.04)), prepend=0) * np.exp(
        -np.arange(int(sr * 0.04)) / sr * 90)
    bar_lines = {round(chord["time"], 3) for chord in progression}
    counter = 0
    for beat in beats:
        # Count from each bar line so the kick lands on the downbeat.
        if round(float(beat), 3) in bar_lines:
            counter = 0
        _place(drums, kick if counter % 2 == 0 else 0.55 * snare, beat * sr)
        _place(drums, 0.18 * hat, beat * sr)
        _place(drums, 0.12 * hat, (beat + spacing / 2) * sr)
        counter += 1
    for index, chord in enumerate(progression):
        start = chord["time"]
        end = progression[index + 1]["time"] if index + 1 < len(progression) else duration
        span = int((end - start) * sr)
        if span <= 0:
            continue
        root = ROOT_FREQ * 2 ** (chord["root"] / 12)
        triad = sum(_tone(root * 2 ** (offset / 12), span, sr, harmonics=3)
                    for offset in QUALITIES[chord["quality"]])
        _place(pad, triad / 3, start * sr)
        for number, beat in enumerate(b for b in beats if start - 1e-3 <= b < end):
            if number % 2 == 0:
                note_len = int(min(end - beat, 2 * spacing) * sr)
                if note_len > 0:
                    _place(bass, _tone(root / 2, note_len, sr, harmonics=2, decay=3.0), beat * sr)
    layers = {"drums": drums, "bass": bass, "chords": pad}
    out = np.zeros(length)
    for name, level in (("drums", 0.5), ("bass", 0.6), ("chords", 0.35)):
        if name in parts and np.any(layers[name]):
            out += level * layers[name] / np.max(np.abs(layers[name]))
    peak = float(np.max(np.abs(out))) if length else 0.0
    return (out / peak * 0.8 if peak > 0 else out).astype(np.float32)


def has_backing(vocal, rest):
    """Whether Demucs found real music under the voice rather than room noise."""
    return rms(rest) / rms(vocal) > 0.2


def has_voice(vocal, rest, sr=SR):
    """Whether Demucs found a voice worth keeping at all.

    A take with no singing — a guitar riff, a synth line — leaves the vocal
    stem close to silent. Lifting that would swap the user's recording for
    nothing, so such a take is followed as it is instead.
    """
    voice = loudness(vocal, sr)
    return voice >= 0.005 and voice >= 0.15 * loudness(rest, sr)


def offset_between(reference, candidate, sr, window=0.35):
    """Seconds to delay `candidate` so its onsets line up with `reference`."""
    hop = 512
    a = librosa.onset.onset_strength(y=np.asarray(reference, dtype=np.float32), sr=sr, hop_length=hop)
    b = librosa.onset.onset_strength(y=np.asarray(candidate, dtype=np.float32), sr=sr, hop_length=hop)
    n = min(len(a), len(b))
    if n < 8:
        return 0.0
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    reach = int(window * sr / hop)
    lags = list(range(-reach, reach + 1))
    scores = [float(np.dot(a[max(0, lag):n + min(0, lag)], b[max(0, -lag):n - max(0, lag)]))
              for lag in lags]
    return lags[int(np.argmax(scores))] * hop / sr


# ------------------------------------------------------------ beat lock
#
# Cover and repaint regenerate the music and treat tempo as a loose target, so
# a restyled backing can run a little fast or slow and slide against the
# untouched vocal laid back on top of it. `follow` finds the beats of the
# original and of the new audio, pairs them, and time-warps the new audio so
# every bar lands where the original's did. The warp is Kiku-Engine's
# (sync.py), which locks YuE2 bands to a take the same way.

# A segment that has to shrink or grow more than this is a bad pairing, not drift.
MIN_RATIO, MAX_RATIO = 0.75, 1.33
BEAT_SR = 22050


def _beats(audio, sr):
    mono = np.asarray(librosa.to_mono(audio) if audio.ndim == 2 else audio, dtype=np.float32)
    mono = librosa.resample(mono, orig_sr=sr, target_sr=BEAT_SR)
    _, beats = librosa.beat.beat_track(y=mono, sr=BEAT_SR, units="time")
    return np.asarray(beats, dtype=float), mono


def beat_pairs(reference, written, offset):
    """(new time, original time) for each original beat the new audio also plays.

    Walks forward from the aligned start and predicts each next beat from the
    last pair at the new audio's own spacing, so a gradual drift is followed
    rather than mistaken for a jump. A beat with no partner nearby is skipped.
    """
    if len(reference) < 4 or len(written) < 4:
        return []
    period = float(np.median(np.diff(written)))
    ratio = period / float(np.median(np.diff(reference)))
    if not 0.8 <= ratio <= 1.25:
        return []  # half or double time: the beats do not correspond one to one
    pairs = []
    for a in reference:
        guess = a - offset if not pairs else pairs[-1][0] + (a - pairs[-1][1]) * ratio
        b = float(written[int(np.argmin(np.abs(written - guess)))])
        if abs(b - guess) > 0.3 * period:
            continue
        if pairs:
            if b <= pairs[-1][0] or a <= pairs[-1][1]:
                continue
            if not MIN_RATIO <= (b - pairs[-1][0]) / (a - pairs[-1][1]) <= MAX_RATIO:
                continue
        pairs.append((b, float(a)))
    return pairs


def same_pulse(written, reference):
    """`written`'s beats at `reference`'s pulse, as candidate grids.

    A restyle often changes the feel (hats on every eighth, a half-time groove),
    and the tracker then counts it at double or half the original's tempo, which
    leaves no beat pairs at all. Double time is thinned to every other beat, on
    both phases; half time gets a beat between each pair.
    """
    if len(written) < 4 or len(reference) < 4:
        return [written]
    ratio = float(np.median(np.diff(written))) / float(np.median(np.diff(reference)))
    if 0.4 <= ratio <= 0.625:
        return [written, written[0::2], written[1::2]]
    if 1.6 <= ratio <= 2.5:
        return [written, np.sort(np.concatenate([written, (written[:-1] + written[1:]) / 2]))]
    return [written]


def lock_points(written, reference, sr=SR):
    """Warp anchors (new time, original time) putting `written` on `reference`'s
    beats, or None, plus a report. Anchors sit on every fourth paired beat:
    roughly bar lines, so the tempo is corrected without wobbling every hit.
    """
    written, reference = to_stereo(written, sr), to_stereo(reference, sr)
    ref_beats, ref_mono = _beats(reference, sr)
    new_beats, new_mono = _beats(written, sr)
    offset = offset_between(ref_mono, new_mono, BEAT_SR, window=1.0)
    pairs = max((beat_pairs(ref_beats, grid, offset) for grid in same_pulse(new_beats, ref_beats)), key=len)
    report = {"beats": len(ref_beats), "paired": len(pairs)}
    if len(pairs) < 8 or len(pairs) < 0.4 * len(ref_beats):
        return None, report
    return pairs[::4] + ([pairs[-1]] if (len(pairs) - 1) % 4 else []), report


def follow(written, reference, sr=SR):
    """`written` warped onto `reference`'s beats, at `reference`'s length.

    Returns (audio or None, report).
    """
    written, reference = to_stereo(written, sr), to_stereo(reference, sr)
    try:
        anchors, report = lock_points(written, reference, sr)
        if anchors is None:
            return None, {**report, "locked": False}
        warped = warp(written, sr, anchors, reference.shape[1] / sr)
        return warped, {**report, "locked": warped is not None}
    except Exception:
        logging.exception("Beat lock failed; keeping the audio as generated")
        return None, {"locked": False}


def _stretch_segment(segment, sr, length):
    if length <= 0 or segment.shape[-1] == 0:
        return np.zeros((segment.shape[0], max(0, length)), dtype=np.float32)
    rate = segment.shape[-1] / length
    out = np.stack([librosa.effects.time_stretch(ch, rate=rate) for ch in segment])
    if out.shape[1] < length:
        out = np.pad(out, ((0, 0), (0, length - out.shape[1])))
    return out[:, :length]


def timemap(points, length, sr, duration):
    """Sample positions (source, destination) for the warp, both strictly rising.

    Material before the first anchor and after the last keeps its natural speed,
    and anchors past the end of the audio are dropped, so the map always ends
    inside the audio, which Rubber Band requires.
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
    """Stretch stereo `audio` so each anchor's new time lands on its original
    time, returning exactly `duration` seconds. Rubber Band's time map when it
    is installed (one pass, high quality), a per-segment phase vocoder otherwise."""
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


def shift(audio, seconds, sr, length=None):
    """Delay (positive) or advance audio, keeping it at `length` samples."""
    audio = audio if audio.ndim == 2 else audio[None, :]
    samples = int(round(seconds * sr))
    if samples > 0:
        audio = np.pad(audio, ((0, 0), (samples, 0)))
    elif samples < 0:
        audio = audio[:, -samples:]
    length = length or audio.shape[1]
    if audio.shape[1] < length:
        audio = np.pad(audio, ((0, 0), (0, length - audio.shape[1])))
    return audio[:, :length]
