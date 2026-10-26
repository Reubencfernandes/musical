---
title: Kiku AI
emoji: 🎤
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
short_description: AI music studio that builds a band around your voice
models:
  - m-a-p/SheetSage2
  - m-a-p/YuE2-3B
  - ACE-Step/ACE-Step-v1-3.5B
  - Tongyi-MAI/Z-Image-Turbo
  - HeartMuLa/HeartTranscriptor-oss
tags:
  - audio-to-score
  - music-generation
  - text-to-music
  - music-transcription
---

# Kiku AI

The web app uses **Next.js App Router, React, TypeScript and Tailwind CSS 4**.
See [web architecture](docs/web-architecture.md) for styling conventions, shared
layouts, session handling and manual review notes.

Record or upload a take, turn it into editable notation, and build a full song
around it. YuE2-Turbo runs on a private Modal L40S GPU; ACE-Step audio edits,
transcription, lyrics, song ideas, stems and cover art use your Hugging Face ZeroGPU allowance.

The Space opens on **Explore** (`/`): a prompt box and the songs people have shared. Anyone
can look around and listen without an account; typing an idea and pressing Enter (or Create)
asks them to sign in with Hugging Face and then carries the idea on to Generate. **Home**
(`/home`) links to Generate, Studio and Score and lists your latest songs.

## What it does

**Sheet music** (`/score`) turns a recording into a lead sheet you can play with a
moving note highlight, edit, undo, restore and download as ABC, MIDI or PDF.

**Studio** (`/studio`) is a small multitrack DAW: tracks of audio
clips on a timeline, a transport with loop and recording, a mixer with per-track volume, pan,
mute, solo and meters, undo, and WAV export. Clips move, trim, split and duplicate on a beat grid.

Kiku AI works on whatever is selected:

- Select a clip, several clips, or drag across part of a clip (the range tool, `R`, or dragging
  on empty space) to **restyle** it, **rewrite** just that stretch, **split** it into stems or
  **extend** it. An edit inside one clip is spliced back in place with crossfades; anything
  spanning several clips lands on a new track, and the originals are muted rather than deleted.
- **Band** turns a vocal into a band that follows its beat and chords. If the take already has
  music behind it, the voice is lifted off first and the old backing's harmony is followed. The
  voice in the result is always yours. Drums, bass and keys arrive as separate tracks, and the
  project adopts the measured tempo, key and chords (shown in a chord lane).
- With nothing selected, the browser adds one instrument at a time — drums, bass, keys, guitar,
  strings, synth or a full band — written to the project's beat and chords and isolated to that
  instrument, or generates an instrumental or a song with (synthetic) vocals at the playhead.

Each AI action offers the models that can do it: **YuE2-Turbo** for songs, score-based
instrumentals, covers and accompaniment, and **ACE-Step** (1) for editing audio in place:
restyle, rewrite, extend and new parts. ACE-Step builds a guide track from the measured beat
and chords for bands. Stems are always Demucs. ACE-Step 1.5 is no longer used; songs made
with it keep its name.

Several jobs can run while you keep editing; each result is placed against the project as it is
when the job finishes.

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
http://localhost:3000/preview/transcribe, and the studio without signing in (engine calls
fail there) is at http://localhost:3000/preview/studio.

## Hosting

The frontend runs on a CPU Docker Space. YuE2-Turbo uses a private Modal L40S
backend through authenticated server routes. Other jobs run in the
Gradio ZeroGPU engine, called with the signed-in user's own token:

