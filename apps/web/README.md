---
title: Score Studio
emoji: 🎼
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
short_description: Turn audio recordings into editable sheet music
models:
  - m-a-p/SheetSage2
tags:
  - audio-to-score
  - sheet-music
  - music-transcription
  - audio-to-midi
---

# Score Studio

Upload music or record with your microphone.
Sign in with Hugging Face to use your own ZeroGPU allowance. Play the resulting
lead sheet with a moving note highlight, edit its notation, undo/redo changes,
restore the AI original, and download ABC, MIDI or PDF.

Score playback defaults to piano. The instrument selector also offers acoustic
and electric guitar, acoustic bass, violin, cello, string ensemble, trumpet,
saxophone, clarinet, and flute. This changes the playback sound of the score;
it does not separate the recording into individual instrument parts.

The interface uses Supreme Regular and Bespoke Stencil Bold from Fontshare,
follows your device's preferred theme until you choose one, and switches themes
with an expanding circular wave. Reduced-motion preferences are respected.

## Run locally

Requires Node 24 and FFmpeg/FFprobe on PATH.
Run `npm ci`, configure values from `env.example` in `.env.local`, then `npm run dev`.
Open http://localhost:3000. The development-only animation preview is at
http://localhost:3000/preview/transcribe.

## Hosting

The frontend runs on a CPU Docker Space. Inference runs separately on the public
[Score Studio API](https://huggingface.co/spaces/Reubencf/Score-Studio-API)
Gradio ZeroGPU Space. The original Audio-to-Score Space remains separate.

Before deploying, configure these Space settings:

- Secret `SESSION_SECRET`: 32 random bytes encoded as 64 hexadecimal characters.
- Variable `APP_ORIGIN`: `https://reubencf-score-studio.hf.space`.
- Optional `HF_API_SPACE`, `HF_API_ORIGIN`, `HF_OAUTH_CLIENT_ID`: defaults point to the dedicated API.

The Dockerfile includes FFmpeg and the standalone Next.js build.
No owner Hugging Face token is required or used for public requests. The login
flow uses Hugging Face's Client ID Metadata Documents and authorization code
with PKCE, requesting only `openid profile`. User access tokens are encrypted in
HttpOnly cookies, expire within eight hours, and are never returned to frontend JavaScript.
Serve the app over HTTPS and keep the session secret stable across restarts.
Login opens the app at its own origin so it does not depend on third-party cookies.

Transcription requires a valid session and same-origin submission.
Backend score downloads expire after 24 hours.

## Limits

Audio must be 5 seconds to 10 minutes and under 100 MB. The whole recording is
validated and submitted; longer input is rejected, not silently truncated.

SheetSage2 produces melody and chord lead sheets, not a complete orchestral score.
Review AI notation before performing. The model weights are CC BY-NC 4.0
(non-commercial). Fonts are distributed by [Fontshare](https://www.fontshare.com/licenses).

## Checks

`npm run typecheck` and `npm run build` verify the production frontend.
Before publishing, verify real Hugging Face login, full audio processing,
score playback and editing, both themes, keyboard controls and reduced motion.
