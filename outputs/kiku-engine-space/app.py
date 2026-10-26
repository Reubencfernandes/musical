"""The single ZeroGPU API behind Kiku AI: transcription, songs and backing tracks.

Three models share this Space. They pin incompatible versions of transformers, so
only YuE2's stack is installed from its own wheel and the other two run on it;
see requirements.txt. The acestep package is installed here with --no-deps for
the same reason.

Every model is built on first use rather than at import. YuE2 forces that — it
calls torch.cuda.set_per_process_memory_fraction while constructing, which
reaches low-level CUDA init and is refused outside a @spaces.GPU function — and
it also keeps the cold start from loading three models a caller may not want.
Weights are still fetched at startup, so no request pays to download them.
"""
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

if os.environ.get("KIKU_RUNTIME") != "modal":
    import site
    # See vllm_mig.py: lets YuE2-Turbo's vLLM processes run on ZeroGPU's MIG slices.
    Path(site.getsitepackages()[0], "kiku_vllm_mig.pth").write_text(
        "%s\nimport vllm_mig\n" % Path(__file__).resolve().parent)

import gradio as gr
if os.environ.get("KIKU_RUNTIME") == "modal":
    import native_gpu as spaces
else:
    import spaces
import torch

import lyric_sections
import writer
import torchaudio_compat
torchaudio_compat.apply()

ACESTEP_COMMIT = "1bee4c9f5b43e30995f8d4d33b3919197ce1bd68"
SHEETSAGE_ID = "m-a-p/SheetSage2"
SHEETSAGE_REV = "eab522a8168e8b8b8c4856bf8609cd86198f01fe"
YUE2_ID = "m-a-p/YuE2-3B"
YUE2_VAE = "m-a-p/YuE2-Vae"
# A first YuE2 call starts the vLLM engine and compiles it: about 200 s on ZeroGPU.
YUE2_COLD = 240
# HeartTranscriptor: Whisper fine-tuned on separated vocals to write down sung lyrics (Apache 2.0).
LYRICS_ID = "HeartMuLa/HeartTranscriptor-oss"
LYRICS_REV = "918f88917c17489c1f8dbae0165cd1019c4d5cd3"
# Its own decoding settings, from heartlib's examples/run_lyrics_transcription.py.
LYRICS_DECODING = {"task": "transcribe", "max_new_tokens": 256, "num_beams": 2,
                   "condition_on_prev_tokens": False, "compression_ratio_threshold": 1.8,
                   "temperature": (0.0, 0.1, 0.2, 0.4), "logprob_threshold": -1.0,
                   "no_speech_threshold": 0.4}
ROOT = Path(os.environ.get("KIKU_OUTPUT_ROOT", str(Path(tempfile.gettempdir()) / "kiku-engine")))
ROOT.mkdir(exist_ok=True)
# ACE-Step writes at most four minutes in one pass.
MAX_BAND = 240
COT = ["full", "melody", "off"]
logging.basicConfig(level=logging.INFO)

# acestep pins transformers==4.50.0 and accelerate==1.6.0, which contradict the
# YuE2 wheel already installed. Its dependencies are in requirements.txt, so the
# package itself is added without them.
if os.environ.get("KIKU_RUNTIME") != "modal":
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "--quiet",
                    "git+https://github.com/ace-step/ACE-Step.git@" + ACESTEP_COMMIT], check=True)
    # SheetSage2 renders scores through a headless browser.
    subprocess.run([sys.executable, "-m", "playwright", "install", "--only-shell", "chromium"], check=True)

from huggingface_hub import snapshot_download

REVISIONS = {LYRICS_ID: LYRICS_REV, writer.MODEL: writer.REVISION}
for repo in (() if os.environ.get("KIKU_RUNTIME") == "modal" else (YUE2_ID, YUE2_VAE, LYRICS_ID, writer.MODEL)):
    try:
        local = snapshot_download(repo, revision=REVISIONS.get(repo))
        if repo == YUE2_ID:
            # vLLM serves YuE2's AR tensors from their own checkpoint; extract it on CPU
            # now so no GPU call spends its time on it.
            from yue2.fast import derive_ar_checkpoint
            derive_ar_checkpoint(local)
    except Exception:
        logging.exception("Could not pre-fetch %s; it downloads on first use", repo)

ENGINES = {}


def sheetsage():
    if "sheetsage" not in ENGINES:
        from transformers import AutoModel
        # This model merges LoRA adapters while loading and refuses to do it in
        # anything but CPU float32 ("Merge adapters on CPU with float32
        # parameters"), so it is materialised at the default dtype on CPU and
        # cast on the way to the GPU rather than loaded as bfloat16.
        model = AutoModel.from_pretrained(SHEETSAGE_ID, revision=SHEETSAGE_REV,
                                          trust_remote_code=True)
        ENGINES["sheetsage"] = model.eval().to("cuda", dtype=torch.bfloat16)
    return ENGINES["sheetsage"]


def yue2():
    if "yue2" not in ENGINES:
        from yue2 import YuE2Pipeline
        if os.environ.get("KIKU_RUNTIME") == "modal":
            # YuE2-Turbo: vLLM runs the AR stage in its own process (about 30% of the
            # L40S), so PyTorch's budget shrinks to leave it room. Models stay resident.
            turbo = os.environ.get("KIKU_YUE2_BACKEND") == "vllm"
            ENGINES["yue2"] = YuE2Pipeline.from_pretrained(
                "/data/yue2", vae="/data/yue2-vae", device="cuda", local_files_only=True,
                **(dict(backend="vllm", resident_models=True, memory_budget_gib=30) if turbo
                   else dict(backend="torch", memory_budget_gib=36)),
            )
        else:
            # YuE2-Turbo on ZeroGPU: the vLLM engine starts once per GPU worker (about
            # two minutes) and then lives across calls; a warm song takes about 60% of
            # the PyTorch time. The MoT and VAE stay on the GPU too (about 8 GB), or
            # reloading them would cost more than vLLM saves. If vLLM cannot start,
            # the original path still sings.
            try:
                from yue2.fast import preload_vllm
                pipe = YuE2Pipeline.from_pretrained(YUE2_ID, device="cuda", backend="vllm",
                                                    resident_models=True)
                preload_vllm(pipe)
            except Exception:
                logging.exception("YuE2-Turbo's vLLM engine did not start; using PyTorch")
                pipe = YuE2Pipeline.from_pretrained(YUE2_ID, device="cuda")
            ENGINES["yue2"] = pipe
    return ENGINES["yue2"]


def transcriptor():
    if "lyrics" not in ENGINES:
        from transformers import pipeline
        ENGINES["lyrics"] = pipeline("automatic-speech-recognition", model=LYRICS_ID, revision=LYRICS_REV,
                                     torch_dtype=torch.float16, device="cuda")
    return ENGINES["lyrics"]


def lyricist():
    """Qwen3-4B, which writes song ideas and style prompts (see writer.py). It waits
    in CPU memory between calls, so YuE2 keeps the GPU's memory budget to itself."""
    if "writer" not in ENGINES:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(writer.MODEL, revision=writer.REVISION)
        model = AutoModelForCausalLM.from_pretrained(writer.MODEL, revision=writer.REVISION,
                                                     torch_dtype=torch.bfloat16)
        ENGINES["writer"] = (model.eval(), tokenizer)
    return ENGINES["writer"]


def acestep():
    if "acestep" not in ENGINES:
        from acestep.pipeline_ace_step import ACEStepPipeline
        pipe = ACEStepPipeline(dtype="bfloat16")
        pipe.load_checkpoint()
        ENGINES["acestep"] = pipe
    return ENGINES["acestep"]


def demucs():
    if "demucs" not in ENGINES:
        from demucs.pretrained import get_model
        ENGINES["demucs"] = get_model("htdemucs").to("cuda").eval()
    return ENGINES["demucs"]


def cold(name, seconds):
    """Extra GPU time for the first request that has to load a model."""
    return 0 if name in ENGINES else seconds


def sweep():
    cutoff = time.time() - 86400
    for old in ROOT.glob("job-*"):
        if old.is_dir() and not old.is_symlink() and old.stat().st_mtime < cutoff:
            shutil.rmtree(old, ignore_errors=True)


def job_dir():
    sweep()
    return Path(tempfile.mkdtemp(prefix="job-", dir=ROOT))


def seed_list(seed):
    return None if seed in (None, "", -1) else [int(seed)]


def failed(exc):
    logging.exception("Request failed")
    if isinstance(exc, torch.cuda.OutOfMemoryError):
        return gr.Error("That was too long to process at once. Try a shorter section.")
    return gr.Error("The request failed. Try a shorter clip. Details are in the Space logs.")


def guard(audio, label="a recording"):
    if not audio:
        raise gr.Error("Upload " + label + " first.")


import audio_tools as tools  # noqa: E402  (after the compat shim is applied)
import scores  # noqa: E402
import sync  # noqa: E402


# ------------------------------------------------------------- transcription

def transcribe_time(audio, start, duration, melody_only, piano, progress=None, **kwargs):
    return max(45, min(300, int(float(duration or 30) * 0.4) + 30)) + cold("sheetsage", 90)


