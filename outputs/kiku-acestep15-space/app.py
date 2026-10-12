"""ACE-Step 1.5 for Kiku AI: songs, restyles, rewrites and bands on one ZeroGPU Space.

The endpoints mirror Kiku-Engine's names and argument order, so the studio can
send the same request to either model. ACE-Step 1.5 runs on its own Space
because it needs Python 3.11, Gradio 6 and torch 2.9, none of which fit the
engine's YuE2 stack.

Two DiT models are loaded, sharing one VAE and text encoder:

- turbo (8 steps) for text-to-music, cover (restyle) and repaint (rewrite, extend);
- base, the only one trained for lego (write one instrument into a mix) and
  complete (write the missing instruments around a part).

Following the official Space, everything is placed on "cuda" at startup, which
ZeroGPU intercepts, and the 5 Hz language model uses the PyTorch backend because
nano-vllm reaches CUDA directly and ZeroGPU refuses that.
"""
import json
import logging
import os
from pathlib import Path
import shutil
import tempfile
import time

if os.environ.get("KIKU_RUNTIME") == "modal":
    import native_gpu as spaces
else:
    import spaces  # before torch, so ZeroGPU can intercept CUDA
import gradio as gr
import torch

from acestep.handler import AceStepHandler
from acestep.inference import (GenerationConfig, GenerationParams, create_sample, format_sample,
                               generate_music, understand_music)
from acestep.llm_inference import LLMHandler
import audio_tools as tools

logging.basicConfig(level=logging.INFO)
HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("KIKU_OUTPUT_ROOT", str(Path(tempfile.gettempdir()) / "kiku-acestep15")))
ROOT.mkdir(exist_ok=True, parents=True)
TURBO, BASE, LM = "acestep-v15-turbo", "acestep-v15-base", "acestep-5Hz-lm-1.7B"
# Five minutes, so a whole song gets one band rather than joined halves.
MAX_BAND = 300
MAX_TEXT = 600
SEPARATE = ["auto", "always", "never"]
# Studio instrument names to ACE-Step track names. Keys keep the studio's words.
TRACKS = {"drums": "drums", "bass": "bass", "keys": "keyboard", "guitar": "guitar",
          "strings": "strings", "synth": "synth"}
BAND = ["drums", "bass", "keyboard", "guitar"]


def storage():
    data = Path("/data")
    if data.is_dir() and os.access(data, os.W_OK):
        return str(data)
    local = HERE / "data"
    local.mkdir(exist_ok=True)
    return str(local)


STORE = storage()
turbo = AceStepHandler(persistent_storage_path=STORE)
status, ok = turbo.initialize_service(project_root=str(HERE), config_path=TURBO, device="cuda",
                                      use_flash_attention=False, compile_model=False,
                                      offload_to_cpu=False, offload_dit_to_cpu=False)
logging.info("Turbo DiT: %s", status)
if not ok:
    raise RuntimeError("ACE-Step 1.5 turbo failed to load: " + status)
base = AceStepHandler(persistent_storage_path=STORE)
status, ok = base.initialize_service(project_root=str(HERE), config_path=BASE, device="cuda",
                                     use_flash_attention=False, compile_model=False,
                                     offload_to_cpu=False, offload_dit_to_cpu=False,
                                     shared_vae=turbo.vae, shared_text_encoder=turbo.text_encoder,
                                     shared_text_tokenizer=turbo.text_tokenizer,
                                     shared_silence_latent=turbo.silence_latent)
logging.info("Base DiT: %s", status)
if not ok:
    raise RuntimeError("ACE-Step 1.5 base failed to load: " + status)
lm = getattr(spaces, "prepared_lm", None) or LLMHandler(persistent_storage_path=STORE)
status, ok = lm.initialize(checkpoint_dir=turbo._get_checkpoint_dir(), lm_model_path=LM,
                           backend="pt", device="cuda", offload_to_cpu=False, dtype=turbo.dtype)
logging.info("5Hz LM: %s", status)

DEMUCS = {}


def demucs():
    if "model" not in DEMUCS:
        from demucs.pretrained import get_model
        DEMUCS["model"] = get_model("htdemucs").to("cuda").eval()
    return DEMUCS["model"]


