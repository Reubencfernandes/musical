---
title: Kiku Engine
emoji: 🎛️
colorFrom: purple
colorTo: red
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
python_version: 3.10.13
short_description: One ZeroGPU API for transcription, songs and backing tracks
models:
  - m-a-p/SheetSage2
  - m-a-p/YuE2-3B
  - ACE-Step/ACE-Step-v1-3.5B
tags:
  - text-to-music
  - zerogpu
  - music-generation
  - music-transcription
---

# Kiku Engine

The single ZeroGPU API behind [Kiku AI](https://huggingface.co/spaces/Reubencf/Kiku-AI),
built by [Reubencf](https://huggingface.co/Reubencf). The frontend is a separate CPU Docker
Space; ZeroGPU only supports the Gradio SDK, so all inference lives here.

## Endpoints

| Endpoint | Does |
| --- | --- |
| `/accompany` | Writes a band under your real recording, following its beat and chords, and keeps your voice |
| `/part` | One instrument (drums, bass, keys, guitar, strings, synth) that follows a mix, or from a prompt |
| `/transcribe` | Audio to melody, chords, ABC, MIDI and a printable score |
| `/song` | A full song with generated vocals from style and lyrics |
| `/plan_score` | YuE2's symbolic plan without audio; returns editable native ABC and a seed |
| `/score_instrumental` | Render a reviewed score as an instrumental, transferring the sung melody into Ins |
| `/cover` | Re-arranges a transcribed melody in a new style |
| `/instrumental` | A backing track from a description |
| `/remix` `/repaint` `/extend` `/edit` | Reshape existing audio; `/repaint` takes fractional seconds |
| `/stems` | Split a mix into vocals and instrumental |
| `/split` | Split a mix into vocals, drums, bass and everything else |
| `/score` | Reads a stretch into a score: bars with their start times, chords, sections, key, tempo and (optionally) the sung words |
| `/lyrics` | Whisper transcription of the sung words, grouped under the score's sections |
| `/restage` | Covers a stretch with YuE2: the same melody and chords, sung or on an instrument, locked to the original bars |
| `/band_score` | A YuE2 band that plays the take's own chords and form, locked to its bars, under the real voice |

## Scores: keeping the tune

`/score`, `/restage` and `/band_score` work through the score rather than the sound.
SheetSage2 reads the melody, chords, sections and every beat of a stretch; `scores.py` edits
that score (chords per bar, transposition, tempo, giving the vocal line to an instrument,
removing it for a band) and rewrites it in the native two-voice ABC, checked with the official
`abc_tools.py` parser (vendored, MIT). YuE2 then plays the score, so the tune is the original's.
YuE2 has no timing or audio-reference input, so `sync.py` reads its render again, pairs its bars
with the score's bars by harmony (dynamic time warping, tolerant of a bar added or dropped), and
Rubber Band stretches it until every bar starts where the recording's bar starts. A new tempo
disables that lock, since the original bar lines no longer apply.

## Keeping your own voice

No model re-sings you. `/accompany` writes a band and mixes it **underneath** your audio.

A tempo and key in the prompt are only a hint to ACE-Step, so a band written from text alone
starts on its own downbeat, drifts and plays its own chords. It follows *audio* closely, though.
So the engine:

1. Checks for music behind the voice with Demucs (`separate="auto"`). If there is some, the voice
   is lifted off, and the old backing is what gets analysed: it carries the beat and harmony far
   more reliably than a melody does.
2. Tracks the beat grid, snapping it to the note attacks, and names one chord per bar. Bar lines
   go wherever the bars fit triads best, since neighbouring chords share notes.
3. Synthesises a plain guide track on that grid — kick and snare, root-note bass, sustained
   triads — and has ACE-Step's audio2audio restyle it into the style you asked for.
   `strength` sets how closely the band keeps the guide's timing and chords.
4. Measures any remaining offset against the guide, then mixes. With `split_parts` it also
   returns drums, bass and the rest as separate stems.

It returns the mix, the band, your vocal, the prompt, the original backing (when one was found),
the three band stems and a JSON summary of the tempo, key, beats and chords it used.

`Singing2Accompaniment` is still unreleased, so the band follows your beat and chords, not your
phrasing. Rubato takes keep their tracked beats instead of a fitted grid, but unmetered singing
with no clear pulse falls back to text-to-music at the measured key.

`python test_band_tools.py` checks the analysis on synthetic audio with a known tempo and
progression; `python test_audio_tools.py` checks the mixing.

## How three models share one Space

They pin conflicting versions — transformers 4.45.2 (SheetSage2), 4.50.0 (ACE-Step) and 4.57.6
(YuE2) — so pip cannot satisfy all three. The YuE2 wheel's stack is installed and the other two
run on it; ACE-Step is installed with `--no-deps` and its inference dependencies are listed
explicitly in `requirements.txt`.

Each model is built on first use, not at import. YuE2 requires this: it reaches low-level CUDA
init while constructing, which ZeroGPU refuses outside a `@spaces.GPU` function. Weights are
fetched at startup, so no request pays to download them, but the first call to each model
carries its load time and its GPU budget allows for that.

## Notes

Requests are queued one at a time, uploads are capped at 100 MB, and temporary results expire
after 24 hours. Call with the signed-in user's Hugging Face token to use that user's ZeroGPU
allowance.

SheetSage2 and YuE2 are CC BY-NC 4.0 (non-commercial). ACE-Step is Apache 2.0 and Demucs is MIT,
so `/accompany`, `/part`, `/instrumental`, `/stems` and `/split` results carry no non-commercial restriction.
