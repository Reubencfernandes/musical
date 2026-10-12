"""The ZeroGPU song-generation API for Kiku AI, powered by YuE2."""
import logging
import os
from pathlib import Path
import shutil
import tempfile
import time

import gradio as gr
import spaces
import torch
from huggingface_hub import snapshot_download
from yue2 import YuE2Pipeline

MODEL_ID = "m-a-p/YuE2-3B"
VAE_ID = "m-a-p/YuE2-Vae"
ROOT = Path(tempfile.gettempdir()) / "kiku-yue2"
ROOT.mkdir(exist_ok=True)
COT = ["full", "melody", "off"]
logging.basicConfig(level=logging.INFO)

# The ZeroGPU guide prefers placing weights during startup, but YuE2 calls
# torch.cuda.set_per_process_memory_fraction while constructing, which reaches
# low-level CUDA init and is refused outside a @spaces.GPU function. So the
# pipeline is built on the first request instead. Downloading is not a CUDA
# operation, so the weights are still fetched now and no request pays for it.
for repo in (MODEL_ID, VAE_ID):
    try:
        snapshot_download(repo)
    except Exception:
        logging.exception("Could not pre-fetch %s; it downloads on first use", repo)

PIPE = None


def pipeline():
    """Build the pipeline once, inside the GPU context that CUDA init requires."""
    global PIPE
    if PIPE is None:
        PIPE = YuE2Pipeline.from_pretrained(MODEL_ID, device="cuda")
    return PIPE


def sweep():
    """Drop abandoned job directories from earlier runs after one day."""
    cutoff = time.time() - 86400
    for old in ROOT.glob("song-*"):
        if old.is_dir() and not old.is_symlink() and old.stat().st_mtime < cutoff:
            shutil.rmtree(old, ignore_errors=True)


def gpu_seconds(style, lyrics, cot, seed, abc, progress=None, **kwargs):
    # Song length follows the lyrics, so reserve time from their size rather
    # than a fixed ceiling; short drafts then keep their place in the queue.
    budget = max(90, min(420, 90 + int(len(lyrics or "") * 0.35)))
    # The first request also loads 7 GB of weights onto the GPU.
    return budget + (180 if PIPE is None else 0)


def run(style, lyrics, cot, seed, abc, progress):
    """Shared generation body for the song and cover endpoints."""
    if not (style or "").strip():
        raise gr.Error("Describe the style you want, for example 'dream pop, female vocal, warm synths'.")
    if not (lyrics or "").strip():
        raise gr.Error("Add lyrics. Mark sections with [verse], [chorus] and [bridge].")
    if cot not in COT:
        raise gr.Error("Planning mode must be full, melody or off.")
    if cot == "melody" and not (abc or "").strip():
        raise gr.Error("Melody planning needs an ABC score. Transcribe a recording with Score Studio API first.")
    sweep()
    job = Path(tempfile.mkdtemp(prefix="song-", dir=ROOT))
    artifacts = job / "artifacts"
    started = time.monotonic()
    try:
        progress(0.05, desc="Planning melody and chords")
        # An unset seed must still be reproducible in the returned settings,
        # so derive one rather than letting the pipeline pick silently.
        chosen = int(seed) if seed not in (None, "", -1) else int.from_bytes(os.urandom(4), "big")
        song = pipeline()(style=style.strip(), lyrics=lyrics.strip(), cot=cot, seed=chosen,
                    **({"abc": abc.strip()} if (abc or "").strip() else {}))
        progress(0.9, desc="Rendering audio")
        flac = job / "song.flac"
        song.save(str(flac))
        # Artifacts carry the planned ABC score, which is what makes a result
        # editable: the client edits the score and regenerates with cot="full".
        plan = ""
        try:
            song.save_artifacts(str(artifacts))
            scores = sorted(artifacts.rglob("*.abc"))
            plan = scores[0].read_text(encoding="utf-8") if scores else ""
        except Exception:
            logging.exception("Artifact export failed")
        archive = (shutil.make_archive(str(job / "song-artifacts"), "zip", artifacts)
                   if artifacts.exists() else None)
        elapsed = round(time.monotonic() - started)
        status = f"Finished in {elapsed // 60}m {elapsed % 60}s · seed {chosen}"
        return status, str(flac), archive, plan, chosen
    except gr.Error:
        raise
    except torch.cuda.OutOfMemoryError:
        logging.exception("Out of memory")
        raise gr.Error("The song was too long for one pass. Try fewer lyric sections.")
    except Exception:
        logging.exception("Generation failed")
        raise gr.Error("Generation failed. Try a shorter set of lyrics. Details are in the Space logs.")