def _bar_timing(abc, result, output, clip):
    """Where each score bar starts, in quarter notes and in seconds of the clip.

    The web app uses it to follow the recording on the score. SheetSage2 builds
    the score on the beats it hears, so its beat.lab places every bar line;
    without it there is no timing and the app simply does not follow along.
    """
    try:
        labs = (result.get("labs") or {}) if isinstance(result, dict) else {}
        text = labs.get("beat") or next((p.read_text(encoding="utf-8") for p in sorted(output.glob("*beat*.lab"))), "")
        beats = sync.beat_rows(text)
        score = scores.read(abc)
        clock = sync.bar_starts(beats, len(score.bars), _seconds(str(clip)))
        if not clock:
            return None
        bars = [float(bar.start) for bar in score.bars] + [float(score.length)]
        return {"bpm": score.bpm, "bars": bars, "clock": clock}
    except Exception:
        logging.exception("No bar timing for this transcription")
        return None


@spaces.GPU(duration=transcribe_time)
def transcribe(audio, start, duration, melody_only, piano, progress=gr.Progress()):
    """Turn a recording into a lead sheet: ABC, MIDI, PDF, bar timing and, when
    asked, a piano preview."""
    if not audio:
        raise gr.Error("Upload an audio file first.")
    if start < 0 or not 5 <= duration <= 600:
        raise gr.Error("Choose a start of 0 or later and a duration from 5 to 600 seconds.")
    yield "Preparing your audio…", [], None, None, [], "", None
    job = job_dir()
    clip, output = job / "input.wav", job / "results"
    output.mkdir()
    try:
        progress(0.03, desc="Preparing audio excerpt")
        done = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", str(audio),
             "-t", str(duration), "-ac", "1", "-ar", "24000", "-y", str(clip)],
            capture_output=True, timeout=120)
        if done.returncode or not clip.exists() or clip.stat().st_size < 2048:
            raise gr.Error("Could not read this excerpt. Check the file and start time.")
        progress(0.06, desc="Loading SheetSage2 — the first run takes longer")
        model = sheetsage()
        started = time.monotonic()

        def update(event):
            labels = {"audio": "Reading audio", "encoding": "Listening to the music",
                      "decoding": "Writing notes and chords", "notation": "Preparing notation",
                      "complete": "Rendering printable score"}
            detail = labels.get(event.get("stage", ""), "Processing music")
            if "window" in event:
                detail += " · section %s/%s" % (event["window"], event["windows"])
            progress(None, desc=detail)

        notice = ""
        try:
            with torch.inference_mode():
                result = model.transcribe(str(clip), output_dir=str(output),
                                          melody_only=bool(melody_only), render_audio=bool(piano),
                                          render_score="pdf", dtype="bf16", progress=update)
        except Exception as exc:
            result = getattr(exc, "result", None)
            if result is None or not any(output.glob("*.mid")):
                raise
            logging.exception("Partial transcription")
            notice = " Some score rendering failed; the available files are included."
        progress(0.97, desc="Preparing downloads")
        files = sorted(p for p in output.iterdir() if p.is_file() and p.suffix != ".partial")
        if not files:
            raise RuntimeError("The model returned no output files.")
        archive = shutil.make_archive(str(job / "score-downloads"), "zip", output)
        pdf, wavs = output / "score.pdf", sorted(output.glob("*.wav"))
        abc_path = output / "score.abc"
        abc = abc_path.read_text(encoding="utf-8") if abc_path.exists() else ""
        timing = _bar_timing(abc, result, output, clip) if abc else None
        elapsed = round(time.monotonic() - started)
        status = "Finished in %dm %ds. Download your files below.%s" % (elapsed // 60, elapsed % 60, notice)
        yield (status, [str(p) for p in sorted(output.glob("score_*.png"))],
               str(pdf) if pdf.exists() else None, str(wavs[0]) if wavs else None,
               [archive] + [str(p) for p in files], abc, timing)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# -------------------------------------------------------------- songs (YuE2)

def song_time(style, lyrics, cot, seed, abc, progress=None, **kwargs):
    return max(90, min(420, 90 + int(len(lyrics or "") * 0.35))) + cold("yue2", YUE2_COLD)


def _song(style, lyrics, cot, seed, abc, progress):
    if not (style or "").strip():
        raise gr.Error("Describe the style you want, for example 'dream pop, female vocal'.")
    if not (lyrics or "").strip():
        raise gr.Error("Add lyrics. Mark sections with [verse], [chorus] and [bridge].")
    if cot not in COT:
        raise gr.Error("Planning mode must be full, melody or off.")
    if cot == "melody" and not (abc or "").strip():
        raise gr.Error("Melody planning needs an ABC score. Transcribe a recording first.")
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.05, desc="Planning melody and chords")
        chosen = int(seed) if seed not in (None, "", -1) else int.from_bytes(os.urandom(4), "big")
        song = yue2()(style=style.strip(), lyrics=lyrics.strip(), cot=cot, seed=chosen,
                      **({"abc": abc.strip()} if (abc or "").strip() else {}))
        progress(0.9, desc="Rendering audio")
        flac = job / "song.flac"
        song.save(str(flac))
        artifacts, plan = job / "artifacts", ""
        try:
            song.save_artifacts(str(artifacts))
            scores = sorted(artifacts.rglob("*.abc"))
            plan = scores[0].read_text(encoding="utf-8") if scores else ""
        except Exception:
            logging.exception("Artifact export failed")
        archive = (shutil.make_archive(str(job / "song-artifacts"), "zip", artifacts)
                   if artifacts.exists() else None)
        elapsed = round(time.monotonic() - started)
        return ("Finished in %dm %ds · seed %d" % (elapsed // 60, elapsed % 60, chosen),
                str(flac), archive, plan, chosen, json.dumps(_generation_report(song, chosen)))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=song_time)
def song(style, lyrics, cot, seed, abc, progress=gr.Progress()):
    return _song(style, lyrics, cot, seed, abc, progress)


@spaces.GPU(duration=song_time)
def cover(style, lyrics, abc, seed, progress=gr.Progress()):
    return _song(style, lyrics, "melody", seed, abc, progress)


def _generation_report(result, seed):
    truncated = getattr(result, "truncated", False)
    if isinstance(truncated, dict):
        truncated = any(truncated.values())
    timing = getattr(result, "timing", None) or {}
    # "vllm" is YuE2-Turbo; cot="off" and CFG requests run on PyTorch either way.
    backend = (timing.get("semantic") or {}).get("backend_actual", "torch")
    return {"seed": seed, "truncated": bool(truncated), "model": YUE2_ID,
            "decoder": "m-a-p/YuE2-Vae", "backend": backend}


@spaces.GPU(duration=lambda *args, **kwargs: 120 + cold("yue2", YUE2_COLD))
def plan_score(style, lyrics, seed, instrumental=False, progress=gr.Progress()):
    """Only the symbolic stage: return a reviewable score before synthesizing audio."""
    if not (style or "").strip():
        raise gr.Error("Describe the style for your musical draft.")
    words = "[verse]\n[chorus]" if instrumental else (lyrics or "").strip()
    if not words:
        raise gr.Error("Add lyrics with section labels before planning the melody.")
    try:
        chosen = int(seed) if seed not in (None, "", -1) else int.from_bytes(os.urandom(4), "big")
        described = "Instrumental, " + style.strip() if instrumental else style.strip()
        progress(0.1, desc="Planning the melody, chords and sections")
        plan = yue2().plan(style=described, lyrics=words, cot="full", seed=chosen)
        if not plan.abc:
            raise gr.Error("YuE2 did not return a score. Try a shorter musical draft.")
        report = _generation_report(plan, chosen)
        if report["truncated"]:
            raise gr.Error("YuE2 reached its score limit before finishing the draft. Try planning again, or open the score editor to write a shorter piece.")
        score = scores.read(plan.abc)
        if instrumental:
            score = scores.vocal_to_ins(score)
        text = scores.write(score)
        return "Planned %d bars. Review the score before rendering." % len(score.bars), text, json.dumps(report)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def score_instrumental(style, abc, duration, seed, progress=gr.Progress()):
    """Plan or use the edited score, then explicitly transfer melody into Ins."""
    if not (style or "").strip():
        raise gr.Error("Describe the instrumental sound you want.")
    try:
        if not (abc or "").strip():
            _, abc, planned = plan_score("%s, around %d seconds" % (style, int(duration)), "", seed, True)
            seed = json.loads(planned)["seed"]
        score = scores.vocal_to_ins(scores.read(abc))
        if not score.ins and not score.chords:
            raise gr.Error("Add melody notes or chords before rendering the instrumental.")
        text = scores.write(score)
        prompt = "Instrumental, %s, %d BPM, %s." % (style.strip(), score.bpm, ", ".join(INSTRUMENTAL))
        progress(0.4, desc="Playing the reviewed instrumental score")
        path, _, report = _render_score(text, prompt, scores.lyric_tags(score),
                                         "full" if score.chords else "melody", seed, strip_voice=True)
        return "Instrumental rendered from %d bars." % len(score.bars), path, text, report["seed"], json.dumps(report)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------ backing tracks (ACE)