| Space | Used for |
| --- | --- |
| [Kiku-Engine](https://huggingface.co/spaces/Reubencf/Kiku-Engine) | Transcription (SheetSage2), ACE-Step 1 editing and guide-track bands, lyrics with section tags (HeartTranscriptor), song ideas and Enhance (Qwen3-4B-Instruct), Demucs stems, and YuE2-Turbo for the Flutter app |
| [Modal kiku-yue2](https://modal.com/apps/konkanillm/main/deployed/kiku-yue2) | YuE2-Turbo (YuE2 with its AR stage on vLLM) songs, score-based instrumentals, score planning, covers and accompaniment |
| [Kiku-Art](https://huggingface.co/spaces/Reubencf/Kiku-Art) | Z-Image Turbo song artwork (ZeroGPU), on each user's own token |

Generate has three modes, all sung by YuE2-Turbo. Simple has a small open language model
(Qwen3-4B-Instruct, Apache 2.0, on the engine's ZeroGPU) write the style and lyrics from one
line; Custom takes your own. Get lyrics marks the sections it hears: [verse], [chorus],
[bridge], [intro], [inst] and [outro].
**Cover** takes a dropped song (its first five minutes) and has YuE2-Turbo perform its melody
and chords in a new style. **Get lyrics** transcribes the song's words with
HeartTranscriptor so they can be checked or rewritten first; left empty, the cover sings the
song's own words. With Instrumental on, the melody is played instead of sung.

New songs receive artwork from [Z-Image Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
(Apache 2.0) on the Kiku-Art ZeroGPU Space, which the browser calls with the signed-in user's
token (the `art` job). The title is passed only as a lowercase theme and the lyrics not at all,
because Z-Image paints any words it is given. The audio is ready first; artwork failure keeps the gradient thumbnail.
Covers are saved as WebP alongside the audio in the user's private dataset. Songs made before
this keep their DreamLite-base artwork.

Every song can show its lyrics and style, and can be made **public** or private. Public songs
are copied to a public dataset in the user's own account, `<username>/kiku-ai-shared`
(`index.json` plus each song's MP3 and artwork), which Explore finds through Hugging Face's
dataset search. Explore shows who made each song (their Hugging Face name and picture, linked to
their profile). Making a song private again deletes its files and squashes that dataset's history.

Each Modal backend retains CPU memory snapshots, zero minimum workers, one
maximum L40S worker, and the existing 120-second idle window. Its proxy token
stays on the server. Result downloads use encrypted, expiring tickets tied to
the signed-in user. Modal failures do not silently switch to ZeroGPU.

Hosting more than two ZeroGPU Spaces on one account requires PRO.

Before deploying, configure these Space settings:

- Secret `SESSION_SECRET`: 32 random bytes encoded as 64 hexadecimal characters.
- Variable `APP_ORIGIN`: `https://reubencf-kiku-ai.hf.space`.
- Variable `MODAL_ENGINE_ORIGIN`: `https://konkanillm--kiku-acestep15-engine-web.modal.run`.
- Variable `MODAL_YUE2_ORIGIN`: `https://konkanillm--kiku-yue2-engine-web.modal.run`.
- Secrets `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET`: a Modal proxy token pair.
- Optional `NEXT_PUBLIC_HF_*_SPACE` and `NEXT_PUBLIC_HF_*_ORIGIN` overrides for each engine, read at build time; see `env.example`.

The app publishes its own OAuth client as a Client ID Metadata Document at
`/oauth/client`; set the Space variable `HF_OAUTH_CLIENT_ID` to
`https://reubencf-kiku-ai.hf.space/oauth/client` (locally the engine's older client is used).
Sign-in uses authorization code with PKCE and asks for `openid profile read-repos write-repos
manage-repos`, so it can keep songs, studio projects and scores in a private dataset in the
user's own account, `<username>/kiku-ai-library`, and share songs from `<username>/kiku-ai-shared`. No owner Hugging Face token is required or used.

User access tokens are encrypted in HttpOnly cookies and expire within eight hours. The
browser calls the engine Spaces and the Hub itself, so `/api/auth/token` hands the
signed-in user's own token to this app's pages (same-origin requests only). Engine calls
come from each user's own connection: calls made from this Space's shared address were
rate-limited by Hugging Face. Serve the app over HTTPS and keep the session secret stable
across restarts. Login opens the app at its own origin so it does not depend on
third-party cookies. Backend score downloads expire after 24 hours.

### The Flutter app

The Kiku AI Flutter app (`kiku_app` in this repository) signs in with Hugging Face on the
device, using this app's OAuth client and the `kikuai://oauth/callback` redirect listed in
`/oauth/client`, or with a pasted access token. It calls the authenticated routes
(`/api/modal/jobs`, `/api/modal/file`, `/api/modal/cover`) with the user's token as
`Authorization: Bearer hf_…`. The server checks the token with Hugging Face's `whoami-v2`, keeps
the answer for five minutes, and skips the same-origin check for these requests, which carry no
cookie. A request with an `Authorization` header never falls back to the session cookie.

Songs and scores saved by the app keep FLAC audio and name it in the entry's `audio` field
(`songs/<id>.flac`); the library reads that field and otherwise uses `<id>.mp3`.

## Limits

Audio for transcription must be 5 seconds to 10 minutes and under 100 MB. Audio sent
from the studio must be 3 seconds to 4 minutes (stem splits up to 6 minutes). The whole recording is
validated and submitted; longer input is rejected, not silently truncated.

YuE2-Turbo generation uses Modal and does not consume the user's
Hugging Face ZeroGPU allowance. Remaining ZeroGPU jobs use that user's allowance.
Each Modal model has one GPU worker and queues inference requests.

A band follows the beat grid and chords measured from your take, not its phrasing, because
ACE-Step's Singing2Accompaniment ControlNet is unreleased. Steady singing follows well; a take
with no clear pulse falls back to matching its key only. Studio edits send at most four minutes
of audio at once.

SheetSage2 produces melody and chord lead sheets, not a complete orchestral score.
Review AI notation before performing. The model weights are CC BY-NC 4.0
(non-commercial). Fonts are distributed by [Fontshare](https://www.fontshare.com/licenses).

## Checks

`npm run typecheck` and `npm run build` verify the production frontend.
Before publishing, verify real Hugging Face login, full audio processing,
score playback and editing, both themes, keyboard controls and reduced motion.
