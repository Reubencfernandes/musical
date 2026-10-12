---
title: Kiku YuE2
emoji: 🎤
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
python_version: 3.10.13
short_description: Full songs with vocals from style and lyrics, plus covers
models:
  - m-a-p/YuE2-3B
tags:
  - text-to-music
  - zerogpu
  - music-generation
---

# Kiku YuE2

The ZeroGPU song-generation engine for [Kiku AI](https://huggingface.co/spaces/Reubencf/Kiku-AI),
built by [Reubencf](https://huggingface.co/Reubencf).

## Endpoints

`/generate` takes a style prompt, lyrics, a planning mode and a seed, and returns a
48 kHz stereo song with vocals and accompaniment. An optional ABC score constrains the melody
and, in `full` mode, the harmony.

`/cover` takes a melody ABC score plus lyrics and re-arranges them in a new style using
melody-only planning. Produce the ABC with
[Score Studio API](https://huggingface.co/spaces/Reubencf/Score-Studio-API), which transcribes a
recording to melody and chords.

Both endpoints return the FLAC song and an artifacts ZIP containing the planned ABC score,
tokens and settings, so a result can be edited and regenerated.

## Notes

Requests are queued one at a time and temporary results expire after 24 hours.
Call with the signed-in user's Hugging Face token to use that user's ZeroGPU allowance.

YuE2 sings its own vocals; it cannot reproduce a specific person's voice. To keep your own
recorded voice, use the `/accompany` endpoint on
[Kiku ACE-Step](https://huggingface.co/spaces/Reubencf/Kiku-ACE-Step) instead, which generates a
backing track underneath your original vocal.

YuE2 weights are licensed CC BY-NC 4.0 (non-commercial). Review AI-generated music before release.
