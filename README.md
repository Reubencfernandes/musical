# Kiku Studio

Turn recordings into editable sheet music, and turn scores into new music.
Two builds share one interface:

| Build | Where models run | Sign-in |
|---|---|---|
| **Web** (`apps/web`) | The Hugging Face ZeroGPU Space in `services/api` | Hugging Face, using each visitor's own GPU allowance |
| **Desktop** (`apps/desktop`) | This computer's GPU, through the local engine in `engine/` | None |

The repository is named `musical`. The deployed Spaces keep their original
names (`Reubencf/Score-Studio`, `Reubencf/Score-Studio-API`).

## Layout

- `apps/web` — Next.js studio: upload or record, transcribe, edit notation, piano playback with a moving cursor, ABC/MIDI/PDF export.
- `apps/desktop` — Electron shell. Starts the engine and the studio on loopback ports and shows the studio in a window.
- `services/api` — Gradio ZeroGPU API used by the web build.
- `engine` — builds the pinned [audio.cpp](https://github.com/0xShug0/audio.cpp) server (YuE2 + SheetSage2 only). See `engine/README.md`.
- `models` — `models.json` lists every weight file with its URL, size and SHA-256. The weights themselves are downloaded, never committed.
- `scripts` — deployment and verification helpers. Some retain Windows-specific paths; review before use.

## Run the web build

Requires Node.js 24 and FFmpeg/ffprobe on PATH.

```sh
cd apps/web
npm ci
cp env.example .env.local   # set a private SESSION_SECRET and the API/OAuth values
npm run dev
```

## Run the desktop build

```sh
./engine/build.sh            # once; see engine/README.md for GPU flags
cd apps/web && npm ci && cd ../desktop && npm install
npm run dev
```

Put model files where `apps/desktop/main.js` looks for them:
`models/sheetsage2/sheetsage2-orig.gguf` for transcription, and
`models/yue2/` (the two GGUF files plus `sidecars/`) for generation. A model that
is missing is simply not offered. The studio switches to the local engine when
`SCORE_BACKEND=local`, which the desktop app sets for it; the web build is
unaffected.

## Status

- Web: deployed and working.
- Desktop: prototype. The window, the local engine and the transcription route
  work on macOS/Metal. Generation has no screen yet, there is no installer or
  in-app model download, and Windows, CUDA and Vulkan are untested.
- An earlier Flutter phone app was retired in favour of these two builds. It is
  preserved in git history at commit `68b6fd0`.

## Licences

Model weights are downloaded separately. YuE2 and SheetSage2 have their own
noncommercial licences; this repository does not relicense them. Soundfont
attribution is in `apps/web/public/soundfonts/ATTRIBUTION.md`; font notices are in
`apps/web/public/fonts/README.md`; bundled abcjs notices accompany the assets.
Never commit credentials: `.env*` files are ignored.
