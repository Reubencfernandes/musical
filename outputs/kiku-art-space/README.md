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

`/cover` takes a song's title and style and returns a square WebP plus the seed it used.
The title becomes a lowercase theme and is never quoted, because Z-Image paints any words it
is given onto the picture.