def sweep():
    cutoff = time.time() - 86400
    for old in ROOT.glob("job-*"):
        if old.is_dir() and old.stat().st_mtime < cutoff:
            shutil.rmtree(old, ignore_errors=True)


def job_dir():
    sweep()
    return Path(tempfile.mkdtemp(prefix="job-", dir=ROOT))


def seeds(seed):
    return None if seed in (None, "", -1) or int(seed) < 0 else [int(seed)]


def failed(exc):
    logging.exception("Request failed")
    if isinstance(exc, torch.cuda.OutOfMemoryError):
        return gr.Error("That was too long to process at once. Try a shorter section.")
    return gr.Error("The request failed. Try a shorter clip. Details are in the Space logs.")


def guard(audio, label="a recording"):
    if not audio:
        raise gr.Error("Upload " + label + " first.")


def length(path):
    import soundfile as sf
    return sf.info(path).duration


def run(handler, job, *, think=False, **fields):
    """One generation, returning the written file.

    The language model plans songs from a caption, but on audio-conditioned
    tasks its audio codes would turn the request into a cover and ignore the
    source, so it is switched off for everything except text-to-music.
    """
    params = GenerationParams(thinking=think, use_cot_metas=think, use_cot_caption=think,
                              use_cot_language=think, **fields)
    config = GenerationConfig(batch_size=1, use_random_seed=fields.get("seed", -1) < 0,
                              seeds=seeds(fields.get("seed")), audio_format="wav")
    result = generate_music(handler, lm, params, config, save_dir=str(job))
    if not result.success or not result.audios or not result.audios[0].get("path"):
        raise RuntimeError(result.error or result.status_message or "The model returned no audio.")
    return result.audios[0]["path"]


def meta(bpm, key):
    fields = {}
    if bpm and float(bpm) > 0:
        fields["bpm"] = int(round(float(bpm)))
    if key:
        fields["keyscale"] = key
    return fields


def metas(raw):
    """Tempo, key and metre the studio measured (a JSON object), as generation fields.

    Left blank, the DiT sees "bpm: N/A" and guesses; given the source's own values
    it stays consistent with the music it is reshaping. Anything missing or out of
    range stays automatic, so a wrong default never contradicts the audio.
    """
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    fields = {}
    bpm = data.get("bpm")
    if isinstance(bpm, (int, float)) and 30 <= bpm <= 300:
        fields["bpm"] = int(round(bpm))
    key = str(data.get("keyscale") or "").strip()
    if key and len(key) <= 20:
        fields["keyscale"] = key
    signature = str(data.get("timesignature") or "").split("/")[0].strip()
    if signature in ("2", "3", "4", "6"):
        fields["timesignature"] = signature
    return fields


def with_tempo(fields, source):
    """`fields` with the source's own tempo when the studio measured none.

    Without one a cover or repaint picks its own speed (a lo-fi restyle of a
    117 BPM take came back near 86), which is too far apart for the beat lock
    to stretch, so the new music drifts under the kept voice.
    """
    if "bpm" in fields:
        return fields
    import librosa
    mono, rate = librosa.load(source, sr=22050, mono=True)
    _, tempo = tools.beat_grid(mono, rate)
    return {**fields, "bpm": int(round(tempo))} if 30 <= tempo <= 300 else fields


def found(result, *names):
    """The metadata fields a language-model result filled in."""
    out = {}
    for name in names:
        value = getattr(result, name, None)
        if value not in (None, "", "N/A"):
            out[name] = value
    return out


def finished(started, what):
    elapsed = round(time.monotonic() - started)
    return "%s in %dm %ds with ACE-Step 1.5." % (what, elapsed // 60, elapsed % 60)


# ------------------------------------------------------------------ writing

def text_time(*args, **kwargs):
    return 90


@spaces.GPU(duration=text_time)
def song(style, lyrics, duration, seed, meta_json="", progress=gr.Progress()):
    """A song with vocals from a style and lyrics, planned by the 5 Hz language model."""
    if not (style or "").strip() or not (lyrics or "").strip():
        raise gr.Error("Add a style and lyrics.")
    job, started = job_dir(), time.monotonic()
    try:
        progress(0.1, desc="Planning and singing the song")
        path = run(turbo, job, think=True, task_type="text2music", caption=style.strip()[:512],
                   lyrics=lyrics.strip()[:4096], duration=float(duration or -1),
                   inference_steps=8, shift=3.0, seed=int(seed or -1), **metas(meta_json))
        return finished(started, "Song written"), path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=text_time)
