"""The ZeroGPU instrumental and remix API for Kiku AI, powered by ACE-Step."""
import logging
from pathlib import Path
import shutil
import tempfile
import time

import gradio as gr
import spaces
import torch

# Must run before acestep is imported: torchaudio 2.9+ needs TorchCodec for file
# I/O, which is not installed and cannot be pinned safely against an unpinned torch.
import torchaudio_compat
torchaudio_compat.apply()

from acestep.pipeline_ace_step import ACEStepPipeline
from demucs.pretrained import get_model

import audio_tools as tools

ROOT = Path(tempfile.gettempdir()) / "kiku-acestep"
ROOT.mkdir(exist_ok=True)
MAX_INPUT = 360
logging.basicConfig(level=logging.INFO)

# ZeroGPU emulates CUDA during startup, so both models are placed now; the real
# GPU is attached only while a @spaces.GPU function runs.
PIPE = ACEStepPipeline(dtype="bfloat16")
PIPE.load_checkpoint()
DEMUCS = get_model("htdemucs").to("cuda").eval()


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


def render(job, **kwargs):
    """Call the pipeline and return the first rendered audio file."""
    kwargs.setdefault("format", "wav")
    kwargs.setdefault("infer_step", 60)
    kwargs.setdefault("guidance_scale", 15.0)
    result = PIPE(save_path=str(job), **kwargs)
    audio = [str(p) for p in result[:-1] if p and str(p).endswith((".wav", ".flac", ".mp3", ".ogg"))]
    if not audio:
        raise RuntimeError("The model returned no audio.")
    return audio[0]


def guard(audio, label="a recording"):
    if not audio:
        raise gr.Error("Upload " + label + " first.")


def failed(exc):
    logging.exception("Request failed")
    if isinstance(exc, torch.cuda.OutOfMemoryError):
        return gr.Error("That was too long to process at once. Try a shorter section.")
    return gr.Error("The request failed. Try a shorter clip. Details are in the Space logs.")


def steps_seconds(duration, steps):
    # Diffusion cost scales with steps and length; the floor covers model warm-up.
    return max(45, min(300, int(float(duration or 60) * float(steps or 60) * 0.012) + 40))


# ---------------------------------------------------------------- generation

def generate_time(prompt, lyrics, duration, steps, guidance, seed, progress=None, **kwargs):
    return steps_seconds(duration, steps)


