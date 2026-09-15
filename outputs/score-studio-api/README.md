---
title: Score Studio API
emoji: 🎼
colorFrom: yellow
colorTo: red
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
python_version: 3.10.13
short_description: Audio to editable notation, MIDI and printable scores
models:
  - m-a-p/SheetSage2
tags:
  - audio-to-score
  - zerogpu
  - music-transcription
---

# Score Studio API

A separate ZeroGPU engine for Score Studio, built by [Reubencf](https://huggingface.co/Reubencf).

`/transcribe` accepts audio, start seconds, duration seconds (5–600), melody-only and piano-preview flags.
Returns status, score images, PDF, piano WAV, downloads (ABC, MIDI, ZIP) and editable ABC notation.
Requests are queued one at a time. Uploads are limited to 100 MB and temporary results expire after 24 hours.
Call with the signed-in user's Hugging Face token to use that user's ZeroGPU allowance.

The model produces a lead sheet of melody and chord symbols; review AI notation before performing.
SheetSage2 weights are licensed CC BY-NC 4.0 (non-commercial).
The OAuth metadata endpoint supports Score Studio and its local development callback using PKCE;
it requests only the user's public profile, without repository access.
