---
title: Kiku ACE-Step 1.5
emoji: 🎚️
colorFrom: purple
colorTo: yellow
sdk: gradio
sdk_version: 6.2.0
python_version: 3.11
app_file: app.py
short_description: ACE-Step 1.5 behind the Kiku AI studio
models:
  - ACE-Step/Ace-Step1.5
  - ACE-Step/acestep-v15-base
license: mit
tags:
  - text-to-music
  - zerogpu
  - music-generation
---

# Kiku ACE-Step 1.5

[ACE-Step 1.5](https://huggingface.co/ACE-Step/Ace-Step1.5) behind
[Kiku AI](https://huggingface.co/spaces/Reubencf/Kiku-AI), built by
[Reubencf](https://huggingface.co/Reubencf). Its endpoints take the same arguments and return the
same outputs as [Kiku-Engine](https://huggingface.co/spaces/Reubencf/Kiku-Engine), so the studio
can send a request to either model.

| Endpoint | ACE-Step 1.5 task |
| --- | --- |
| `/song` | text-to-music with lyrics, planned by the 1.7B 5 Hz language model |
| `/instrumental` | text-to-music |
| `/remix` | cover (restyle), `strength` = how closely to keep the source |
| `/repaint` `/extend` | repaint, inside the audio or past its end |
| `/part` | lego: one instrument written into a mix (base model) |
| `/accompany` | complete: a band written around a vocal (base model) |

It is its own Space because ACE-Step 1.5 needs Python 3.11, Gradio 6 and torch 2.9, which do not
fit Kiku-Engine's YuE2 stack.

## Keeping your own voice

`/accompany` never keeps a voice the model wrote. Demucs first lifts the voice off any music already
on the take. The base model's complete task then writes drums, bass, keyboard and guitar around
the vocal, conditioned on the audio itself rather than only on a tempo in the prompt. Demucs
removes whatever vocal the model rendered, and the band is mixed under the original take.

The `acestep` package is vendored from the official ACE-Step 1.5 Space (MIT, see
`LICENSE.acestep`), without its UI, training and nano-vllm code. Results may be used commercially.