@spaces.GPU(duration=generate_time)
def generate(prompt, lyrics, duration, steps, guidance, seed, progress=gr.Progress()):
    if not (prompt or "").strip():
        raise gr.Error("Describe the music you want, for example 'lo-fi hip hop, warm keys, 82 bpm'.")
    if not 10 <= float(duration) <= 240:
        raise gr.Error("Choose a length from 10 to 240 seconds.")
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.1, desc="Composing")
        # An empty lyric box means the user wants a backing track, which the
        # model only produces when it is told so explicitly.
        path = render(job, prompt=prompt.strip(), lyrics=(lyrics or "").strip() or "[inst]",
                      audio_duration=float(duration), infer_step=int(steps),
                      guidance_scale=float(guidance), manual_seeds=seed_list(seed))
        elapsed = round(time.monotonic() - started)
        return "Finished in {}m {}s".format(elapsed // 60, elapsed % 60), path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------- keep the real vocal

def accompany_time(audio, style, separate_first, balance, align, steps, seed, progress=None, **kwargs):
    return max(60, min(320, int(steps or 60) * 2 + (60 if separate_first else 0) + 60))


@spaces.GPU(duration=accompany_time)
def accompany(audio, style, separate_first, balance, align, steps, seed, progress=gr.Progress()):
    """Build a backing track under a real recording, keeping the original voice."""
    guard(audio, "a recording of your voice")
    job = job_dir()
    started = time.monotonic()
    try:
        progress(0.05, desc="Listening to your recording")
        tempo, key, duration, first_beat = tools.analyse(audio)
        if duration < 3:
            raise gr.Error("That recording is too short. Record at least a few seconds.")
        if duration > MAX_INPUT:
            raise gr.Error("Recordings are limited to {} minutes.".format(MAX_INPUT // 60))
        vocal, sr = tools.load(audio)
        if separate_first:
            progress(0.2, desc="Separating your voice from the backing")
            vocal, _, sr = tools.separate(audio, DEMUCS, want="vocals")
        # The tempo and key go into the prompt because that is the only way the
        # model can be steered to sit under a performance it never hears.
        details = [style.strip()] if (style or "").strip() else ["warm modern pop production"]
        if tempo:
            details.append("{} bpm".format(tempo))
        if key:
            details.append("key of " + key)
        details.append("instrumental")
        prompt = ", ".join(details)
        progress(0.35, desc="Writing the backing track")
        backing = render(job, prompt=prompt, lyrics="[inst]", audio_duration=float(duration),
                         infer_step=int(steps), manual_seeds=seed_list(seed))
        progress(0.85, desc="Mixing your voice over the band")
        instrumental, inst_sr = tools.load(backing)
        instrumental = tools.to_stereo(instrumental, inst_sr)
        vocal_stereo = tools.to_stereo(vocal, sr)
        mixed = tools.mix(vocal_stereo, instrumental, str(job / "kiku-mix.wav"),
                          instrumental_db=float(balance),
                          offset=float(first_beat) if align and first_beat else 0.0)
        stem = tools.write(vocal_stereo, str(job / "your-vocal.wav"))
        elapsed = round(time.monotonic() - started)
        summary = "Finished in {}m {}s / detected {} BPM".format(
            elapsed // 60, elapsed % 60, tempo or "no steady")
        if key:
            summary += " / " + key
        summary += ". Your original voice is untouched in the mix."
        return summary, mixed, backing, stem, prompt
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ------------------------------------------------------------------ reshaping

def audio_time(*args, **kwargs):
    return 240


@spaces.GPU(duration=audio_time)
def remix(audio, prompt, lyrics, strength, steps, seed, progress=gr.Progress()):
    guard(audio)
    if not (prompt or "").strip():
        raise gr.Error("Describe the style you want to move towards.")
    job = job_dir()
    try:
        progress(0.1, desc="Remixing")
        _, _, duration, _ = tools.analyse(audio)
        path = render(job, prompt=prompt.strip(), lyrics=(lyrics or "").strip() or "[inst]",
                      audio_duration=float(min(duration, 240)), audio2audio_enable=True,
                      ref_audio_input=audio, ref_audio_strength=float(strength),
                      infer_step=int(steps), manual_seeds=seed_list(seed))
        return "Remix ready.", path
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
        progress(0.1, desc="Rewriting that section")
        _, _, duration, _ = tools.analyse(audio)
        path = render(job, task="repaint", src_audio_path=audio, prompt=(prompt or "").strip(),
                      lyrics=(lyrics or "").strip() or "[inst]", audio_duration=float(duration),
                      repaint_start=int(start), repaint_end=int(end),
                      retake_variance=float(variance), infer_step=int(steps),
                      retake_seeds=seed_list(seed), manual_seeds=seed_list(seed))
        return "Rewrote {}s to {}s.".format(int(start), int(end)), path
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
        # Extension is repainting past the end, so the target length carries the
        # extra seconds while the existing audio stays as the source.
        path = render(job, task="extend", src_audio_path=audio, prompt=(prompt or "").strip(),
                      lyrics=(lyrics or "").strip() or "[inst]",
                      audio_duration=float(duration + float(seconds)),
                      repaint_start=int(duration), repaint_end=int(duration + float(seconds)),
                      infer_step=int(steps), retake_seeds=seed_list(seed),
                      manual_seeds=seed_list(seed))
        return "Added {}s.".format(int(seconds)), path
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
        path = render(job, task="edit", src_audio_path=audio, prompt=(prompt or "").strip(),
                      lyrics=(lyrics or "").strip() or "[inst]",
                      edit_target_prompt=(new_prompt or prompt or "").strip(),
                      edit_target_lyrics=(new_lyrics or lyrics or "").strip() or "[inst]",
                      audio_duration=float(duration), infer_step=int(steps),
                      manual_seeds=seed_list(seed))
        return "Edit applied.", path
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


@spaces.GPU(duration=180)
def stems(audio, progress=gr.Progress()):
    guard(audio)
    job = job_dir()
    try:
        progress(0.2, desc="Separating stems")
        vocal, rest, sr = tools.separate(audio, DEMUCS, want="vocals")
        return ("Stems ready.",
                tools.write(tools.to_stereo(vocal, sr), str(job / "vocals.wav")),
                tools.write(tools.to_stereo(rest, sr), str(job / "instrumental.wav")))
    except gr.Error:
        raise
    except Exception as exc:
        raise failed(exc)


# ----------------------------------------------------------------------- app

with gr.Blocks(title="Kiku ACE-Step", delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Kiku ACE-Step\nThe ZeroGPU instrumental, remix and stem engine for Kiku AI.")

    with gr.Tab("Sing with a band"):
        gr.Markdown("Record or upload your singing. Kiku detects the tempo and key, writes a "
                    "backing track to match, and mixes it **under your original voice** — the "
                    "vocal you hear in the result is your own recording, not a synthetic one.")
        a_audio = gr.Audio(label="Your recording", type="filepath", sources=["upload", "microphone"])
        a_style = gr.Textbox(label="Band style", lines=2,
                             placeholder="acoustic folk, fingerpicked guitar, brushed drums, upright bass")
        with gr.Row():
            a_sep = gr.Checkbox(value=False, label="Recording already has backing music",
                                info="Isolates your voice first with Demucs")
            a_align = gr.Checkbox(value=True, label="Align band to my first beat")
        a_balance = gr.Slider(-12, 6, value=-3, step=0.5, label="Band level against your voice (dB)")
        a_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        a_seed = gr.Number(value=-1, label="Seed", precision=0)
        a_run = gr.Button("Build my band", variant="primary")
        a_status = gr.Textbox(label="Status")
        a_mix = gr.Audio(label="Your song (your voice + generated band)", type="filepath")
        a_backing = gr.Audio(label="Backing track only", type="filepath")
        a_stem = gr.Audio(label="Your vocal only", type="filepath")
        a_prompt = gr.Textbox(label="Prompt used")
        a_run.click(accompany, [a_audio, a_style, a_sep, a_balance, a_align, a_steps, a_seed],
                    [a_status, a_mix, a_backing, a_stem, a_prompt],
                    api_name="accompany", concurrency_limit=1)

    with gr.Tab("Generate"):
        g_prompt = gr.Textbox(label="Style", lines=2,
                              placeholder="lo-fi hip hop, warm rhodes, vinyl crackle, 82 bpm")
        g_lyrics = gr.Textbox(label="Lyrics", lines=8,
                              placeholder="Leave empty for an instrumental")
        g_duration = gr.Slider(10, 240, value=60, step=5, label="Length (seconds)")
        g_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        g_guidance = gr.Slider(3, 25, value=15, step=0.5, label="Guidance")
        g_seed = gr.Number(value=-1, label="Seed", precision=0)
        g_run = gr.Button("Generate", variant="primary")
        g_status = gr.Textbox(label="Status")
        g_audio = gr.Audio(label="Result", type="filepath")
        g_run.click(generate, [g_prompt, g_lyrics, g_duration, g_steps, g_guidance, g_seed],
                    [g_status, g_audio], api_name="generate", concurrency_limit=1)

    with gr.Tab("Remix"):
        gr.Markdown("Moves a track towards a new style. This regenerates the audio, so any "
                    "singing on it is replaced — use **Sing with a band** to keep a real voice.")
        r_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
        r_prompt = gr.Textbox(label="Target style", lines=2)
        r_lyrics = gr.Textbox(label="Lyrics", lines=6)
        r_strength = gr.Slider(0.1, 0.9, value=0.5, step=0.05, label="How far to move",
                               info="Lower stays closer to the original")
        r_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        r_seed = gr.Number(value=-1, label="Seed", precision=0)
        r_run = gr.Button("Remix", variant="primary")
        r_status = gr.Textbox(label="Status")
        r_out = gr.Audio(label="Result", type="filepath")
        r_run.click(remix, [r_audio, r_prompt, r_lyrics, r_strength, r_steps, r_seed],
                    [r_status, r_out], api_name="remix", concurrency_limit=1)

    with gr.Tab("Rewrite a section"):
        p_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
        p_prompt = gr.Textbox(label="Style", lines=2)
        p_lyrics = gr.Textbox(label="Lyrics", lines=6)
        with gr.Row():
            p_start = gr.Number(value=0, label="Start (seconds)", precision=0)
            p_end = gr.Number(value=15, label="End (seconds)", precision=0)
        p_variance = gr.Slider(0.1, 1.0, value=0.5, step=0.05, label="How much to change")
        p_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        p_seed = gr.Number(value=-1, label="Seed", precision=0)
        p_run = gr.Button("Rewrite section", variant="primary")
        p_status = gr.Textbox(label="Status")
        p_out = gr.Audio(label="Result", type="filepath")
        p_run.click(repaint, [p_audio, p_prompt, p_lyrics, p_start, p_end, p_variance, p_steps, p_seed],
                    [p_status, p_out], api_name="repaint", concurrency_limit=1)

    with gr.Tab("Extend"):
        e_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
        e_prompt = gr.Textbox(label="Style", lines=2)
        e_lyrics = gr.Textbox(label="Lyrics", lines=6)
        e_seconds = gr.Slider(5, 120, value=30, step=5, label="Seconds to add")
        e_steps = gr.Slider(20, 120, value=60, step=5, label="Quality steps")
        e_seed = gr.Number(value=-1, label="Seed", precision=0)
        e_run = gr.Button("Extend", variant="primary")
        e_status = gr.Textbox(label="Status")
        e_out = gr.Audio(label="Result", type="filepath")
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
        d_status = gr.Textbox(label="Status")
        d_out = gr.Audio(label="Result", type="filepath")
        d_run.click(edit, [d_audio, d_prompt, d_lyrics, d_new_prompt, d_new_lyrics, d_steps, d_seed],
                    [d_status, d_out], api_name="edit", concurrency_limit=1)

    with gr.Tab("Split stems"):
        s_audio = gr.Audio(label="Source", type="filepath", sources=["upload"])
        s_run = gr.Button("Separate", variant="primary")
        s_status = gr.Textbox(label="Status")
        s_vocals = gr.Audio(label="Vocals", type="filepath")
        s_inst = gr.Audio(label="Instrumental", type="filepath")
        s_run.click(stems, [s_audio], [s_status, s_vocals, s_inst],
                    api_name="stems", concurrency_limit=1)

    gr.Markdown("Powered by [ACE-Step](https://github.com/ace-step/ACE-Step) (Apache 2.0) and "
                "[Demucs](https://github.com/adefossez/demucs) (MIT). "
                "Temporary files expire after 24 hours.")


def health():
    return {"status": "ready", "model": "ACE-Step-v1-3.5B", "separator": "htdemucs"}


if __name__ == "__main__":
    app, _, _ = demo.queue(max_size=5).launch(
        server_name="0.0.0.0", server_port=7860, max_file_size="100mb",
        show_error=False, prevent_thread_lock=True, ssr_mode=False)
    app.add_api_route("/health", health, methods=["GET"])
    demo.block_thread()