def instrumental(prompt, lyrics, duration, steps, guidance, seed, progress=gr.Progress()):
    """Same arguments as Kiku-Engine's /instrumental; turbo ignores steps and guidance."""
    if not (prompt or "").strip():
        raise gr.Error("Describe the music you want.")
    if not 10 <= float(duration) <= MAX_TEXT:
        raise gr.Error("Choose a length from 10 to %d seconds." % MAX_TEXT)
    job, started = job_dir(), time.monotonic()
    try:
        progress(0.1, desc="Composing")
        path = run(turbo, job, task_type="text2music", caption=prompt.strip()[:512],
                   lyrics=(lyrics or "").strip() or "[Instrumental]",
                   instrumental=not (lyrics or "").strip(), duration=float(duration),
                   inference_steps=8, shift=3.0, seed=int(seed or -1))
        return finished(started, "Finished"), path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------------------ reshaping

def audio_time(*args, **kwargs):
    return 180


def on_beat(path, reference, job, name, progress):
    """A generated file warped onto the beats of the audio it was made from, so
    a restyled part stays in time with the tracks around it in the studio."""
    progress(0.88, desc="Locking the new music to your beat")
    written, _ = tools.load(path)
    original, _ = tools.load(reference)
    locked, report = tools.follow(written, original)
    logging.info("Beat lock %s: %s", name, report)
    path = tools.write(locked, str(job / (name + "-on-beat.wav"))) if locked is not None else path
    return path, report


def unlocked(report):
    return "" if report.get("locked") else " The new music could not be locked to your beat; check its timing."


def keep_voice(audio, lyrics, job, progress, generate):
    """Regenerate only the music under a singer, keeping the real voice.

    Restyle and rewrite run with "[Instrumental]" lyrics when none are given, which
    tells the model to write instruments only: on a sung take that deletes the
    singing. So when the audio has a voice and no new lyrics were asked for,
    Demucs lifts the voice off, `generate` works on the backing alone, and the
    untouched voice goes back on top. Returns (path, beat-lock report), or None
    when there is no voice to keep.
    """
    if (lyrics or "").strip():
        return None
    progress(0.08, desc="Lifting your voice off the music")
    voice, rest, sr = tools.separate(audio, demucs(), want="vocals")
    if not tools.has_voice(voice, rest, sr):
        return None
    backing = tools.write(tools.to_stereo(rest, sr), str(job / "backing-in.wav"))
    written, _ = tools.load(generate(backing))
    progress(0.85, desc="Locking the new music to your beat")
    locked, report = tools.follow(written, tools.to_stereo(rest, sr))
    logging.info("Beat lock under the voice: %s", report)
    if locked is not None:
        written = locked
    progress(0.92, desc="Putting your voice back")
    return tools.put_back(tools.to_stereo(voice, sr), written, tools.to_stereo(rest, sr),
                          str(job / "with-your-voice.wav")), report


@spaces.GPU(duration=audio_time)
def remix(audio, prompt, lyrics, strength, steps, seed, meta_json="", progress=gr.Progress()):
    """Restyle audio. `strength` is how closely to keep the source, as on Kiku-Engine."""
    guard(audio)
    if not (prompt or "").strip():
        raise gr.Error("Describe the style you want to move towards.")
    job, started = job_dir(), time.monotonic()
    try:
        def generate(source):
            progress(0.2, desc="Restyling")
            return run(turbo, job, task_type="cover", src_audio=source, caption=prompt.strip()[:512],
                       lyrics=(lyrics or "").strip() or "[Instrumental]",
                       audio_cover_strength=float(strength), inference_steps=8, shift=3.0,
                       seed=int(seed or -1), **with_tempo(metas(meta_json), source))
        kept = keep_voice(audio, lyrics, job, progress, generate)
        path, report = kept or on_beat(generate(audio), audio, job, "restyle", progress)
        return (finished(started, "Restyled") + (" Your voice is untouched." if kept else "") + unlocked(report),
                path, json.dumps(report))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=audio_time)
