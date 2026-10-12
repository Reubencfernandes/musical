"""A private, queued audio-to-score interface for SheetSage2."""
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
from score_player import score_player, DEMO

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


def gpu_seconds(audio, start, duration, melody_only, piano, **kwargs):
    # Short excerpts should fit visitor quotas instead of reserving five minutes.
    return max(45, min(300, int(float(duration) * 0.4) + 30))


@spaces.GPU(duration=gpu_seconds)
def transcribe(audio, start, duration, melody_only, piano, progress=gr.Progress()):
    if not audio:
        raise gr.Error("Upload an audio file first.")
    if start < 0 or not 5 <= duration <= 600:
        raise gr.Error("Choose a start of 0 or later and a duration from 5 to 600 seconds.")
    # Clear the previous run immediately so failed requests cannot show stale scores.
    yield "Preparing your audio…", [], None, None, [], "", score_player("")
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
        yield status, pngs, str(pdf) if pdf.exists() else None, str(wavs[0]) if wavs else None, [archive] + [str(p) for p in files], abc, score_player(abc)
    except gr.Error:
        raise
    except Exception:
        logging.exception("Transcription failed")
        raise gr.Error("Conversion failed. Try a shorter excerpt. Details are available in the Space logs.")


with gr.Blocks(title="Audio to Score", theme=gr.themes.Soft(primary_hue="teal"),
               delete_cache=(3600, 86400)) as demo:
    gr.Markdown("# Audio to Score\nTurn a recording into sheet music you can read, print, and edit.")
    gr.Markdown("**Powered by SheetSage2** · Melody + chords · PDF · MIDI · ABC")
    with gr.Row():
        with gr.Column(scale=1):
            audio = gr.Audio(sources=["upload"], type="filepath", label="Upload your music")
            with gr.Row():
                start = gr.Number(value=0, minimum=0, label="Start time (seconds)")
                duration = gr.Slider(5, 600, value=30, step=5, label="Excerpt length (seconds)")
            gr.Markdown("Start with **30 seconds**. Longer excerpts use more of your ZeroGPU quota. Only the selected excerpt is transcribed.")
            melody = gr.Checkbox(label="Melody only (omit chord accompaniment)", value=False)
            piano = gr.Checkbox(label="Include piano audio preview", value=True)
            run = gr.Button("Convert audio to score", variant="primary", size="lg")
        with gr.Column(scale=2):
            status = gr.Textbox(label="Status", value="Upload a recording to begin.", interactive=False)
            player = gr.HTML(value=score_player(DEMO), label="Interactive score")
            with gr.Accordion("Printable score pages", open=False):
                gallery = gr.Gallery(label="Your score", columns=1, height=620, object_fit="contain")
            pdf = gr.File(label="Printable PDF", interactive=False)
            preview = gr.Audio(label="Piano preview", interactive=False)
    downloads = gr.File(label="Download all files (ZIP), or choose an individual file", file_count="multiple", interactive=False)
    with gr.Accordion("View / copy editable ABC notation", open=False):
        abc = gr.Code(label="ABC score", language=None, interactive=False)
    gr.Markdown("Produces a lead sheet with vocal and instrumental melodies and chord symbols. Review notes and rhythm before performing. "
                "Temporary files are cleared after 24 hours or a restart. "
                "[SheetSage2](https://huggingface.co/m-a-p/SheetSage2) weights: CC BY-NC 4.0 (non-commercial).")
    run.click(transcribe, [audio, start, duration, melody, piano],
              [status, gallery, pdf, preview, downloads, abc, player], api_name="transcribe",
              concurrency_limit=1)

if __name__ == "__main__":
    demo.queue(max_size=5).launch(server_name="0.0.0.0", server_port=7860,
                                max_file_size="100mb", show_error=False)
