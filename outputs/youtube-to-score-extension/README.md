# YouTube to Score (Chrome extension)

Record a stretch of a YouTube video as an MP3, then turn it into sheet music or letter notes with
SheetSage2 through the [Score-Studio-API](https://huggingface.co/spaces/Reubencf/Score-Studio-API) Space.

## Install

1. Download [`kiku-youtube-to-score.zip`](https://github.com/Reubencfernandes/musical/releases/download/extension-latest/kiku-youtube-to-score.zip)
   from the [`extension-latest` release](https://github.com/Reubencfernandes/musical/releases/tag/extension-latest)
   (rebuilt by GitHub Actions whenever this folder changes on `main`) and unzip it into a folder you
   will keep. Or use this folder from a clone of the repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the folder that holds `manifest.json`.
4. Pin **YouTube to Score** to the toolbar.
5. Click it and **Sign in with Hugging Face**. Transcriptions then run on your own ZeroGPU quota;
   without it, the Space's anonymous quota runs out after a few clips.

To update, unzip the new release over the same folder and press reload on the extension's card.

## Use

1. Open a YouTube video and click the toolbar button.
2. Set **Start** (defaults to where the video is now) and **Length** (5–600 s).
3. Press **Record**. The video jumps to the start and plays; the clip records in real time.
   Ads, pauses and buffering are left out. **Stop and keep** ends early.
4. A capture page opens with the MP3 (play or download). If "Turn into sheet music" was on, it
   sends the clip to SheetSage2 right away. Results are saved with the capture, so they outlive
   the Space's 24-hour file cache.

All captures are listed under **Captures** in the panel's top bar.

## Get audio now (optional: yt-dlp on your own PC)

Recording takes as long as the part you pick. On your own PC the extension can
instead fetch the part with [yt-dlp](https://github.com/yt-dlp/yt-dlp) through a
small native-messaging helper in `native/`, which takes seconds.

1. Install Python, yt-dlp (`pip install -U yt-dlp`) and ffmpeg.
2. Run `powershell -ExecutionPolicy Bypass -File native\install.ps1`. It registers
   the helper for this Windows user only, for the extension ID that
   `chrome://extensions` shows (pass `-ExtensionId <id>` if yours differs).
3. Reload the extension. The panel now shows **Get audio now**, with **Record instead**
   as the fallback. `native\uninstall.ps1` removes it again.

The helper downloads a song's audio once (kept a week in your temp folder) and cuts
the exact part with ffmpeg, so play-along with the video lines up. It only works on a
home connection: YouTube blocks cloud servers. Downloading is against YouTube's terms
except through YouTube's own features, so use it only for music you may use, and leave
it out of any build you publish (the Chrome Web Store does not allow YouTube
downloaders). Without the helper, the extension records as before.

## Sheet music

The capture page engraves SheetSage2's result as A4 sheet music with
[Verovio](https://www.verovio.org), with the song's title and artist in the header and
"Transcribed by SheetSage" under them.

- **Piano** (default): the melody in the right hand over a left hand written from SheetSage2's
  chords: bass then chords on the beats (a waltz in 3/4), or held chords. The melody moves by
  octaves into the right hand's range.
- **Lead sheet**: the melody on one staff with chord symbols, in a treble, treble-8 or bass
  clef to suit its range.
- Rhythms are split by the beat and beamed by the beat, with ties and accidentals placed as a
  copyist would. SheetSage2's padded first bar becomes a real pickup, chord names are spelled
  for the key (B♭maj7/D, not A#maj7/C##), and its sections become rehearsal marks.
- **Letters** (the switch above the score) writes the tune as note names instead, bar by bar:
  chord names above, a line under each letter as long as the note is held, and dots above or below
  for the octaves around the one the tune mostly sits in. It plays and highlights like the score,
  note by note, prints, and downloads as plain text (`'` higher, `,` lower, `-` hold). New captures
  open in whichever view was used last.
- **Key** transposes the whole score by up to six semitones. **Play** plays the sheet and
  highlights each bar as it sounds (from SheetSage2's downbeats); click a bar to play from there.
  **With video** plays the YouTube tab in time with the sheet, and **Hear** chooses the sound:
  the piano alone (video muted), both, or the song alone.
- **Print / Save PDF** prints just the pages (choose "Save as PDF" as the printer), and
  **MusicXML** opens in MuseScore, Finale, Sibelius or Dorico.

Title and artist come from the video title ("Artist - Song (Official Video)") and channel, and
can be edited on the page. SheetSage2's own PDF, PNG pages, MIDI and ABC are still under
**All files**.

## How it works

| File | Role |
| --- | --- |
| `popup.*` | Picks the excerpt, cues the video, and gets a tab-capture stream ID |
| `background.js` | Runs the capture and opens the capture page when it finishes |
| `offscreen.*`, `recorder-worklet.js` | Records the tab's audio straight to 192 kbps MP3 (lamejs) and keeps the tab audible |
| `content.js` | Reads the YouTube player, seeks, and reports when the video itself is audible |
| `clip.*` | Capture page: playback, download, transcription, the engraved score |
| `sheetsage.js` | Gradio API client: `/gradio_api/upload`, then `/gradio_api/call/transcribe` |
| `score.js` | Reads SheetSage2's ABC (the native dialect), arranges it and writes MusicXML |
| `sheet.js` | Engraves MusicXML into pages with Verovio and follows the recording bar by bar |
| `letters.js` | Letter notes: the arranged tune as note names per bar, on the page and as text |
| `title.js` | Song title and artist from a YouTube title and channel |
| `hf-auth.js` | Hugging Face sign-in (OAuth with PKCE through `chrome.identity`); the Kiku AI Space serves its client document and forwards the answer back to the extension |
| `db.js` | IndexedDB storage for captures and results |

It records what the tab plays (`chrome.tabCapture`) instead of downloading YouTube's streams, so
it needs no stream deciphering and won't break when YouTube changes its player internals. The
trade-off is that recording takes as long as the excerpt.

The Space is `DEFAULT_SPACE` in `sheetsage.js`. Any Space with the same
`/transcribe(audio, start, duration, melody_only, piano)` endpoint works there, as `owner/name` or
a full `https://….hf.space` URL.

## Extension guidelines

- Manifest V3 with a service worker; all code, fonts, sounds and the Verovio WebAssembly ship in
  the package (no remotely hosted code). The pages' CSP adds only `wasm-unsafe-eval`, for Verovio.
- Permissions, and why: `tabCapture` and `offscreen` record the tab, `sidePanel` shows the panel,
  `scripting` adds the page script to YouTube tabs opened before install, `storage` keeps settings
  and the sign-in, `identity` runs the Hugging Face sign-in, and `nativeMessaging` talks to the
  optional yt-dlp helper. Hosts: YouTube (read the player), `huggingface.co` (sign-in) and
  `*.hf.space` (transcription).
- What is stored and sent is in [PRIVACY.md](PRIVACY.md); the Web Store asks for that page's link.
- The GitHub workflow checks the manifest (store name and description limits, every icon size,
  every file the pages and scripts load, no remote scripts) before packaging.
- Before any Chrome Web Store submission: the store does not accept extensions that download from
  YouTube, so a store build should leave out `native/` and `nativeMessaging`, and the MP3 download
  may need to go too. The name should not suggest it is made by YouTube.

## Notes

- Only record videos you have the right to use. Downloading or ripping YouTube content may be
  against YouTube's Terms of Service.
- SheetSage2 weights are CC BY-NC 4.0 (non-commercial).
- `vendor/lame.min.js` is [lamejs](https://github.com/zhuker/lamejs) 1.2.1, LGPL-3.0
  (`vendor/lame.LICENSE`).
- `vendor/verovio/` is [Verovio](https://www.verovio.org) 6.3.0's WebAssembly build, unmodified,
  LGPL-3.0-or-later (`vendor/verovio/COPYING.LESSER`). WebAssembly is why the manifest allows
  `wasm-unsafe-eval` on extension pages.
- `score.js` reads the native dialect with the rules of Kiku AI's `lib/engrave.ts`; any other
  ABC falls back to SheetSage2's own pages.
- Tab audio capture doesn't work in headless Chrome (it records silence), so test in a real window.
