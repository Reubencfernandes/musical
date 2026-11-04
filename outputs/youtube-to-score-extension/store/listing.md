# Chrome Web Store listing

Everything the Developer Dashboard asks for, for the store build that `python store/build.py` makes
(no yt-dlp helper, no MP3 download). Images are in `store/images/`.

## Store listing

**Name:** YouTube to Score
(The store may treat "YouTube" at the start of a name as suggesting it is made by YouTube. If review
objects, use `Kiku: Song to Score for YouTube`; only `manifest.json`'s `name` changes.)

**Summary (from the manifest, 132 characters at most):**
Record part of a YouTube video, or whatever plays in any tab, and turn it into sheet music or letter notes with SheetSage2.

**Category:** Education (or Tools)

**Language:** English

**Description:**

Turn the music you are watching into something you can play.

Pick a part of a YouTube video, press Record, and YouTube to Score listens to that part as it plays.
SheetSage2, an AI transcription model, writes down the tune and the chords, and the score opens right
beside the video.

- Sheet music: the melody it heard with its chord symbols, engraved in your browser. Nothing is
  added that is not in the recording.
- Letter notes: the tune as note names (C, D, E♭…) with chords above, for anyone who does not read
  staff notation.
- Play along: press With video and the score follows the video as it plays. Hear the piano, the song,
  or both together.
- Works on other sites too: on any tab that plays music, click the toolbar button, press Record and
  play the music. Sites with copy protection, such as Netflix, cannot be recorded.
- Print the score, or save it as PDF, MusicXML or a text file of the letter notes.
- Captures are kept in your browser, so you can come back to them.

Sign in with Hugging Face so transcriptions run on your own free ZeroGPU quota.

Recording plays the part in real time, and only the tab you choose is recorded. Transcriptions are
made by AI and can contain mistakes. Only record music you have the right to use.

Open source: https://github.com/Reubencfernandes/musical

**Promo video:** a YouTube link to one of the demo videos (the store only takes YouTube links).

## Privacy practices tab

**Single purpose:**
Turns a part of the music playing in a tab the user chooses (usually a YouTube video) into sheet
music or letter notes, and plays that score along with the video.

**Permission justifications:**
- `tabCapture`: records the audio of the one tab the user chose, for the part they chose, when they
  press Record.
- `offscreen`: an offscreen document encodes that recording, because a service worker cannot
  play or process audio.
- `activeTab`: after the user clicks the toolbar button on a tab, lets the panel read that tab's
  title and address and record it.
- `sidePanel`: the extension's interface is a side panel next to the video.
- `scripting`: adds the extension's own content script to YouTube tabs that were already open when
  the extension was installed, so it can read the video's title and playing position.
- `storage`: keeps the user's settings and their Hugging Face sign-in.
- `identity`: runs the Hugging Face sign-in (OAuth with PKCE) through `launchWebAuthFlow`.
- Host `https://www.youtube.com/*` and `https://music.youtube.com/*`: reads the open video's title,
  channel, chapters and playing position, and plays, pauses and seeks the video for play-along.
- Host `https://huggingface.co/*`: Hugging Face sign-in.
- Host `https://*.hf.space/*`: sends the recorded part to the SheetSage2 transcription Space and
  gets the score back.

**Remote code:** No. All code, fonts, sounds and the Verovio WebAssembly ship in the package.

**Data usage:** tick
- Authentication information: the Hugging Face access token, sent only to Hugging Face.
- Website content: the audio the user records, sent to the SheetSage2 Space on Hugging Face to be
  transcribed.

Then certify all three statements: data is not sold to third parties, not used or transferred for
purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

**Privacy policy URL:**
https://github.com/Reubencfernandes/musical/blob/main/outputs/youtube-to-score-extension/PRIVACY.md

## Before submitting

1. Register a Chrome Web Store developer account (one-time US$5 fee) and turn on 2-Step
   Verification, which the store requires before publishing.
2. Upload `kiku-youtube-to-score-store.zip` (from `python store/build.py`, or the
   `kiku-youtube-to-score-store` workflow artifact).
3. Fill in the listing and privacy tabs from this file, and add the images from `store/images/`.
4. Upload a demo video to YouTube and paste its link as the promo video.
