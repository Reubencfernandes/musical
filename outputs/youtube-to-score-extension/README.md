# YouTube to Score (Chrome extension)

Record a stretch of a YouTube video as an MP3, then turn it into sheet music with
SheetSage2 through the [Score-Studio-API](https://huggingface.co/spaces/Reubencf/Score-Studio-API) Space.

## Install

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin **YouTube to Score** to the toolbar.
4. Optional but recommended: open the popup → **SheetSage settings** and paste a Hugging Face
   token (read access). Without one, the Space's anonymous ZeroGPU quota runs out after a few clips.

## Use

1. Open a YouTube video and click the toolbar button.
2. Set **Start** (defaults to where the video is now) and **Length** (5–600 s).
3. Press **Record**. The video jumps to the start and plays; the clip records in real time.
   Ads, pauses and buffering are left out. **Stop and keep** ends early.
4. A capture page opens with the MP3 (play or download). If "Turn into sheet music" was on, it
   sends the clip to SheetSage2 right away and shows the PDF/PNG score, MIDI, ABC, piano preview
   and every file the model returns. Results are saved with the capture, so they outlive the
   Space's 24-hour file cache.

All captures are listed on the capture page (popup → **Captures**).

## How it works

| File | Role |
| --- | --- |
| `popup.*` | Picks the excerpt, cues the video, and gets a tab-capture stream ID |
| `background.js` | Runs the capture and opens the capture page when it finishes |
| `offscreen.*`, `recorder-worklet.js` | Records the tab's audio straight to 192 kbps MP3 (lamejs) and keeps the tab audible |
| `content.js` | Reads the YouTube player, seeks, and reports when the video itself is audible |
| `clip.*` | Capture page: playback, download, transcription, results |
| `sheetsage.js` | Gradio API client: `/gradio_api/upload`, then `/gradio_api/call/transcribe` |
| `db.js` | IndexedDB storage for captures and results |

It records what the tab plays (`chrome.tabCapture`) instead of downloading YouTube's streams, so
it needs no stream deciphering and won't break when YouTube changes its player internals. The
trade-off is that recording takes as long as the excerpt.

Any Space with the same `/transcribe(audio, start, duration, melody_only, piano)` endpoint
works. Set it as `owner/name` or a full `https://….hf.space` URL in settings.

## Notes

- Only record videos you have the right to use. Downloading or ripping YouTube content may be
  against YouTube's Terms of Service.
- SheetSage2 weights are CC BY-NC 4.0 (non-commercial).
- `vendor/lame.min.js` is [lamejs](https://github.com/zhuker/lamejs) 1.2.1, LGPL-3.0
  (`vendor/lame.LICENSE`).
- Tab audio capture doesn't work in headless Chrome (it records silence), so test in a real window.
