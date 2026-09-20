"""The dedicated ZeroGPU transcription API for Score Studio."""
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

import gradio as gr
import spaces
import torch
from transformers import AutoModel

MODEL_ID = "m-a-p/SheetSage2"
REVISION = "eab522a8168e8b8b8c4856bf8609cd86198f01fe"
ROOT = Path(tempfile.gettempdir()) / "audio-to-score"
ROOT.mkdir(exist_ok=True)
logging.basicConfig(level=logging.INFO)

# ZeroGPU's CUDA emulation lets the model be placed during startup; the actual
# 48 GB GPU is attached only while the decorated conversion function runs.
MODEL = AutoModel.from_pretrained(
    MODEL_ID, revision=REVISION, trust_remote_code=True,
    torch_dtype=torch.bfloat16,
).eval().to("cuda")

# The upstream renderer is fully offline but needs its matching headless browser.
subprocess.run([sys.executable, "-m", "playwright", "install", "--only-shell", "chromium"], check=True)


def gpu_seconds(audio, start, duration, melody_only, piano, progress=None, **kwargs):
    # Short excerpts should fit visitor quotas instead of reserving five minutes.
    return max(45, min(300, int(float(duration) * 0.4) + 30))


@spaces.GPU(duration=gpu_seconds)
def transcribe(audio, start, duration, melody_only, piano, progress=gr.Progress()):
    if not audio:
        raise gr.Error("Upload an audio file first.")
    if start < 0 or not 5 <= duration <= 600:
        raise gr.Error("Choose a start of 0 or later and a duration from 5 to 600 seconds.")
    # Clear the previous run immediately so failed requests cannot show stale scores.
    yield "Preparing your audio…", [], None, None, [], ""
    # Keep the current result until Gradio has copied it to its managed cache.
    # Remove abandoned job directories from earlier runs after one day.
    cutoff = time.time() - 86400
    for old in ROOT.glob("score-*"):
        if old.is_dir() and not old.is_symlink() and old.stat().st_mtime < cutoff:
            shutil.rmtree(old, ignore_errors=True)
    job = Path(tempfile.mkdtemp(prefix="score-", dir=ROOT))
    clip = job / "input.wav"
    output = job / "results"
    output.mkdir()
    try:
        progress(0.03, desc="Preparing audio excerpt")
        completed = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start),
             "-i", str(audio), "-t", str(duration), "-ac", "1", "-ar", "24000",
             "-y", str(clip)], capture_output=True, timeout=120,
        )
        if completed.returncode or not clip.exists() or clip.stat().st_size < 2048:
            raise gr.Error("Could not read this excerpt. Check the file and start time.")
        progress(0.06, desc="Loading SheetSage2 — first run takes longer")
        model = MODEL
        started = time.monotonic()

        def update(event):
            stage = event.get("stage", "working")
            labels = {"audio": "Reading audio", "encoding": "Listening to the music",
                      "decoding": "Writing notes and chords", "notation": "Preparing notation",
                      "complete": "Rendering printable score"}
            detail = labels.get(stage, "Processing music")
            if "window" in event:
                detail += f" · section {event['window']}/{event['windows']}"
            if "tokens" in event:
                detail += f" · {event['tokens']} symbols"
            progress(None, desc=detail)

        notice = ""
        try:
            with torch.inference_mode():
                result = model.transcribe(str(clip), output_dir=str(output),
                    melody_only=bool(melody_only), render_audio=bool(piano),
                    render_score="pdf,png", dtype="bf16", progress=update)
        except Exception as exc:
            # Upstream preserves valid MIDI/ABC when notation or rendering fails.
            result = getattr(exc, "result", None)
            if result is None or not any(output.glob("*.mid")):
                raise
            logging.exception("Partial transcription")
            notice = " Some score rendering failed; available transcription files are included."
        progress(0.97, desc="Preparing downloads")
        files = sorted(p for p in output.iterdir() if p.is_file() and p.suffix != ".partial")
        if not files:
            raise RuntimeError("The model returned no output files.")
        archive = shutil.make_archive(str(job / "score-downloads"), "zip", output)
        pngs = [str(p) for p in sorted(output.glob("score_*.png"))]
        pdf = output / "score.pdf"
        wavs = sorted(output.glob("*.wav"))
        abc_path = output / "score.abc"
        abc = abc_path.read_text(encoding="utf-8") if abc_path.exists() else ""
        elapsed = round(time.monotonic() - started)
        warnings = result.get("warnings", [])
        status = f"Finished in {elapsed // 60}m {elapsed % 60}s. Download your files below.{notice}"
        if warnings:
            status += " The model reported warnings; review result.json in the download."
        yield status, pngs, str(pdf) if pdf.exists() else None, str(wavs[0]) if wavs else None, [archive] + [str(p) for p in files], abc
    except gr.Error:
        raise
    except Exception:
        logging.exception("Transcription failed")
        raise gr.Error("Conversion failed. Try a shorter excerpt. Details are available in the Space logs.")


with gr.Blocks(title="Score Studio API", delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Score Studio API\nThe ZeroGPU transcription engine for Score Studio. "
                "Use the API below to turn audio into editable ABC, MIDI, PDF and piano audio.")
    audio = gr.Audio(type="filepath", label="Audio", sources=["upload"])
    start = gr.Number(value=0, label="Start (seconds)", minimum=0)
    duration = gr.Number(value=30, label="Duration (seconds)", minimum=5, maximum=600)
    melody = gr.Checkbox(value=False, label="Melody only")
    piano = gr.Checkbox(value=True, label="Render piano preview")
    run = gr.Button("Transcribe")
    status = gr.Textbox(label="Status")
    gallery = gr.Gallery(label="Score pages")
    pdf = gr.File(label="PDF")
    preview = gr.Audio(label="Piano preview")
    downloads = gr.File(label="Downloads", file_count="multiple")
    abc = gr.Code(label="ABC notation", language=None)
    run.click(transcribe, [audio, start, duration, melody, piano],
              [status, gallery, pdf, preview, downloads, abc],
              api_name="transcribe", concurrency_limit=1)
    gr.Markdown("Powered by [SheetSage2](https://huggingface.co/m-a-p/SheetSage2), "
                "CC BY-NC 4.0. Temporary files expire after 24 hours.")

def oauth_metadata():
    return {
        "client_id": "https://reubencf-score-studio-api.hf.space/.well-known/oauth-cimd",
        "client_name": "Score Studio",
        "client_uri": "https://huggingface.co/spaces/Reubencf/Score-Studio-API",
        "redirect_uris": [
            "http://localhost/auth/callback", "http://127.0.0.1/auth/callback",
            "https://reubencf-score-studio.hf.space/auth/callback",
        ],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "scope": "openid profile",
    }

def health():
    return {"status": "ready", "model": MODEL_ID, "revision": REVISION}

if __name__ == "__main__":
    # The native Gradio launch hook registers the GPU worker with Spaces.
    app, _, _ = demo.queue(max_size=5).launch(
        server_name="0.0.0.0", server_port=7860, max_file_size="100mb",
        show_error=False, prevent_thread_lock=True, ssr_mode=False)
    app.add_api_route("/.well-known/oauth-cimd", oauth_metadata, methods=["GET"])
    app.add_api_route("/health", health, methods=["GET"])
    demo.block_thread()