def render(job, **kwargs):
    kwargs.setdefault("format", "wav")
    kwargs.setdefault("infer_step", 60)
    kwargs.setdefault("guidance_scale", 15.0)
    result = acestep()(save_path=str(job), **kwargs)
    audio = [str(p) for p in result[:-1] if p and str(p).endswith((".wav", ".flac", ".mp3", ".ogg"))]
    if not audio:
        raise RuntimeError("The model returned no audio.")
    return audio[0]


def instrumental_time(prompt, lyrics, duration, steps, guidance, seed, progress=None, **kwargs):
    base = max(45, min(300, int(float(duration or 60) * float(steps or 60) * 0.012) + 40))
    return base + cold("acestep", 120)


@spaces.GPU(duration=instrumental_time)
def instrumental(prompt, lyrics, duration, steps, guidance, seed, progress=gr.Progress()):
    if not (prompt or "").strip():
        raise gr.Error("Describe the music you want, for example 'lo-fi hip hop, 82 bpm'.")
    if not 10 <= float(duration) <= 240:
        raise gr.Error("Choose a length from 10 to 240 seconds.")
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.1, desc="Composing")
        path = render(job, prompt=prompt.strip(), lyrics=(lyrics or "").strip() or "[inst]",
                      audio_duration=float(duration), infer_step=int(steps),
                      guidance_scale=float(guidance), manual_seeds=seed_list(seed))
        elapsed = round(time.monotonic() - started)
        return "Finished in %dm %ds" % (elapsed // 60, elapsed % 60), path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# How the guide track is voiced for each kind of part, and which Demucs stem
# holds that part afterwards. A single-instrument prompt still yields a little
# of everything, so the stem filter is what makes a part a part.
INSTRUMENTS = {
    "drums": ("drum kit only, punchy live drums, groove, no melody", ("drums",), "drums"),
    "bass": ("bass guitar only, tight groovy bassline", ("bass", "drums"), "bass"),
    "keys": ("piano and keys, chordal accompaniment", ("chords",), "other"),
    "guitar": ("guitar, rhythm guitar playing the chords", ("chords", "drums"), "other"),
    "strings": ("string section, lush sustained strings", ("chords",), "other"),
    "synth": ("synthesizer, analog synth pads and arpeggios", ("chords",), "other"),
    "band": ("full band", tools.PARTS, None),
}
SEPARATE = ["auto", "always", "never"]


def follow(job, reference, style, parts, strength, steps, seed, bpm=0, progress=None):
    """Write music that follows the beat grid and chords of `reference`.

    Returns the rendered audio aligned to the reference, its sample rate, a
    summary of what was measured and the prompt used. A recording with no
    steady pulse falls back to plain text-to-music at the measured key, since
    a guide built on a wrong grid is worse than none.
    """
    import librosa
    import soundfile as sf
    mono, rate = librosa.load(reference, sr=22050, mono=True)
    duration = len(mono) / rate
    beats, tempo = tools.beat_grid(mono, rate, float(bpm or 0))
    key = tools.key_of(mono, rate)
    progression = tools.chords(mono, rate, beats, key) if len(beats) else []
    details = [style.strip() or "warm modern pop production"]
    if tempo:
        details.append("%d bpm" % round(tempo))
    if key:
        details.append("key of " + key)
    details.append("instrumental")
    prompt = ", ".join(details)
    if progress:
        progress(0.35, desc="Writing to your %s" % ("chords and beat" if progression else "key"))
    kwargs = dict(prompt=prompt, lyrics="[inst]", audio_duration=float(duration),
                  infer_step=int(steps), manual_seeds=seed_list(seed))
    offset = 0.0
    if len(beats):
        track = tools.guide(beats, progression, duration, parts=parts)
        guide_path = str(job / "guide.wav")
        sf.write(guide_path, track, tools.GUIDE_SR, subtype="PCM_16")
        path = render(job, audio2audio_enable=True, ref_audio_input=guide_path,
                      ref_audio_strength=float(strength), **kwargs)
        # audio2audio keeps the guide's timing closely but not exactly; the
        # last few tens of milliseconds are measured and taken out here.
        written, _ = librosa.load(path, sr=rate, mono=True)
        offset = tools.offset_between(
            librosa.resample(track, orig_sr=tools.GUIDE_SR, target_sr=rate), written, rate)
    else:
        path = render(job, **kwargs)
    audio, sr = tools.load(path)
    audio = tools.shift(tools.to_stereo(audio, sr), offset, tools.SR, length=int(duration * tools.SR))
    summary = {"tempo": round(float(tempo), 2), "key": key, "duration": round(duration, 3),
               "offset": round(offset, 3), "beats": [round(float(b), 3) for b in beats],
               "chords": [{"time": round(c["time"], 3), "name": tools.chord_name(c)}
                          for c in progression]}
    return audio, tools.SR, summary, prompt


def accompany_time(audio, style, separate, balance, strength, split_parts, bpm, steps, seed,
                   progress=None, **kwargs):
    uses_demucs = separate != "never" or split_parts
    base = int(steps or 60) * 2 + 90 + (30 if separate != "never" else 0) + (30 if split_parts else 0)
    return min(420, base) + cold("acestep", 120) + (cold("demucs", 40) if uses_demucs else 0)


@spaces.GPU(duration=accompany_time)
def accompany(audio, style, separate, balance, strength, split_parts, bpm, steps, seed,
              progress=gr.Progress()):
    """Build a band under a real recording, keeping the original voice.

    The voice is never regenerated. When the take already has music behind it
    (or `separate` is "always"), Demucs lifts the voice out and the band is
    written to the old backing's beat and chords, which carry the harmony far
    more reliably than a melody alone.
    """
    guard(audio, "a recording of your voice")
    if separate not in SEPARATE:
        raise gr.Error("Choose auto, always or never for separation.")
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.05, desc="Listening to your recording")
        vocal, sr = tools.load(audio)
        duration = vocal.shape[1] / sr
        if duration < 3:
            raise gr.Error("That recording is too short. Record at least a few seconds.")
        if duration > MAX_BAND:
            raise gr.Error("Backing tracks are limited to %d minutes." % (MAX_BAND // 60))
        reference, background, found_backing, voiced = audio, None, False, True
        if separate != "never":
            progress(0.15, desc="Checking for music behind your voice")
            voice, rest, sr_sep = tools.separate(audio, demucs(), want="vocals")
            voiced = tools.has_voice(voice, rest, sr_sep)
            if voiced and (separate == "always" or tools.has_backing(voice, rest)):
                found_backing = True
                vocal, sr = voice, sr_sep
                background = tools.write(tools.to_stereo(rest, sr_sep), str(job / "original-backing.wav"))
                reference = background
        band, band_sr, summary, prompt = follow(job, reference, style, tools.PARTS, strength,
                                                steps, seed, bpm, progress)
        progress(0.85, desc="Mixing your voice over the band")
        vocal_stereo = tools.to_stereo(vocal, sr)
        backing = tools.write(band, str(job / "kiku-band.wav"), band_sr)
        mixed = tools.mix(vocal_stereo, band, str(job / "kiku-mix.wav"), instrumental_db=float(balance), report=summary)
        stem = tools.write(vocal_stereo, str(job / "your-vocal.wav"))
        parts = [None, None, None]
        if split_parts:
            progress(0.92, desc="Splitting the band into drums, bass and the rest")
            found, split_sr = tools.split_all(backing, demucs())
            parts = [tools.write(tools.to_stereo(found[name], split_sr), str(job / (name + ".wav")))
                     for name in ("drums", "bass", "other")]
        summary["separated"] = found_backing
        summary["voice"] = voiced
        elapsed = round(time.monotonic() - started)
        status = "Finished in %dm %ds / %s BPM" % (elapsed // 60, elapsed % 60,
                                                   round(summary["tempo"]) or "no steady")
        if summary["key"]:
            status += " / " + summary["key"]
        if summary["chords"]:
            status += " / " + " ".join(c["name"] for c in summary["chords"][:8])
        if found_backing:
            status += ". Your voice was lifted off the original backing"
        if not voiced:
            status += ". No singing was found, so the band follows your recording as it is"
        status += ". Your recording is untouched in the mix."
        return (status, mixed, backing, stem, prompt, background, *parts, json.dumps(summary))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def part_time(reference, instrument, style, bpm, key, duration, strength, steps, seed,
              progress=None, **kwargs):
    return min(360, int(steps or 60) * 2 + 90) + cold("acestep", 120) + cold("demucs", 40)


@spaces.GPU(duration=part_time)
def part(reference, instrument, style, bpm, key, duration, strength, steps, seed,
         progress=gr.Progress()):
    """Write one instrument's part, following a reference mix when there is one."""
    if instrument not in INSTRUMENTS:
        raise gr.Error("Choose one of: " + ", ".join(INSTRUMENTS) + ".")
    words, parts, stem = INSTRUMENTS[instrument]
    style = ", ".join(x for x in (words, (style or "").strip()) if x)
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.05, desc="Listening to your project" if reference else "Composing")
        if reference:
            audio, sr, summary, prompt = follow(job, reference, style, parts, strength, steps,
                                                seed, bpm, progress)
            if summary["duration"] > MAX_BAND:
                raise gr.Error("Parts can follow up to %d minutes." % (MAX_BAND // 60))
            path = tools.write(audio, str(job / "part-full.wav"), sr)
        else:
            if not 5 <= float(duration) <= 240:
                raise gr.Error("Choose a length from 5 to 240 seconds.")
            details = [style]
            if float(bpm or 0):
                details.append("%d bpm" % round(float(bpm)))
            if (key or "").strip():
                details.append("key of " + key.strip())
            details.append("instrumental")
            prompt = ", ".join(details)
            path = render(job, prompt=prompt, lyrics="[inst]", audio_duration=float(duration),
                          infer_step=int(steps), manual_seeds=seed_list(seed))
            summary = {"tempo": float(bpm or 0), "key": (key or "").strip(), "chords": []}
        if stem:
            progress(0.9, desc="Keeping only the " + instrument)
            found, split_sr = tools.split_all(path, demucs())
            path = tools.write(tools.to_stereo(found[stem], split_sr), str(job / (instrument + ".wav")))
        elapsed = round(time.monotonic() - started)
        return ("%s part in %dm %ds." % (instrument.capitalize(), elapsed // 60, elapsed % 60),
                path, prompt, json.dumps(summary))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def split_time(*args, **kwargs):
    return 120 + cold("demucs", 60)


@spaces.GPU(duration=split_time)
def split(audio, progress=gr.Progress()):
    """Four stems - vocals, drums, bass and everything else - for the studio."""
    guard(audio)
    job = job_dir()
    try:
        progress(0.2, desc="Separating stems")
        found, sr = tools.split_all(audio, demucs())
        return ("Stems ready.", *[tools.write(tools.to_stereo(found[name], sr), str(job / (name + ".wav")))
                                  for name in ("vocals", "drums", "bass", "other")])
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def audio_time(*args, **kwargs):
    return 240 + cold("acestep", 120) + cold("demucs", 40)


def keep_voice(audio, lyrics, job, progress, generate):
    """Regenerate only the music under a singer, keeping the real voice.

    Restyle and rewrite run with "[inst]" lyrics when none are given, which
    tells the model to write instruments only: on a sung take that deletes the
    singing. So when the audio has a voice and no new lyrics were asked for,
    Demucs lifts the voice off, `generate` works on the backing alone, and the
    untouched voice goes back on top. Returns None when there is no voice to keep.
    """
    if (lyrics or "").strip():
        return None
    progress(0.08, desc="Lifting your voice off the music")
    voice, rest, sr = tools.separate(audio, demucs(), want="vocals")
    if not tools.has_voice(voice, rest, sr):
        return None
    backing = tools.write(tools.to_stereo(rest, sr), str(job / "backing-in.wav"))
    written, _ = tools.load(generate(backing))
    progress(0.9, desc="Putting your voice back")
    return tools.put_back(tools.to_stereo(voice, sr), written, tools.to_stereo(rest, sr),
                          str(job / "with-your-voice.wav"))


@spaces.GPU(duration=audio_time)
def remix(audio, prompt, lyrics, strength, steps, seed, progress=gr.Progress()):
    guard(audio)
    if not (prompt or "").strip():
        raise gr.Error("Describe the style you want to move towards.")
    job = job_dir()
    try:
        _, _, duration, _ = tools.analyse(audio)

        def generate(source):
            progress(0.2, desc="Remixing")
            return render(job, prompt=prompt.strip(), lyrics=(lyrics or "").strip() or "[inst]",
                          audio_duration=float(min(duration, 240)), audio2audio_enable=True,
                          ref_audio_input=source, ref_audio_strength=float(strength),
                          infer_step=int(steps), manual_seeds=seed_list(seed))
        kept = keep_voice(audio, lyrics, job, progress, generate)
        return ("Remix ready. Your voice is untouched." if kept else "Remix ready."), kept or generate(audio)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=audio_time)
def repaint(audio, prompt, lyrics, start, end, variance, steps, seed, progress=gr.Progress()):
    guard(audio)
    if float(end) <= float(start):
        raise gr.Error("The section end must come after its start.")
    job = job_dir()
    try:
        _, _, duration, _ = tools.analyse(audio)

        def generate(source):
            progress(0.2, desc="Rewriting that section")
            return render(job, task="repaint", src_audio_path=source, prompt=(prompt or "").strip(),
                          lyrics=(lyrics or "").strip() or "[inst]", audio_duration=float(duration),
                          repaint_start=float(start), repaint_end=float(end),
                          retake_variance=float(variance), infer_step=int(steps),
                          retake_seeds=seed_list(seed), manual_seeds=seed_list(seed))
        kept = keep_voice(audio, lyrics, job, progress, generate)
        return "Rewrote %.1fs to %.1fs." % (float(start), float(end)), kept or generate(audio)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=audio_time)
def extend(audio, prompt, lyrics, seconds, steps, seed, progress=gr.Progress()):
    guard(audio)
    job = job_dir()
    try:
        progress(0.1, desc="Continuing the track")
        _, _, duration, _ = tools.analyse(audio)
        return "Added %ds." % int(seconds), render(
            job, task="extend", src_audio_path=audio, prompt=(prompt or "").strip(),
            lyrics=(lyrics or "").strip() or "[inst]",
            audio_duration=float(duration + float(seconds)),
            repaint_start=int(duration), repaint_end=int(duration + float(seconds)),
            infer_step=int(steps), retake_seeds=seed_list(seed), manual_seeds=seed_list(seed))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=audio_time)
def edit(audio, prompt, lyrics, new_prompt, new_lyrics, steps, seed, progress=gr.Progress()):
    guard(audio)
    job = job_dir()
    try:
        progress(0.1, desc="Applying the edit")
        _, _, duration, _ = tools.analyse(audio)
        return "Edit applied.", render(
            job, task="edit", src_audio_path=audio, prompt=(prompt or "").strip(),
            lyrics=(lyrics or "").strip() or "[inst]",
            edit_target_prompt=(new_prompt or prompt or "").strip(),
            edit_target_lyrics=(new_lyrics or lyrics or "").strip() or "[inst]",
            audio_duration=float(duration), infer_step=int(steps), manual_seeds=seed_list(seed))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def stems_time(*args, **kwargs):
    return 120 + cold("demucs", 60)


@spaces.GPU(duration=stems_time)
def stems(audio, progress=gr.Progress()):
    guard(audio)
    job = job_dir()
    try:
        progress(0.2, desc="Separating stems")
        vocal, rest, sr = tools.separate(audio, demucs(), want="vocals")
        return ("Stems ready.",
                tools.write(tools.to_stereo(vocal, sr), str(job / "vocals.wav")),
                tools.write(tools.to_stereo(rest, sr), str(job / "instrumental.wav")))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------- scores: covers and bands (YuE2)
#
# A stretch of the studio is read into a score (SheetSage2: melody, chords,
# sections and the time every bar starts), optionally edited, and played by
# YuE2. Because the score carries the tune, the result keeps it. YuE2 does not
# keep exact time, so the render is read again and warped bar by bar onto the
# original's bar lines (sync.py); that is what lets it sit in the studio in
# sync with the tracks around it.

# Scores run YuE2 once over the whole stretch, so a full song keeps one arrangement.
MAX_SCORE = 300
VOICES = ["sing", "play"]
HARMONY = ["keep", "free"]
INSTRUMENTAL = ("no vocals", "no singing", "no choir", "no spoken words")


def _seconds(path):
    import soundfile as sf
    info = sf.info(path)
    return info.frames / float(info.samplerate)


def _sheetsage(mono, rate=24000):
    """Score and beat rows for a mono 24 kHz clip, in memory."""
    with torch.inference_mode():
        try:
            result = sheetsage().transcribe(mono, sampling_rate=rate, dtype="bf16")
        except Exception as exc:
            result = getattr(exc, "result", None)
            if not result:
                raise
    labs = result.get("labs") or {}
    return result.get("abc") or "", sync.beat_rows(labs.get("beat", ""))


def _words(vocal_path):
    """The sung lyrics as lines of text, written down by HeartTranscriptor (no timings)."""
    import librosa
    mono, _ = librosa.load(vocal_path, sr=16000, mono=True)
    with torch.inference_mode():
        heard = transcriptor()({"raw": mono, "sampling_rate": 16000}, chunk_length_s=30, batch_size=8,
                               generate_kwargs=LYRICS_DECODING)
    return lyric_sections.lines_of(heard.get("text"))


def _sung_lyrics(vocal_path, duration):
    """The lyrics with [verse], [chorus] and other section tags. Each sung stretch is
    transcribed on its own, which places the lines in time; see lyric_sections.py."""
    import librosa
    mono, sr = librosa.load(vocal_path, sr=16000, mono=True)
    spans = lyric_sections.sung_spans(mono, sr)
    if not spans:
        return ""
    clips = [{"raw": mono[int(start * sr):int(end * sr)], "sampling_rate": sr} for start, end in spans]
    with torch.inference_mode():
        heard = transcriptor()(clips, batch_size=8, generate_kwargs=LYRICS_DECODING)
    return lyric_sections.sections([(span, item.get("text") or "") for span, item in zip(spans, heard)],
                                   duration)


def read_time(audio, words=False, separate="auto", transcribe=True, **kwargs):
    seconds = min(MAX_SCORE, _seconds(audio)) if audio else 60
    total = 10 + (30 + int(seconds * 0.45) + cold("sheetsage", 90) if transcribe else 0)
    if separate != "never" or words:
        total += 15 + int(seconds * 0.12) + cold("demucs", 40)
    if words:
        total += 15 + int(seconds * 0.12) + cold("lyrics", 60)
    return min(600, total)


@spaces.GPU(duration=read_time)
def _read_take(audio, words=False, separate="auto", transcribe=True, sections=False):
    """Score, bar clock, and (when asked) the singer's own lines and voice.

    `transcribe=False` skips the score, for when the studio already sent one.
    `sections=True` also writes the words out with section tags, as "lyrics"."""
    import librosa
    job = job_dir()
    duration = _seconds(audio)
    abc, clock, beat_times = "", None, None
    if transcribe:
        mono, _ = librosa.load(audio, sr=24000, mono=True)
        abc, beats = _sheetsage(mono)
        if not abc:
            raise gr.Error("Kiku could not write a score for this stretch. It needs a steady beat "
                           "and a clear melody; try a longer or cleaner section.")
        score = scores.read(abc)
        clock = (sync.bar_starts(beats, len(score.bars), duration)
                 or sync.uniform_starts(len(score.bars), score.seconds(score.bars[0].length)))
        beat_times = [round(b[0], 4) for b in beats]
    found = {"abc": abc, "clock": clock, "beats": beat_times, "duration": duration, "vocal": audio, "background": None,
             "voiced": True, "separated": False, "lines": []}
    if separate != "never" or words:
        voice, rest, sr = tools.separate(audio, demucs(), want="vocals")
        found["voiced"] = tools.has_voice(voice, rest, sr)
        if found["voiced"] and (separate == "always" or tools.has_backing(voice, rest)):
            found["separated"] = True
            found["vocal"] = tools.write(tools.to_stereo(voice, sr), str(job / "your-vocal.flac"))
            found["background"] = tools.write(tools.to_stereo(rest, sr), str(job / "original-backing.flac"))
    if words and found["voiced"] and sections:
        found["lyrics"] = _sung_lyrics(found["vocal"], duration)
        found["lines"] = [line for line in found["lyrics"].splitlines() if line and not line.startswith("[")]
    elif words and found["voiced"]:
        found["lines"] = _words(found["vocal"])
    return found


def render_time(abc, style, lyrics, cot, seed, clock=None, span=0.0, strip_voice=False,
                split_parts=False, beats=None, **kwargs):
    seconds = min(MAX_SCORE, float(span or 0) or 60)
    total = 45 + int(seconds * 0.9) + cold("yue2", YUE2_COLD)
    if clock:
        total += 30 + int(seconds * 0.45) + cold("sheetsage", 90)
    if strip_voice or split_parts:
        total += 20 + int(seconds * 0.25) + cold("demucs", 40)
    return min(900, total)


@spaces.GPU(duration=render_time)
def _render_score(abc, style, lyrics, cot, seed, clock=None, span=0.0, strip_voice=False,
                  split_parts=False, beats=None):
    # `span` is the output length. It cannot be called `duration`: ZeroGPU reserves that keyword.
    """YuE2 plays the score; the result is then locked to `clock` when given."""
    import librosa
    job = job_dir()
    chosen = int(seed) if seed not in (None, "", -1) else int.from_bytes(os.urandom(4), "big")
    song = yue2()(style=style, lyrics=lyrics, cot=cot, seed=chosen, abc=abc)
    raw = job / "yue2.flac"
    song.save(str(raw))
    audio, sr = tools.load(str(raw))
    audio = tools.to_stereo(audio, sr)
    report = {**_generation_report(song, chosen), "locked": False}
    if strip_voice:
        # A backing must never sing over the user; anything vocal-like goes.
        _, rest, sep_sr = tools.separate(str(raw), demucs(), want="vocals")
        audio = tools.to_stereo(rest, sep_sr)
    if clock:
        mono = librosa.resample(audio.mean(axis=0), orig_sr=tools.SR, target_sr=24000)
        _, heard_rows = _sheetsage(mono)
        score = scores.read(abc)
        heard = sync.bar_starts(heard_rows, len(score.bars), len(mono) / 24000.0)
        if heard:
            warped, lock = sync.lock(audio, tools.SR, score, clock, heard, float(span),
                                     target_beats=beats, heard_beats=[r[0] for r in heard_rows])
            report.update(lock)
            if warped is not None:
                audio, report["locked"] = warped, True
        if not report["locked"]:
            # No trustworthy bar match: start it on the first bar and let it run.
            audio = tools.shift(audio, float(clock[0]), tools.SR, length=int(float(span) * tools.SR))
    path = tools.write(audio, str(job / "played.flac"))
    parts = [None, None, None]
    if split_parts:
        found, split_sr = tools.split_all(path, demucs())
        parts = [tools.write(tools.to_stereo(found[name], split_sr), str(job / (name + ".flac")))
                 for name in ("drums", "bass", "other")]
    return path, parts, report


def _prepare(audio, abc, clock, edits, words, separate, progress):
    """The score to play and the bar clock to land it on, from the audio or a
    score the studio already read and the user edited."""
    duration = _seconds(audio)
    if duration < 3:
        raise gr.Error("Select at least three seconds.")
    if duration > MAX_SCORE:
        raise gr.Error("Scores work on up to %d minutes at a time." % (MAX_SCORE // 60))
    found = None
    if not (abc or "").strip() or words or separate != "never":
        found = _read_take(audio, words=words, separate=separate, transcribe=not (abc or "").strip())
    text = (abc or "").strip() or found["abc"]
    try:
        score = scores.read(text)
    except ValueError as exc:
        raise gr.Error("That score could not be read: %s" % exc)
    try:
        changes = json.loads(edits) if (edits or "").strip() else {}
        chords = {int(k): [s for s in v if s] for k, v in (changes.get("chords") or {}).items()}
        edited = scores.edit(score, int(changes.get("transpose") or 0),
                             changes.get("bpm") or None, chords)
    except (ValueError, TypeError, KeyError) as exc:
        raise gr.Error(str(exc))
    if (abc or "").strip():
        try:
            given = json.loads(clock) if (clock or "").strip() else None
        except ValueError:
            given = None
        # The studio sends {"bars": [...], "beats": [...]}; a bare list is bar starts only.
        if isinstance(given, dict):
            beats = given.get("beats") if isinstance(given.get("beats"), list) else None
            given = given.get("bars")
        else:
            beats = None
        bars = given if isinstance(given, list) and len(given) == len(score.bars) + 1 else None
    else:
        bars, beats = found["clock"], found["beats"]
    # A new tempo moves every bar, so the original bar and beat lines no longer apply.
    if bars and edited.bpm != score.bpm:
        bars, beats = None, None
    if not bars:
        beats = None
    return found, edited, bars, beats, duration


def restage(audio, style, lyrics, voice, harmony, abc, clock, edits, seed, progress=gr.Progress()):
    """Play a stretch's tune in a new style: sung by YuE2, or on an instrument."""
    guard(audio, "a recording")
    if voice not in VOICES or harmony not in HARMONY:
        raise gr.Error("Choose sing or play, and keep or free harmony.")
    started = time.monotonic()
    try:
        progress(0.03, desc="Reading your music")
        sing = voice == "sing"
        own_words = (lyrics or "").strip()
        found, score, clock, beats, duration = _prepare(audio, abc, clock, edits, sing and not own_words,
                                                 "never", progress)
        if not sing:
            score = scores.vocal_to_ins(score)
        if harmony == "free" or not score.chords:
            score = scores.without_chords(score)
        cot = "full" if score.chords else "melody"
        text = scores.write(score)
        described = (style or "").strip().rstrip(".,") or "fresh modern arrangement"
        if sing:
            if own_words:
                words = scores.lyrics_by_notes(own_words, score)
            elif found and found["lines"]:
                words = scores.lyrics_by_notes("\n".join(found["lines"]), score)
            else:
                raise gr.Error("No words were found in this stretch. Type the lyrics to sing, "
                               "or choose Instrument to play the melody instead.")
            prompt = "%s, %d BPM" % (described, score.bpm)
        else:
            words = scores.lyric_tags(score)
            prompt = "Instrumental, %s, %d BPM, %s." % (described, score.bpm, ", ".join(INSTRUMENTAL))
        progress(0.4, desc="YuE2 is playing it")
        path, _, report = _render_score(text, prompt, words, cot, seed, clock=clock, span=duration,
                                        beats=beats, strip_voice=not sing)
        elapsed = round(time.monotonic() - started)
        status = "Finished in %dm %ds / %s / %d BPM" % (elapsed // 60, elapsed % 60,
                                                          scores.key_words(score.bars[0].key), score.bpm)
        status += (". Locked to your timing (%d of %d bars, %d beats inside them)."
                   % (report.get("matched", 0), report.get("bars", 0), report.get("beats", 0))
                   if report.get("locked") else ". Placed from the first bar.")
        return status, path, text, words, prompt, json.dumps(report)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def band_score(audio, style, separate, balance, split_parts, abc, clock, edits, seed,
               progress=gr.Progress()):
    """A band that plays the recording's own chords and form, under the real voice."""
    guard(audio, "a recording of your voice")
    if separate not in SEPARATE:
        raise gr.Error("Choose auto, always or never for separation.")
    started = time.monotonic()
    try:
        progress(0.03, desc="Reading your chords and bars")
        found, score, clock, beats, duration = _prepare(audio, abc, clock, edits, False, separate, progress)
        band = scores.without_vocal(score)
        cot = "full" if band.chords else "melody"
        if not band.chords and not band.ins:
            raise gr.Error("No chords were found in this stretch, so there is nothing for a band to "
                           "follow. Try a longer section, or ACE-Step's band.")
        text = scores.write(band)
        described = (style or "").strip().rstrip(".,") or "full band, drums, bass, keys and guitar"
        prompt = "Instrumental, %s, %d BPM, %s." % (described, band.bpm, ", ".join(INSTRUMENTAL))
        progress(0.4, desc="YuE2 is playing your chords")
        path, parts, report = _render_score(text, prompt, scores.lyric_tags(band), cot, seed, clock=clock,
                                            beats=beats,
                                            span=duration, strip_voice=True,
                                            split_parts=bool(split_parts))
        job = job_dir()
        vocal_path = found["vocal"] if found else audio
        vocal, sr = tools.load(vocal_path)
        backing, _ = tools.load(path)
        levels = {}
        mixed = tools.mix(tools.to_stereo(vocal, sr), backing, str(job / "kiku-mix.flac"),
                          instrumental_db=float(balance), report=levels)
        stem = tools.write(tools.to_stereo(vocal, sr), str(job / "your-vocal.flac"))
        clock_used = clock or sync.uniform_starts(len(score.bars), score.seconds(score.bars[0].length))
        at = scores.time_of(score, clock_used)
        # The score's tempo is a rounded average; the bar clock is the take's own.
        tempo = (score.bpm * score.seconds(score.length) / max(1e-6, clock[-1] - clock[0])
                 if clock else float(score.bpm))
        summary = {"tempo": round(tempo, 2),
                   "key": scores.key_words(score.bars[0].key), "duration": round(duration, 3),
                   "chords": [{"time": round(at(t), 3), "name": s} for t, s in score.chords],
                   "bars": clock_used, "separated": bool(found and found["separated"]),
                   "voice": bool(found["voiced"]) if found else True, "locked": report.get("locked", False),
                   "abc": text, "truncated": report.get("truncated", False), "seed": report["seed"], **levels}
        elapsed = round(time.monotonic() - started)
        status = "Finished in %dm %ds / %s BPM / %s" % (elapsed // 60, elapsed % 60, round(summary["tempo"]),
                                                       summary["key"])
        status += (". Locked to your timing (%d of %d bars, %d beats inside them)."
                   % (report.get("matched", 0), report.get("bars", 0), report.get("beats", 0))
                   if report.get("locked") else ". Placed from the first bar.")
        if summary["separated"]:
            status += " Your voice was lifted off the original backing."
        status += " Your recording is untouched in the mix."
        return (status, mixed, path, stem, prompt, found["background"] if found else None, *parts,
                json.dumps(summary))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def read_score(audio, words, progress=gr.Progress()):
    """The studio's score view: bars with times, chords and sections, plus lyrics."""
    guard(audio, "a recording")
    try:
        duration = _seconds(audio)
        if not 3 <= duration <= MAX_SCORE:
            raise gr.Error("Select from three seconds to %d minutes." % (MAX_SCORE // 60))
        progress(0.05, desc="Reading the melody, chords and bars")
        found = _read_take(audio, words=bool(words), separate="auto" if words else "never")
        score = scores.read(found["abc"])
        clock = found["clock"]
        bars = [{"start": clock[i], "end": clock[i + 1], "chords": scores.bar_chords(score, i),
                 "section": bar.sections[-1] if bar.sections else ""} for i, bar in enumerate(score.bars)]
        lyrics = scores.lyrics_by_notes("\n".join(found["lines"]), score) if found["lines"] else ""
        summary = {"bpm": score.bpm, "key": score.bars[0].key, "keyName": scores.key_words(score.bars[0].key),
                   "duration": round(duration, 3), "bars": bars, "clock": clock, "beats": found["beats"],
                   "lyrics": lyrics,
                   "notes": len(score.vocal), "fills": len(score.ins)}
        return "Read %d bars at %d BPM in %s." % (len(bars), score.bpm, scores.key_words(score.bars[0].key)), \
            found["abc"], json.dumps(summary)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def lyrics_of(audio, progress=gr.Progress()):
    """Just the words, tagged [verse], [chorus], [inst] and so on. No score is read for them."""
    guard(audio, "a recording")
    try:
        progress(0.05, desc="Listening to the words")
        found = _read_take(audio, words=True, separate="auto", transcribe=False, sections=True)
        if not found["lines"]:
            return "No words were found.", ""
        parts = sum(1 for line in found["lyrics"].splitlines() if line.startswith("["))
        return "Found %d lines in %d sections." % (len(found["lines"]), parts), found["lyrics"]
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------ song ideas (writer)

def write_time(*args, **kwargs):
    return 60 + cold("writer", 45)


@spaces.GPU(duration=write_time)
def _write(messages):
    model, tokenizer = lyricist()
    model.to("cuda")
    try:
        return writer.write(model, tokenizer, messages)
    finally:
        model.to("cpu")
        torch.cuda.empty_cache()


def _until_readable(messages, read):
    """The writer samples, so an unreadable reply gets one more try."""
    for attempt in range(2):
        try:
            return read(_write(messages))
        except ValueError as exc:
            if attempt:
                raise gr.Error(str(exc))


def sample(query, instrumental=False, language="", progress=gr.Progress()):
    """A style, lyrics, tempo and key from a one-line idea, for Simple mode."""
    query = (query or "").strip()
    if not query:
        raise gr.Error("Describe the song you want.")
    if len(query) > 512:
        raise gr.Error("Keep the idea under 500 characters.")
    instrumental = instrumental in (True, "true", "True")
    try:
        progress(0.2, desc="Writing the song idea")
        style, lyrics, meta = _until_readable(writer.song_messages(query, instrumental, language or ""),
                                              lambda reply: writer.read_song(reply, instrumental))
        return "Written", style, lyrics, json.dumps(meta)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


def enhance(audio, caption, lyrics, progress=gr.Progress()):
    """A full style prompt from a few words. With a recording, its measured tempo and
    key are written into the prompt and returned as `measured`."""
    caption = (caption or "").strip()
    if not caption:
        raise gr.Error("Describe the sound first, then enhance it.")
    if len(caption) > 2000 or len(lyrics or "") > 8000:
        raise gr.Error("That is longer than the engine accepts. Shorten it and try again.")
    try:
        measured = None
        if audio:
            progress(0.1, desc="Listening to the selection")
            tempo, key, _, _ = tools.analyse(audio)
            if tempo:
                measured = {"bpm": int(tempo), **({"keyscale": key} if key else {})}
        progress(0.3, desc="Writing the style")
        style, meta = _until_readable(writer.enhance_messages(caption, lyrics or "", measured), writer.read_style)
        if measured:
            meta = {**meta, **measured, "measured": True}
        return "Enhanced", style, json.dumps(meta)
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ----------------------------------------------------------------------- app

with gr.Blocks(title="Kiku Engine", delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Kiku Engine\nThe single ZeroGPU API behind Kiku AI: transcription, "
                "songs with vocals, backing tracks under a real voice, remixing and stems.")

    with gr.Tab("Sing with a band"):
        gr.Markdown("Kiku measures the tempo and key of your recording, writes a backing track "
                    "to match, and mixes it **under your original voice** — the vocal in the "
                    "result is your own recording.")
        a_audio = gr.Audio(label="Your recording", type="filepath", sources=["upload", "microphone"])
        a_style = gr.Textbox(label="Band style", lines=2,
                             placeholder="acoustic folk, fingerpicked guitar, upright bass")
        a_sep = gr.Radio(SEPARATE, value="auto", label="Lift the voice off any backing music")
        a_balance = gr.Slider(-12, 6, value=-3, step=0.5, label="Band level against your voice (dB)")
        a_strength = gr.Slider(0.2, 0.8, value=0.45, step=0.05,
                               label="How tightly the band follows your beat and chords")
        a_split = gr.Checkbox(value=True, label="Also split the band into drums, bass and the rest")
        a_bpm = gr.Number(value=0, label="Tempo (0 to detect)")
        a_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        a_seed = gr.Number(value=-1, label="Seed", precision=0)
        a_run = gr.Button("Build my band", variant="primary")
        a_status = gr.Textbox(label="Status")
        a_mix = gr.Audio(label="Your song", type="filepath")
        a_backing = gr.Audio(label="Backing track only", type="filepath")
        a_stem = gr.Audio(label="Your vocal only", type="filepath")
        a_prompt = gr.Textbox(label="Prompt used")
        a_original = gr.Audio(label="Original backing (when one was found)", type="filepath")
        with gr.Row():
            a_drums = gr.Audio(label="Drums", type="filepath")
            a_bass = gr.Audio(label="Bass", type="filepath")
            a_other = gr.Audio(label="Everything else", type="filepath")
        a_analysis = gr.Code(label="What was measured", language="json")
        a_run.click(accompany, [a_audio, a_style, a_sep, a_balance, a_strength, a_split, a_bpm,
                                a_steps, a_seed],
                    [a_status, a_mix, a_backing, a_stem, a_prompt, a_original, a_drums, a_bass,
                     a_other, a_analysis], api_name="accompany", concurrency_limit=1)

    with gr.Tab("Add a part"):
        n_ref = gr.Audio(label="Follow this mix (optional)", type="filepath", sources=["upload"])
        n_inst = gr.Radio(list(INSTRUMENTS), value="drums", label="Instrument")
        n_style = gr.Textbox(label="Style", lines=2, placeholder="warm, vintage, laid back")
        with gr.Row():
            n_bpm = gr.Number(value=0, label="Tempo (0 to detect)")
            n_key = gr.Textbox(label="Key", placeholder="A minor")
            n_duration = gr.Slider(5, 240, value=30, step=5, label="Length without a mix (s)")
        n_strength = gr.Slider(0.2, 0.8, value=0.45, step=0.05, label="How tightly to follow")
        n_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        n_seed = gr.Number(value=-1, label="Seed", precision=0)
        n_run = gr.Button("Write the part", variant="primary")
        n_status = gr.Textbox(label="Status")
        n_out = gr.Audio(label="Part", type="filepath")
        n_prompt = gr.Textbox(label="Prompt used")
        n_analysis = gr.Code(label="What was measured", language="json")
        n_run.click(part, [n_ref, n_inst, n_style, n_bpm, n_key, n_duration, n_strength, n_steps,
                           n_seed], [n_status, n_out, n_prompt, n_analysis],
                    api_name="part", concurrency_limit=1)

    with gr.Tab("Sheet music"):
        t_audio = gr.Audio(label="Audio", type="filepath", sources=["upload"])
        t_start = gr.Number(value=0, label="Start (seconds)", minimum=0)
        t_duration = gr.Number(value=30, label="Duration (seconds)", minimum=5, maximum=600)
        t_melody = gr.Checkbox(value=False, label="Melody only")
        t_piano = gr.Checkbox(value=True, label="Render piano preview")
        t_run = gr.Button("Transcribe", variant="primary")
        t_status = gr.Textbox(label="Status")
        # Kept so the endpoint's outputs keep their positions; pages are no
        # longer rendered, the PDF holds them.
        t_gallery = gr.Gallery(label="Score pages", visible=False)
        t_pdf = gr.File(label="PDF")
        t_preview = gr.Audio(label="Piano preview")
        t_downloads = gr.File(label="Downloads", file_count="multiple")
        t_abc = gr.Code(label="ABC notation", language=None)
        t_timing = gr.JSON(label="Bar timing")
        t_run.click(transcribe, [t_audio, t_start, t_duration, t_melody, t_piano],
                    [t_status, t_gallery, t_pdf, t_preview, t_downloads, t_abc, t_timing],
                    api_name="transcribe", concurrency_limit=1)

    with gr.Tab("Write a song"):
        s_style = gr.Textbox(label="Style", lines=2, placeholder="dream pop, female vocal, 92 BPM")
        s_lyrics = gr.Textbox(label="Lyrics", lines=10, placeholder="[verse]\n...\n\n[chorus]\n...")
        s_cot = gr.Radio(COT, value="full", label="Planning")
        s_abc = gr.Code(label="ABC score (optional)", language=None)
        s_seed = gr.Number(value=-1, label="Seed", precision=0)
        s_run = gr.Button("Generate song", variant="primary")
        s_status = gr.Textbox(label="Status")
        s_audio = gr.Audio(label="Song", type="filepath")
        s_artifacts = gr.File(label="Artifacts")
        s_plan = gr.Code(label="Planned ABC score", language=None)
        s_used = gr.Number(label="Seed used", precision=0)
        s_report = gr.Code(label="Generation report", language="json")
        song_out = [s_status, s_audio, s_artifacts, s_plan, s_used, s_report]
        s_run.click(song, [s_style, s_lyrics, s_cot, s_seed, s_abc], song_out,
                    api_name="song", concurrency_limit=1)

    with gr.Tab("Cover a recording"):
        c_style = gr.Textbox(label="New style", lines=2, placeholder="jazz-funk, Rhodes piano")
        c_lyrics = gr.Textbox(label="Lyrics", lines=10)
        c_abc = gr.Code(label="Melody ABC score", language=None)
        c_seed = gr.Number(value=-1, label="Seed", precision=0)
        c_run = gr.Button("Generate cover", variant="primary")
        c_status = gr.Textbox(label="Status")
        c_audio = gr.Audio(label="Cover", type="filepath")
        c_artifacts = gr.File(label="Artifacts")
        c_plan = gr.Code(label="Planned ABC score", language=None)
        c_used = gr.Number(label="Seed used", precision=0)
        c_report = gr.Code(label="Generation report", language="json")
        c_run.click(cover, [c_style, c_lyrics, c_abc, c_seed],
                    [c_status, c_audio, c_artifacts, c_plan, c_used, c_report],
                    api_name="cover", concurrency_limit=1)

    with gr.Tab("Instrumental"):
        g_prompt = gr.Textbox(label="Style", lines=2, placeholder="lo-fi hip hop, 82 bpm")
        g_lyrics = gr.Textbox(label="Lyrics", lines=8, placeholder="Leave empty for an instrumental")
        g_duration = gr.Slider(10, 240, value=60, step=5, label="Length (seconds)")
        g_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        g_guidance = gr.Slider(3, 25, value=15, step=0.5, label="Guidance")
        g_seed = gr.Number(value=-1, label="Seed", precision=0)
        g_run = gr.Button("Generate", variant="primary")
        g_status = gr.Textbox(label="Status")
        g_audio = gr.Audio(label="Result", type="filepath")
        g_run.click(instrumental, [g_prompt, g_lyrics, g_duration, g_steps, g_guidance, g_seed],
                    [g_status, g_audio], api_name="instrumental", concurrency_limit=1)

    with gr.Tab("Plan and play with YuE2"):
        q_style = gr.Textbox(label="Musical style", lines=2)
        q_lyrics = gr.Textbox(label="Lyrics with sections", lines=6)
        q_seed = gr.Number(value=-1, label="Seed", precision=0)
        q_instrumental = gr.Checkbox(value=False, label="Instrumental draft")
        q_plan = gr.Button("Plan score")
        q_status = gr.Textbox(label="Status")
        q_abc = gr.Code(label="Editable native ABC", language=None)
        q_report = gr.Code(label="Generation report", language="json")
        q_plan.click(plan_score, [q_style, q_lyrics, q_seed, q_instrumental],
                     [q_status, q_abc, q_report], api_name="plan_score", concurrency_limit=1)
        q_duration = gr.Number(value=30, label="Target seconds when planning from scratch")
        q_play = gr.Button("Render instrumental")
        q_audio = gr.Audio(label="Instrumental", type="filepath")
        q_used = gr.Number(label="Seed used", precision=0)
        q_play.click(score_instrumental, [q_style, q_abc, q_duration, q_seed],
                     [q_status, q_audio, q_abc, q_used, q_report], api_name="score_instrumental", concurrency_limit=1)

    with gr.Tab("Reshape"):
        with gr.Tab("Remix"):
            r_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            r_prompt = gr.Textbox(label="Target style", lines=2)
            r_lyrics = gr.Textbox(label="Lyrics", lines=6)
            r_strength = gr.Slider(0.1, 0.9, value=0.5, step=0.05, label="How far to move")
            r_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
            r_seed = gr.Number(value=-1, label="Seed", precision=0)
            r_run = gr.Button("Remix", variant="primary")
            r_status, r_out = gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")
            r_run.click(remix, [r_audio, r_prompt, r_lyrics, r_strength, r_steps, r_seed],
                        [r_status, r_out], api_name="remix", concurrency_limit=1)
        with gr.Tab("Rewrite a section"):
            p_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            p_prompt = gr.Textbox(label="Style", lines=2)
            p_lyrics = gr.Textbox(label="Lyrics", lines=6)
            with gr.Row():
                p_start = gr.Number(value=0, label="Start (seconds)")
                p_end = gr.Number(value=15, label="End (seconds)")
            p_var = gr.Slider(0.1, 1.0, value=0.5, step=0.05, label="How much to change")
            p_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
            p_seed = gr.Number(value=-1, label="Seed", precision=0)
            p_run = gr.Button("Rewrite section", variant="primary")
            p_status, p_out = gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")
            p_run.click(repaint, [p_audio, p_prompt, p_lyrics, p_start, p_end, p_var, p_steps, p_seed],
                        [p_status, p_out], api_name="repaint", concurrency_limit=1)
        with gr.Tab("Extend"):
            e_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            e_prompt = gr.Textbox(label="Style", lines=2)
            e_lyrics = gr.Textbox(label="Lyrics", lines=6)
            e_seconds = gr.Slider(5, 120, value=30, step=5, label="Seconds to add")
            e_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
            e_seed = gr.Number(value=-1, label="Seed", precision=0)
            e_run = gr.Button("Extend", variant="primary")
            e_status, e_out = gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")
            e_run.click(extend, [e_audio, e_prompt, e_lyrics, e_seconds, e_steps, e_seed],
                        [e_status, e_out], api_name="extend", concurrency_limit=1)
        with gr.Tab("Edit"):
            d_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            d_prompt = gr.Textbox(label="Original style", lines=2)
            d_lyrics = gr.Textbox(label="Original lyrics", lines=6)
            d_new_prompt = gr.Textbox(label="New style", lines=2)
            d_new_lyrics = gr.Textbox(label="New lyrics", lines=6)
            d_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
            d_seed = gr.Number(value=-1, label="Seed", precision=0)
            d_run = gr.Button("Apply edit", variant="primary")
            d_status, d_out = gr.Textbox(label="Status"), gr.Audio(label="Result", type="filepath")
            d_run.click(edit, [d_audio, d_prompt, d_lyrics, d_new_prompt, d_new_lyrics, d_steps, d_seed],
                        [d_status, d_out], api_name="edit", concurrency_limit=1)
        with gr.Tab("Split stems"):
            m_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            m_run = gr.Button("Separate", variant="primary")
            m_status = gr.Textbox(label="Status")
            m_vocals = gr.Audio(label="Vocals", type="filepath")
            m_inst = gr.Audio(label="Instrumental", type="filepath")
            m_run.click(stems, [m_audio], [m_status, m_vocals, m_inst],
                        api_name="stems", concurrency_limit=1)
        with gr.Tab("Four stems"):
            q_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
            q_run = gr.Button("Separate", variant="primary")
            q_status = gr.Textbox(label="Status")
            with gr.Row():
                q_vocals = gr.Audio(label="Vocals", type="filepath")
                q_drums = gr.Audio(label="Drums", type="filepath")
                q_bass = gr.Audio(label="Bass", type="filepath")
                q_other = gr.Audio(label="Everything else", type="filepath")
            q_run.click(split, [q_audio], [q_status, q_vocals, q_drums, q_bass, q_other],
                        api_name="split", concurrency_limit=1)

    with gr.Tab("Play a score"):
        gr.Markdown("SheetSage2 reads the melody, chords and bars of a recording; YuE2 plays "
                    "them in a new style, locked back onto the recording's own bar lines.")
        k_audio = gr.Audio(label="Recording", type="filepath", sources=["upload", "microphone"])
        k_style = gr.Textbox(label="Style", lines=2, placeholder="acoustic ballad, piano and strings")
        k_lyrics = gr.Textbox(label="Lyrics (empty: take them from the recording)", lines=6)
        with gr.Row():
            k_voice = gr.Radio(VOICES, value="sing", label="Sing it, or play the melody")
            k_harmony = gr.Radio(HARMONY, value="keep", label="Keep the chords, or let them change")
        k_abc = gr.Code(label="Score to play instead of reading one (optional)", language=None)
        k_clock = gr.Textbox(label="Bar start times for that score, JSON (optional)")
        k_edits = gr.Textbox(label="Edits, JSON: transpose, bpm, chords by bar (optional)")
        k_seed = gr.Number(value=-1, label="Seed", precision=0)
        with gr.Row():
            k_read = gr.Button("Read the score")
            k_words = gr.Button("Read the words")
            k_run = gr.Button("Play it", variant="primary")
            k_band = gr.Button("Band behind the voice")
        k_status = gr.Textbox(label="Status")
        k_out = gr.Audio(label="Result", type="filepath")
        k_used = gr.Code(label="Score played", language=None)
        k_words_used = gr.Textbox(label="Lyrics sung", lines=6)
        k_prompt = gr.Textbox(label="Style sent")
        k_summary = gr.Code(label="Bars, chords and sections", language="json")
        k_report = gr.Code(label="Generation report", language="json")
        k_include = gr.Checkbox(value=True, label="Also read the words", visible=False)
        k_read.click(read_score, [k_audio, k_include], [k_status, k_used, k_summary],
                     api_name="score", concurrency_limit=1)
        k_words.click(lyrics_of, [k_audio], [k_status, k_words_used], api_name="lyrics",
                      concurrency_limit=1)
        k_run.click(restage, [k_audio, k_style, k_lyrics, k_voice, k_harmony, k_abc, k_clock, k_edits,
                              k_seed], [k_status, k_out, k_used, k_words_used, k_prompt, k_report],
                    api_name="restage", concurrency_limit=1)
        b_sep = gr.Radio(SEPARATE, value="auto", visible=False)
        b_balance = gr.Number(value=-3, visible=False)
        b_split = gr.Checkbox(value=True, visible=False)
        b_mix, b_stem, b_original = (gr.Audio(visible=False, type="filepath") for _ in range(3))
        b_parts = [gr.Audio(visible=False, type="filepath") for _ in range(3)]
        k_band.click(band_score, [k_audio, k_style, b_sep, b_balance, b_split, k_abc, k_clock, k_edits,
                                  k_seed],
                     [k_status, b_mix, k_out, b_stem, k_prompt, b_original, *b_parts, k_summary],
                     api_name="band_score", concurrency_limit=1)

    with gr.Tab("Write a song idea"):
        gr.Markdown("A small open language model ([Qwen3-4B-Instruct](https://huggingface.co/"
                    "Qwen/Qwen3-4B-Instruct-2507), Apache 2.0) writes a style and lyrics for YuE2.")
        w_idea = gr.Textbox(label="Idea", placeholder="a bittersweet summer song about leaving home")
        w_inst = gr.Checkbox(label="Instrumental")
        w_lang = gr.Textbox(label="Language (optional)", placeholder="English")
        w_run = gr.Button("Write it", variant="primary")
        w_status = gr.Textbox(label="Status")
        w_style = gr.Textbox(label="Style")
        w_lyrics = gr.Textbox(label="Lyrics", lines=12)
        w_meta = gr.Code(label="Tempo and key", language="json")
        w_run.click(sample, [w_idea, w_inst, w_lang], [w_status, w_style, w_lyrics, w_meta],
                    api_name="sample", concurrency_limit=2)
        e_audio = gr.Audio(label="Recording to measure (optional)", type="filepath", sources=["upload"])
        e_caption = gr.Textbox(label="A few words about the sound", placeholder="warm lofi, rainy")
        e_lyrics = gr.Textbox(label="Lyrics (when it is sung)", lines=3)
        e_run = gr.Button("Enhance the style")
        e_status, e_style = gr.Textbox(label="Status"), gr.Textbox(label="Style")
        e_meta = gr.Code(label="Tempo and key", language="json")
        e_run.click(enhance, [e_audio, e_caption, e_lyrics], [e_status, e_style, e_meta],
                    api_name="enhance", concurrency_limit=2)

    gr.Markdown("Powered by [SheetSage2](https://huggingface.co/m-a-p/SheetSage2) and "
                "[YuE2](https://huggingface.co/m-a-p/YuE2-3B) (both CC BY-NC 4.0, "
                "non-commercial), [ACE-Step](https://github.com/ace-step/ACE-Step) (Apache 2.0), "
                "[Qwen3](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) (Apache 2.0) "
                "and [Demucs](https://github.com/adefossez/demucs) (MIT). "
                "Temporary files expire after 24 hours.")


def health():
    return {"status": "ready", "loaded": sorted(ENGINES),
            "models": {"transcription": SHEETSAGE_ID, "songs": YUE2_ID,
                       "instrumental": "ACE-Step-v1-3.5B", "separator": "htdemucs",
                       "lyrics": LYRICS_ID, "writer": writer.MODEL}}


def oauth_metadata():
    return {
        "client_id": "https://reubencf-kiku-engine.hf.space/.well-known/oauth-cimd",
        "client_name": "Kiku AI",
        "client_uri": "https://huggingface.co/spaces/Reubencf/Kiku-Engine",
        "redirect_uris": [
            "http://localhost/auth/callback", "http://127.0.0.1/auth/callback",
            "https://reubencf-kiku-ai.hf.space/auth/callback",
            "https://reubencf-score-studio.hf.space/auth/callback",
        ],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "scope": "openid profile",
    }


if __name__ == "__main__":
    app, _, _ = demo.queue(max_size=5).launch(
        server_name="0.0.0.0", server_port=7860, max_file_size="100mb",
        show_error=False, prevent_thread_lock=True, ssr_mode=False)
    app.add_api_route("/.well-known/oauth-cimd", oauth_metadata, methods=["GET"])
    app.add_api_route("/health", health, methods=["GET"])
    demo.block_thread()