def repaint(audio, prompt, lyrics, start, end, variance, steps, seed, meta_json="", progress=gr.Progress()):
    """Rewrite one stretch in context. ACE-Step 1.5 has no variance control; it is accepted and unused."""
    guard(audio)
    if float(end) <= float(start):
        raise gr.Error("The section end must come after its start.")
    job, started = job_dir(), time.monotonic()
    try:
        def generate(source):
            progress(0.2, desc="Rewriting that section")
            return run(turbo, job, task_type="repaint", src_audio=source,
                       caption=(prompt or "").strip()[:512] or "seamless continuation of the music",
                       lyrics=(lyrics or "").strip() or "[Instrumental]",
                       repainting_start=float(start), repainting_end=float(end),
                       inference_steps=8, shift=3.0, seed=int(seed or -1), **with_tempo(metas(meta_json), source))
        kept = keep_voice(audio, lyrics, job, progress, generate)
        path, report = kept or on_beat(generate(audio), audio, job, "rewrite", progress)
        return (finished(started, "Rewrote %.1fs to %.1fs" % (float(start), float(end))) + unlocked(report),
                path, json.dumps(report))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=audio_time)
def extend(audio, prompt, lyrics, seconds, steps, seed, progress=gr.Progress()):
    """Continue past the end: a repaint whose window runs beyond the source, which pads it."""
    guard(audio)
    job, started = job_dir(), time.monotonic()
    try:
        progress(0.1, desc="Continuing the track")
        total = length(audio)
        path = run(turbo, job, task_type="repaint", src_audio=audio,
                   caption=(prompt or "").strip()[:512] or "natural continuation of the music",
                   lyrics=(lyrics or "").strip() or "[Instrumental]",
                   repainting_start=float(total), repainting_end=float(total + float(seconds)),
                   inference_steps=8, shift=3.0, seed=int(seed or -1))
        return finished(started, "Added %ds" % int(seconds)), path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------------------ writing captions

def lm_time(*args, **kwargs):
    return 60


@spaces.GPU(duration=lm_time)
def enhance(audio, caption, lyrics, progress=gr.Progress()):
    """Expand a short description into a full caption (the guide's "format").

    ACE-Step follows its caption more than anything else, and cover and repaint
    skip the language model, so a one-word restyle reaches the DiT as one word.
    With audio, the model first listens to it ("understand") so the tempo, key and
    metre it returns are the recording's own; the words it hears are not returned.
    """
    if not (caption or "").strip():
        raise gr.Error("Describe the sound first.")
    if not lm.llm_initialized:
        raise gr.Error("The language model is not available right now.")
    try:
        measured = {}
        if audio:
            progress(0.15, desc="Listening to your selection")
            codes = turbo.convert_src_audio_to_codes(audio)
            if codes.startswith("<|audio_code"):
                heard = understand_music(lm, codes, temperature=0.3)
                if heard.success:
                    measured = found(heard, "bpm", "keyscale", "timesignature")
        progress(0.6, desc="Writing a fuller description")
        given = {k: v for k, v in metas(json.dumps(measured)).items()}
        result = format_sample(lm, caption.strip()[:512], (lyrics or "").strip()[:4096] or "[Instrumental]",
                               user_metadata=given or None, temperature=0.7)
        if not result.success or not (result.caption or "").strip():
            raise RuntimeError(result.error or result.status_message or "No caption came back.")
        out = {**found(result, "bpm", "keyscale", "timesignature", "language"), **measured, "measured": bool(measured)}
        return "Enhanced", result.caption.strip(), json.dumps(out)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=lm_time)
def sample(query, instrumental, language, progress=gr.Progress()):
    """The guide's Simple mode: a caption, lyrics and metadata written from a one-line idea."""
    if not (query or "").strip():
        raise gr.Error("Describe the song you want.")
    if not lm.llm_initialized:
        raise gr.Error("The language model is not available right now.")
    try:
        progress(0.2, desc="Writing the song idea")
        result = create_sample(lm, query.strip()[:512], instrumental=bool(instrumental),
                               vocal_language=(language or None))
        if not result.success or not (result.caption or "").strip():
            raise RuntimeError(result.error or result.status_message or "No song idea came back.")
        out = found(result, "bpm", "keyscale", "timesignature", "language", "duration")
        return "Written", result.caption.strip(), (result.lyrics or "[Instrumental]").strip(), json.dumps(out)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------------------ bands and parts

