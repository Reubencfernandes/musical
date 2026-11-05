---
title: Kiku Art
emoji: 🎨
colorFrom: red
colorTo: yellow
sdk: gradio
sdk_version: 6.2.0
python_version: 3.11
app_file: app.py
short_description: Z-Image Turbo song artwork behind Kiku AI
models:
  - Tongyi-MAI/Z-Image-Turbo
license: apache-2.0
tags:
  - text-to-image
  - zerogpu
---

# Kiku Art

Paints the cover art for songs made in [Kiku AI](https://reubencf-kiku-ai.hf.space) with
[Z-Image Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) (Apache 2.0) on ZeroGPU.
Kiku AI calls it from the browser with the signed-in user's own token, so each cover counts
against that user's ZeroGPU allowance.

`/cover` takes a song's title and visual brief/musical style and returns a 768px square WebP
plus the seed it used. This matches the library's stored size, avoiding a 1024px render
followed by a resize. The Turbo model retains nine scheduler steps (eight DiT passes)
and zero guidance; the change reduces pixels by 43.75%, not a measured latency percentage.
The title becomes a lowercase theme and is never quoted, because Z-Image paints any words it
is given onto the picture.

The existing Qwen3 song writer in Kiku-Engine interprets the song's idea, lyrics, mood and
setting into a visual scene before this Space paints it. Simple mode includes that brief in
its existing writing pass; Custom mode uses the engine's `/artwork` endpoint in parallel with
audio generation. Only the visual brief, title and musical style reach this image service.
If the writer is unavailable, the app uses the existing title/style fallback.
