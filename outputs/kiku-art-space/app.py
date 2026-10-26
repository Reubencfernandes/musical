"""Z-Image Turbo song artwork for Kiku AI, on ZeroGPU."""
import random
import re
import tempfile

import gradio as gr
import spaces
import torch
from diffusers import ZImagePipeline

MODEL = "Tongyi-MAI/Z-Image-Turbo"
REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6"
SIZE = 1024

# Loaded once at start-up; ZeroGPU attaches the GPU only while a request runs.
pipe = ZImagePipeline.from_pretrained(MODEL, revision=REVISION, torch_dtype=torch.bfloat16, low_cpu_mem_usage=False)
pipe.to("cuda")


def prompt_for(title, style):
    """Z-Image paints quoted titles and lyrics as lettering, so the title is only a lowercase theme."""
    theme = re.sub(r"\(cover\)\s*$", "", title, flags=re.I)
    theme = re.sub(r"\s+", " ", re.sub(r"[^\w' -]+", " ", theme)).strip().lower()
    return ("A painted scene with no writing of any kind: no words, letters, captions, signs, labels or typography. "
            + (f"It evokes the theme of {theme}. " if theme and theme != "untitled song" else "")
            + f"The feeling of the music: {style[:1200]}. "
            + "Fills a square frame edge to edge. Rich colour, cinematic lighting, fine painterly detail.")


@spaces.GPU(duration=30)
def paint(prompt, seed):
    generator = torch.Generator("cuda").manual_seed(seed)
    # Nine steps is eight DiT passes; the Turbo model is distilled for no guidance.
    return pipe(prompt=prompt, height=SIZE, width=SIZE, num_inference_steps=9, guidance_scale=0.0,
                generator=generator).images[0]


def cover(title, style, seed):
    title, style = str(title or "").strip(), str(style or "").strip()
    if not style:
        raise gr.Error("Describe the song's style for its cover.")
    if len(title) > 80 or len(style) > 2000:
        raise gr.Error("That title or style is too long.")
    seed = int(seed) if seed is not None and 0 <= int(seed) < 2**31 else random.randrange(2**31)
    image = paint(prompt_for(title, style), seed)
    path = tempfile.NamedTemporaryFile(suffix=".webp", delete=False).name
    image.save(path, "WEBP", quality=88)
    return path, seed


with gr.Blocks(title="Kiku Art") as demo:
    gr.Markdown("# Kiku Art\nCover art for Kiku AI songs, painted by Z-Image Turbo.")
    with gr.Row():
        with gr.Column():
            title_box = gr.Textbox(label="Song title", max_length=80)
            style_box = gr.Textbox(label="Style", lines=3, max_length=2000)
            seed_box = gr.Number(label="Seed (-1 for random)", value=-1, precision=0)
            button = gr.Button("Paint", variant="primary")
        with gr.Column():
            image_out = gr.Image(label="Cover", type="filepath", format="webp")
            seed_out = gr.Number(label="Seed used", precision=0)
    button.click(cover, [title_box, style_box, seed_box], [image_out, seed_out], api_name="cover", concurrency_limit=1)

demo.queue(max_size=32).launch()
