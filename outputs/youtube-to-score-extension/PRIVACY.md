# YouTube to Score: privacy policy

_Last updated 24 October 2026_

YouTube to Score is a Chrome extension that records part of a YouTube video you choose and
turns it into sheet music. This page says what it handles and where that goes.

## What stays in your browser

- **Your captures**: the recorded audio, the title and address of the video, and the sheet music
  made from it. They are kept in the extension's own storage (IndexedDB) on your computer until you
  delete them.
- **Your settings**: the score layout, letters or sheet music, the play-along sound, and the part you
  were choosing.
- **Your Hugging Face sign-in**, if you sign in: an access token, its expiry, your username, display
  name and profile picture address, kept in `chrome.storage.local`. **Sign out** removes it.

## What leaves your browser, and why

- **The audio you record goes to SheetSage2**, on the Hugging Face Space
  [`Reubencf/Score-Studio-API`](https://huggingface.co/spaces/Reubencf/Score-Studio-API), only when a
  capture is transcribed. The Space sends back the notes and chords. Hugging Face keeps the Space's
  files for about 24 hours ([Hugging Face privacy policy](https://huggingface.co/privacy)).
- **When you are signed in**, that request carries your Hugging Face token, so the transcription
  counts against your own ZeroGPU allowance.
- **Signing in** goes through Hugging Face's own sign-in page. The Kiku AI Space
  (`reubencf-kiku-ai.hf.space`) only passes the answer back to the extension. It does not see or keep
  your token, which the extension gets straight from Hugging Face with PKCE.
- **Playing along with a video** controls the YouTube tab you already have open (play, pause, seek,
  mute). Nothing is sent to YouTube beyond what the player itself does.
- **The captures list shows each video's thumbnail**, loaded from YouTube's image server
  (`i.ytimg.com`) by the video's ID, with no referrer.

## What it does not do

- No analytics, tracking, advertising or selling of data.
- It does not read your browsing history. On YouTube it reads only the open video's title, channel,
  chapters and playing position.
- It loads no code from the internet. Everything it runs ships inside the extension.

## The optional yt-dlp helper

If you install the helper in `native/` on your own PC, the extension asks it to download the part you
chose with yt-dlp. That runs on your computer, and the helper is not part of the release download.

## Contact

Questions or requests: open an issue at
[github.com/Reubencfernandes/musical](https://github.com/Reubencfernandes/musical/issues).
