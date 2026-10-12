---
title: Kiku ACE-Step
emoji: 🎸
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
python_version: 3.10.13
short_description: Backing tracks under your real voice, plus remix and stems
models:
  - ACE-Step/ACE-Step-v1-3.5B
tags:
  - text-to-music
  - zerogpu
  - music-generation
  - stem-separation
---

# Kiku ACE-Step

The ZeroGPU instrumental, remix and stem engine for
[Kiku AI](https://huggingface.co/spaces/Reubencf/Kiku-AI), built by
[Reubencf](https://huggingface.co/Reubencf).

## Keeping your own voice

`/accompany` is the endpoint that keeps a real performance. It measures the tempo and key of
your recording, writes an instrumental to match, and mixes that band **underneath your original
audio**. The voice in the result is the one you recorded — no model ever re-sings it. It returns
the mix, the backing track alone and your isolated vocal, so the balance can be redone in a DAW.

Set "Recording already has backing music" to isolate your voice with Demucs before the band is
written, which is what you want when covering a released song rather than singing to silence.

### What this is not

ACE-Step cannot yet accompany a vocal directly; its `Singing2Accompaniment` ControlNet is still
unreleased. Kiku steers the model with a tempo-and-key prompt instead, so the band matches the
*measured* tempo and key of your take, not its phrasing. Expect a good match on steady singing
recorded to a click, and drift on rubato or unmetered takes. The alignment option only shifts the
band to your first detected beat; it does not time-stretch to follow you.

## Other endpoints

`/generate` writes music from a style prompt, with lyrics or as an instrumental when the lyric
box is empty. `/remix` moves an existing track towards a new style. `/repaint` rewrites one
section, `/extend` continues a track, `/edit` applies a new style or new lyrics, and `/stems`
splits a mix into vocals and instrumental.

Endpoints other than `/accompany` and `/stems` regenerate audio, so any singing in the source is
replaced by the model.

## Notes

Requests are queued one at a time, uploads are limited to 100 MB, input recordings to 6 minutes,
and temporary results expire after 24 hours. Call with the signed-in user's Hugging Face token to
use that user's ZeroGPU allowance.

ACE-Step is Apache 2.0 and Demucs is MIT, so results from this Space carry no non-commercial
restriction. Check the rights on any audio you upload.