def band_time(audio, style, separate, balance, strength, split_parts, bpm, steps, seed,
              progress=None, **kwargs):
    return 200 + (30 if separate != "never" else 0) + (20 if split_parts else 0)


@spaces.GPU(duration=band_time)
def accompany(audio, style, separate, balance, strength, split_parts, bpm, steps, seed,
              progress=gr.Progress()):
    """Write a band around a vocal with the base model's complete task, keeping the real voice.

    Complete writes the instruments the vocal is missing, conditioned on the
    vocal itself, so the band follows its timing and harmony directly. The model
    may re-render the vocal in its output; Demucs removes whatever voice it
    wrote, and the user's own take is mixed on top. Arguments and outputs match
    Kiku-Engine's /accompany. `strength` has no counterpart here and is unused.
    """
    guard(audio, "a recording of your voice")
    if separate not in SEPARATE:
        raise gr.Error("Choose auto, always or never for separation.")
    job, started = job_dir(), time.monotonic()
    try:
        progress(0.05, desc="Listening to your recording")
        vocal, sr = tools.load(audio)
        duration = vocal.shape[1] / sr
        if duration < 3:
            raise gr.Error("That recording is too short. Record at least a few seconds.")
        if duration > MAX_BAND:
            raise gr.Error("Backing tracks are limited to %d minutes." % (MAX_BAND // 60))
        source, background, lifted, voiced = audio, None, False, True
        if separate != "never":
            progress(0.12, desc="Checking for music behind your voice")
            voice, rest, sep_sr = tools.separate(audio, demucs(), want="vocals")
            # A take with no singing is followed as it is; lifting would leave nothing.
            voiced = tools.has_voice(voice, rest, sep_sr)
            if voiced and (separate == "always" or tools.has_backing(voice, rest)):
                lifted, vocal, sr = True, voice, sep_sr
                background = tools.write(tools.to_stereo(rest, sep_sr), str(job / "original-backing.flac"))
                source = tools.write(tools.to_stereo(voice, sep_sr), str(job / "lifted-vocal.flac"))
        progress(0.3, desc="Writing the band around your voice")
        details = [(style or "").strip() or "warm modern pop production", "full band"]
        written = run(base, job, task_type="complete", src_audio=source,
                      instruction=base.generate_instruction("complete", complete_track_classes=BAND),
                      caption=", ".join(details)[:512], lyrics="[Instrumental]",
                      duration=float(duration), inference_steps=int(min(max(steps or 50, 20), 80)),
                      guidance_scale=7.0, seed=int(seed or -1), **meta(bpm, ""))
        progress(0.85, desc="Taking out any voice the model wrote")
        found, split_sr = tools.split_all(written, demucs())
        length_samples = int(duration * tools.SR)
        stems = {name: tools.shift(tools.to_stereo(found[name], split_sr), 0.0, tools.SR, length=length_samples)
                 for name in ("drums", "bass", "other")}
        band = stems["drums"] + stems["bass"] + stems["other"]
        locked = None
        if background:
            # Complete hears only the voice and its band wanders against it by a
            # few hundred milliseconds a bar. The backing the singer performed to
            # holds their timing, so the band and its parts are warped onto its beats.
            progress(0.88, desc="Locking the band to your beat")
            original, _ = tools.load(background)
            try:
                anchors, lock = tools.lock_points(band, original)
                if anchors is not None:
                    warped = {name: tools.warp(stem, tools.SR, anchors, duration) for name, stem in stems.items()}
                    if all(w is not None for w in warped.values()):
                        stems = {name: tools.shift(w, 0.0, tools.SR, length=length_samples) for name, w in warped.items()}
                        band = stems["drums"] + stems["bass"] + stems["other"]
                    else:
                        anchors = None
                locked = anchors is not None
                logging.info("Band beat lock: %s", {**lock, "locked": locked})
            except Exception:
                logging.exception("Band beat lock failed; keeping the band as written")
                locked = False
        backing = tools.write(band, str(job / "kiku-band.flac"))
        # The model hears the vocal itself, so it gets no tempo hint unless the user
        # set one: a tempo tracked from a few sung phrases can be several BPM out,
        # and a wrong hint pulls against the audio. The band has drums, so the grid
        # and chords the studio adopts are measured from it instead.
        progress(0.9, desc="Measuring the band's tempo and chords")
        summary = measure(backing, bpm)
        vocal_stereo = tools.to_stereo(vocal, sr)
        mixed = tools.mix(vocal_stereo, band, str(job / "kiku-mix.flac"), instrumental_db=float(balance), report=summary)
        stem = tools.write(vocal_stereo, str(job / "your-vocal.flac"))
        parts = [None, None, None]
        if split_parts:
            parts = [tools.write(stems[name], str(job / (name + ".flac"))) for name in ("drums", "bass", "other")]
        summary["separated"] = lifted
        summary["voice"] = voiced
        summary["model"] = "ACE-Step 1.5"
        if locked is not None:
            summary["locked"] = locked
        prompt = ", ".join(details)
        note = " No singing was found, so the band follows your recording as it is." if not voiced else ""
        return (finished(started, "Band written") + note + " Your recording is untouched in the mix.",
                mixed, backing, stem, prompt, background, *parts, json.dumps(summary))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def measure(path, bpm=0):
    """Tempo, key and chords of a recording, for the studio's grid and chord lane."""
    import librosa
    mono, rate = librosa.load(path, sr=22050, mono=True)
    beats, tempo = tools.beat_grid(mono, rate, float(bpm or 0))
    key = tools.key_of(mono, rate)
    progression = tools.chords(mono, rate, beats, key) if len(beats) else []
    return {"tempo": round(float(tempo), 2), "key": key, "duration": round(len(mono) / rate, 3),
            "beats": [round(float(b), 3) for b in beats],
            "chords": [{"time": round(c["time"], 3), "name": tools.chord_name(c)} for c in progression]}


def part_time(*args, **kwargs):
    return 120


@spaces.GPU(duration=part_time)
def part(reference, instrument, style, bpm, key, duration, strength, steps, seed,
         progress=gr.Progress()):
    """One instrument. With a mix it is the base model's lego task, written into that mix;
    without one it is text-to-music, kept to that instrument's Demucs stem.
    Same arguments as Kiku-Engine's /part."""
    if instrument != "band" and instrument not in TRACKS:
        raise gr.Error("Choose one of: " + ", ".join([*TRACKS, "band"]) + ".")
    job, started = job_dir(), time.monotonic()
    words = (style or "").strip()
    try:
        if reference:
            total = length(reference)
            if total > MAX_BAND:
                raise gr.Error("Parts can follow up to %d minutes." % (MAX_BAND // 60))
            progress(0.05, desc="Listening to your project")
            summary = measure(reference, bpm)
            # Lego hears the whole mix; only tempo and key the studio already knows are passed on.
            fields = dict(src_audio=reference, lyrics="[Instrumental]", duration=float(total),
                          inference_steps=int(min(max(steps or 50, 20), 80)), guidance_scale=7.0,
                          seed=int(seed or -1), **meta(bpm, (key or "").strip()))
            if instrument == "band":
                progress(0.3, desc="Writing a band into your project")
                path = run(base, job, task_type="complete",
                           instruction=base.generate_instruction("complete", complete_track_classes=BAND),
                           caption=words or "full band", **fields)
            else:
                progress(0.3, desc="Writing the %s into your project" % instrument)
                path = run(base, job, task_type="lego",
                           instruction=base.generate_instruction("lego", track_name=TRACKS[instrument]),
                           caption=words or instrument, repainting_start=0.0, repainting_end=-1, **fields)
            prompt = words or instrument
        else:
            if not 5 <= float(duration) <= 240:
                raise gr.Error("Choose a length from 5 to 240 seconds.")
            summary = {"tempo": float(bpm or 0), "key": (key or "").strip(), "chords": []}
            prompt = ", ".join(x for x in ((instrument if instrument != "band" else "full band") + " only",
                                          words) if x)
            progress(0.2, desc="Composing")
            path = run(turbo, job, task_type="text2music", caption=prompt[:512], lyrics="[Instrumental]",
                       instrumental=True, duration=float(duration), inference_steps=8, shift=3.0,
                       seed=int(seed or -1), **meta(bpm, (key or "").strip()))
        # Lego is trained to write just the one track, but keeping only that stem
        # guarantees a part never brings a copy of the whole mix with it.
        stem = {"drums": "drums", "bass": "bass"}.get(instrument, "other" if instrument != "band" else None)
        if stem:
            progress(0.9, desc="Keeping only the " + instrument)
            found, split_sr = tools.split_all(path, demucs())
            path = tools.write(tools.to_stereo(found[stem], split_sr), str(job / (instrument + ".wav")))
        summary["model"] = "ACE-Step 1.5"
        return finished(started, instrument.capitalize() + " part"), path, prompt, json.dumps(summary)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ----------------------------------------------------------------------- app

with gr.Blocks(title="Kiku ACE-Step 1.5") as demo:
    gr.Markdown("# Kiku ACE-Step 1.5\nACE-Step 1.5 behind [Kiku AI](https://huggingface.co/spaces/Reubencf/Kiku-AI). "
                "The endpoints match Kiku-Engine's, so the studio can use either model.")
    with gr.Tab("Band"):
        a_audio = gr.Audio(label="Your recording", type="filepath")
        a_style = gr.Textbox(label="Band style")
        a_sep = gr.Radio(SEPARATE, value="auto", label="Lift the voice off any backing music")
        a_balance = gr.Slider(-12, 6, value=-3, step=0.5, label="Band level (dB)")
        a_strength = gr.Slider(0.2, 0.8, value=0.45, step=0.05, label="Unused by ACE-Step 1.5")
        a_split = gr.Checkbox(value=True, label="Split the band into drums, bass and the rest")
        a_bpm = gr.Number(value=0, label="Tempo (0 to detect)")
        a_steps = gr.Slider(20, 80, value=50, step=5, label="Base model steps")
        a_seed = gr.Number(value=-1, label="Seed", precision=0)
        a_run = gr.Button("Write the band", variant="primary")
        a_out = [gr.Textbox(label="Status"), gr.Audio(label="Mix", type="filepath"),
                 gr.Audio(label="Band", type="filepath"), gr.Audio(label="Your vocal", type="filepath"),
                 gr.Textbox(label="Prompt"), gr.Audio(label="Original backing", type="filepath"),
                 gr.Audio(label="Drums", type="filepath"), gr.Audio(label="Bass", type="filepath"),
                 gr.Audio(label="Everything else", type="filepath"), gr.Code(label="Measured", language="json")]
        a_run.click(accompany, [a_audio, a_style, a_sep, a_balance, a_strength, a_split, a_bpm, a_steps,
                                a_seed], a_out, api_name="accompany", concurrency_limit=1)
    with gr.Tab("Part"):
        n_ref = gr.Audio(label="Follow this mix (optional)", type="filepath")
        n_inst = gr.Radio([*TRACKS, "band"], value="drums", label="Instrument")
        n_style = gr.Textbox(label="Style")
        n_bpm = gr.Number(value=0, label="Tempo (0 to detect)")
        n_key = gr.Textbox(label="Key")
        n_duration = gr.Slider(5, 240, value=30, step=5, label="Length without a mix (s)")
        n_strength = gr.Slider(0.2, 0.8, value=0.45, step=0.05, label="Unused by ACE-Step 1.5")
        n_steps = gr.Slider(20, 80, value=50, step=5, label="Base model steps")
        n_seed = gr.Number(value=-1, label="Seed", precision=0)
        n_run = gr.Button("Write the part", variant="primary")
        n_out = [gr.Textbox(label="Status"), gr.Audio(label="Part", type="filepath"),
                 gr.Textbox(label="Prompt"), gr.Code(label="Measured", language="json")]
        n_run.click(part, [n_ref, n_inst, n_style, n_bpm, n_key, n_duration, n_strength, n_steps, n_seed],
                    n_out, api_name="part", concurrency_limit=1)
    with gr.Tab("Song"):
        s_style = gr.Textbox(label="Style")
        s_lyrics = gr.Textbox(label="Lyrics", lines=10)
        s_duration = gr.Slider(-1, MAX_TEXT, value=-1, step=5, label="Length (-1 lets the model choose)")
        s_seed = gr.Number(value=-1, label="Seed", precision=0)
        s_meta = gr.Textbox(label="Tempo, key and metre (JSON, optional)")
        s_run = gr.Button("Write the song", variant="primary")
        s_out = [gr.Textbox(label="Status"), gr.Audio(label="Song", type="filepath")]
        s_run.click(song, [s_style, s_lyrics, s_duration, s_seed, s_meta], s_out, api_name="song", concurrency_limit=1)
    with gr.Tab("Instrumental"):
        g_in = [gr.Textbox(label="Style"), gr.Textbox(label="Lyrics"),
                gr.Slider(10, MAX_TEXT, value=60, step=5, label="Length (s)"),
                gr.Slider(1, 120, value=8, step=1, label="Steps (turbo uses 8)"),
                gr.Slider(1, 25, value=7, step=0.5, label="Guidance (unused by turbo)"),
                gr.Number(value=-1, label="Seed", precision=0)]
        g_run = gr.Button("Generate", variant="primary")
        g_out = [gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")]
        g_run.click(instrumental, g_in, g_out, api_name="instrumental", concurrency_limit=1)
    with gr.Tab("Restyle"):
        r_in = [gr.Audio(label="Source", type="filepath"), gr.Textbox(label="Style"),
                gr.Textbox(label="Lyrics"), gr.Slider(0.1, 0.9, value=0.5, step=0.05, label="Keep the source"),
                gr.Slider(1, 120, value=8, step=1, label="Steps"), gr.Number(value=-1, label="Seed", precision=0),
                gr.Textbox(label="Tempo, key and metre (JSON, optional)")]
        r_run = gr.Button("Restyle", variant="primary")
        r_out = [gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath"), gr.Textbox(label="Beat lock")]
        r_run.click(remix, r_in, r_out, api_name="remix", concurrency_limit=1)
    with gr.Tab("Rewrite"):
        p_in = [gr.Audio(label="Source", type="filepath"), gr.Textbox(label="Style"),
                gr.Textbox(label="Lyrics"), gr.Number(value=0, label="Start (s)"), gr.Number(value=10, label="End (s)"),
                gr.Slider(0.1, 1.0, value=0.5, step=0.05, label="Variance (unused)"),
                gr.Slider(1, 120, value=8, step=1, label="Steps"), gr.Number(value=-1, label="Seed", precision=0),
                gr.Textbox(label="Tempo, key and metre (JSON, optional)")]
        p_run = gr.Button("Rewrite", variant="primary")
        p_out = [gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath"), gr.Textbox(label="Beat lock")]
        p_run.click(repaint, p_in, p_out, api_name="repaint", concurrency_limit=1)
    with gr.Tab("Extend"):
        e_in = [gr.Audio(label="Source", type="filepath"), gr.Textbox(label="Style"),
                gr.Textbox(label="Lyrics"), gr.Slider(5, 60, value=20, step=5, label="Seconds to add"),
                gr.Slider(1, 120, value=8, step=1, label="Steps"), gr.Number(value=-1, label="Seed", precision=0)]
        e_run = gr.Button("Extend", variant="primary")
        e_out = [gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")]
        e_run.click(extend, e_in, e_out, api_name="extend", concurrency_limit=1)
    with gr.Tab("Enhance"):
        h_in = [gr.Audio(label="Audio to listen to (optional)", type="filepath"),
                gr.Textbox(label="Short description"), gr.Textbox(label="Lyrics (optional)")]
        h_run = gr.Button("Write a fuller description", variant="primary")
        h_out = [gr.Textbox(label="Status"), gr.Textbox(label="Caption"), gr.Code(label="Tempo, key and metre", language="json")]
        h_run.click(enhance, h_in, h_out, api_name="enhance", concurrency_limit=2)
    with gr.Tab("Song idea"):
        i_in = [gr.Textbox(label="Describe the song"), gr.Checkbox(value=False, label="Instrumental"),
                gr.Textbox(label="Vocal language code (optional)")]
        i_run = gr.Button("Write the idea", variant="primary")
        i_out = [gr.Textbox(label="Status"), gr.Textbox(label="Caption"), gr.Textbox(label="Lyrics"),
                 gr.Code(label="Tempo, key and metre", language="json")]
        i_run.click(sample, i_in, i_out, api_name="sample", concurrency_limit=2)
    gr.Markdown("[ACE-Step 1.5](https://huggingface.co/ACE-Step/Ace-Step1.5) is MIT licensed; "
                "results may be used commercially. Separation by [Demucs](https://github.com/adefossez/demucs) (MIT).")


if __name__ == "__main__":
    demo.queue(max_size=8).launch(server_name="0.0.0.0", server_port=7860, max_file_size="100mb",
                                  show_error=False, ssr_mode=False)