@spaces.GPU(duration=gpu_seconds)
def generate(style, lyrics, cot, seed, abc, progress=gr.Progress()):
    return run(style, lyrics, cot, seed, abc, progress)


@spaces.GPU(duration=gpu_seconds)
def cover(style, lyrics, abc, seed, progress=gr.Progress()):
    # Melody planning follows the transcribed tune while the style prompt
    # replaces the arrangement, which is what makes the result a cover.
    return run(style, lyrics, "melody", seed, abc, progress)


with gr.Blocks(title="Kiku YuE2", delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Kiku YuE2\nThe ZeroGPU song-generation engine for Kiku AI. "
                "Write a style and lyrics to get a full song with vocals, or supply a melody "
                "score to cover an existing tune.")
    with gr.Tab("Create a song"):
        style = gr.Textbox(label="Style", lines=2,
                           placeholder="dream pop, female vocal, warm analog synths, 92 BPM")
        lyrics = gr.Textbox(label="Lyrics", lines=10,
                            placeholder="[verse]\n...\n\n[chorus]\n...")
        cot = gr.Radio(COT, value="full", label="Planning",
                       info="full plans melody and chords · melody follows a score · off skips planning")
        abc = gr.Code(label="ABC score (optional)", language=None)
        seed = gr.Number(value=-1, label="Seed", info="-1 picks a new seed", precision=0)
        run_btn = gr.Button("Generate song", variant="primary")
    with gr.Tab("Cover a recording"):
        c_style = gr.Textbox(label="New style", lines=2,
                             placeholder="jazz-funk, warm lead vocal, Rhodes piano, electric bass")
        c_lyrics = gr.Textbox(label="Lyrics", lines=10)
        c_abc = gr.Code(label="Melody ABC score", language=None)
        c_seed = gr.Number(value=-1, label="Seed", precision=0)
        cover_btn = gr.Button("Generate cover", variant="primary")

    status = gr.Textbox(label="Status")
    audio = gr.Audio(label="Song", type="filepath")
    artifacts = gr.File(label="Artifacts (ABC score, tokens, settings)")
    plan = gr.Code(label="Planned ABC score", language=None)
    used_seed = gr.Number(label="Seed used", precision=0)

    outputs = [status, audio, artifacts, plan, used_seed]
    run_btn.click(generate, [style, lyrics, cot, seed, abc], outputs,
                  api_name="generate", concurrency_limit=1)
    cover_btn.click(cover, [c_style, c_lyrics, c_abc, c_seed], outputs,
                    api_name="cover", concurrency_limit=1)
    gr.Markdown("Powered by [YuE2](https://huggingface.co/m-a-p/YuE2-3B), CC BY-NC 4.0 "
                "(non-commercial). YuE2 sings its own vocals and cannot reproduce a specific "
                "person's voice — to keep your own recording, use the accompaniment endpoint on "
                "[Kiku ACE-Step](https://huggingface.co/spaces/Reubencf/Kiku-ACE-Step). "
                "Temporary files expire after 24 hours.")


def health():
    return {"status": "ready", "model": MODEL_ID}


if __name__ == "__main__":
    app, _, _ = demo.queue(max_size=5).launch(
        server_name="0.0.0.0", server_port=7860, max_file_size="100mb",
        show_error=False, prevent_thread_lock=True, ssr_mode=False)
    app.add_api_route("/health", health, methods=["GET"])
    demo.block_thread()
