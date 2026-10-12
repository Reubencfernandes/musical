# YuE2 covers and editable scores

Research and local feasibility checks: 1 October 2026. This extends the [two-model capability plan](model-capability-plan.md) around the user's requested cover choices and piano note editor. Product behavior below is proposed unless explicitly identified as already wired. GPU generation quality has not been validated in this review.

## Decision

The requested cover workflow is supported: a recording is transcribed into a score, the user reviews it and the lyrics, and YuE2 performs that composition in a new style. Melody-only conditioning gives accompaniment freedom; full-score conditioning supplies harmony too. Lyrics should follow the score's section order and phrasing. [Official cover guide](https://github.com/multimodal-art-projection/YuE/blob/main/docs/covers.md).

YuE2 should have a larger role in Kiku: new performances, alternate backing arrangements, instrumental covers, and musical score revisions. ACE-Step remains useful for editing audio passages and adding layers directly from audio.

## Three cover choices

| Choice shown to the user | Example request | Proposed processing | What stays fixed |
| --- | --- | --- | --- |
| New AI performance | “Turn this song into jazz with piano and an AI singer.” | SheetSage2 transcription → reviewed score and lyrics → YuE2 → audition | Reviewed composition constraints. The recording and singer can change. |
| Keep my vocals | “Keep this vocal take; replace the backing with acoustic guitar.” | Isolate the vocal if needed → read source harmony/form → render backing with YuE2 → remove generated vocals → align backing → mix with the retained vocal | The retained recorded vocal performance. Backing instruments and style can change. |
| Instrumental melody | “Play the sung melody on cello, with piano backing.” | Transcribe → review → transfer sung melody to the instrumental score line → YuE2 → audition | The reviewed melody, with optional harmony preservation. No recorded singer is retained. |

The middle choice is a Kiku pipeline, not YuE2 voice cloning. Our `/band_score` adapter already follows this approach. A clean uploaded vocal can remain the source vocal; separating a vocal from a full mix can introduce artifacts. Keep the source recording and make the extracted vocal available for review.

Changing the backing does not require an exact copy of its original audio. A user can request different instruments or a different genre. Instrument choice is a generative request that needs listening checks; requesting “piano only” does not by itself prove that every output will contain only piano.

When keeping recorded vocals, preserve their timing, pitch, and lyrics. Changing the vocal notes in a score cannot change that recording. A transpose or tempo change would require explicit processing of the vocal or a newly generated performance. The first version should lock those controls in this mode and allow compatible backing/harmony edits.

For instrumental covers, the official conversion moves sung notes into the instrumental line and retains non-overlapping instrumental fills. Overlapping lines need a deliberate reduction policy, with any removed material recorded. This creates another performance; it does not extract the source accompaniment. [Official instrumental cover workflow](https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/instrumental/references/cover.md).

## What YuE2 can contribute

| Capability | How it is controlled | Product implication |
| --- | --- | --- |
| New songs with vocals and accompaniment | Style, lyrics, and an optional composition plan | Offer Create song on both models and retain alternate takes. |
| An editable composition before audio | Generate a plan separately, then supply the reviewed score | Let a user approve the musical draft before a full render. |
| Covers that keep a recognizable tune | Supply a transcribed melody score and target style | Useful for users who welcome a different recording and singer. |
| Reharmonization | Edit chord symbols while keeping melody events | “Change the chords; keep the tune” can be a specific score operation. |
| Melody and rhythm changes | Revise selected pitch, onset, or duration events | Supports a piano note editor. Render a new take after editing. |
| Key, tempo, and song-form changes | Change the relevant score fields and structure | Expose explicit operations with matching lyric/section updates. |
| Instrumental creation and covers | Plan or import a score, transfer vocal notes, render without sung words | Add a distinct instrumental workflow rather than using “no vocals” alone. |
| Conversation about musical changes | An external assistant edits the score, style, or lyrics; YuE2 renders | Possible later, with bounded edits and validation. It needs an assistant integration. |

The staged generation interface supports reviewing a plan and retaining generation artifacts. Our old pinned runtime needs compatibility checks before adding current APIs. [Official generation guide](https://github.com/multimodal-art-projection/YuE/blob/main/docs/generation.md).

The official instrumental workflow plans with YuE2 by default, converts score events, and then renders. It does not guarantee exact duration or perfect audible note following. [Official instrumental workflow](https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/instrumental/SKILL.md).

The authors evaluated melody, harmony, rhythm, key, and tempo edits. Under their controlled protocol, edited-note pitch accuracy was 84.17%, edited-chord agreement 79.54%, and rhythm-edit adherence 73.43%. Those results support building score controls, but are not Kiku success rates or exact-following guarantees. YuE2 renders the whole recording even when the composition change is local. [Technical report, section 5](https://arxiv.org/html/2609.33757v1#S5).

## Piano note editor

Provide an **Open score** button from Cover and from a generated YuE2 song. Open a larger workspace with two views of the same draft:

- **Piano roll:** a keyboard at the left and bars across the top. Select a note, drag its pitch or start, resize its length, add/delete notes, loop a passage, and undo/redo. Offer a grid without silently quantizing imported notes.
- **Sheet music:** readable notation with the same selection and playhead. Include a simple piano preview and ABC/MIDI export.

Show separate Sung melody and Instrumental melody lanes, plus a chord row and section labels. A piano sound previews the composition; it does not preview the eventual YuE2 timbre or singer.

The supported native score representation has two monophonic melody lines. Chords are symbols rather than an exact multi-note piano staff. Full polyphonic MIDI arrangements need conversion; they cannot be promised as exact arrangement controls. Notes and keys must be interpreted with native accidental and tie rules. [Native score reference](https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/references/abc-editing.md).

In New AI performance mode, both melody lanes can be edited. In Keep my vocals mode, the recorded vocal lane is a fixed reference. In Instrumental melody mode, show the transferred melody and any retained fills, with a notice if conversion reduced overlapping material.

## Implementation fit in the existing project

The existing studio backend is more capable than the current composer exposes:

- `/api/cover` and `/restage` accept sung or instrumental melody performance, and kept or free harmony. `AIPanel.tsx` currently always submits `voice: 'sing'` and `harmony: 'keep'`. Add these as contextual cover choices without restoring Settings.
- `/api/accompany` can route to YuE2 `/band_score`, retaining the original vocal and producing new backing. It also supports ACE-Step 1.5, so the AI selector can remain available for Keep my vocals.
- `ScoreSheet.tsx` edits key, tempo, chords, and lyrics. It does not expose note editing. The score-reading response contains ABC and note counts, but no structured note list for a piano roll.
- `ScoreWorkspace.tsx` already provides staff notation, piano preview, original-recording playback, and export. Its graphical note-editing flag is disabled. Reuse suitable viewing/playback pieces while adding a validated note-editing path.
- `scores.py` already parses vocal and instrumental notes into exact beat positions, MIDI pitches, and durations, and writes native ABC. It can be the authoritative serializer for an editor.
- `engrave.ts` deliberately creates a display/playback version of the native score. Keep that display format separate from the canonical score supplied to YuE2.

Proposed data flow:

```mermaid
flowchart LR
    A[Uploaded recording] --> B[SheetSage2 score]
    B --> C[Review notes and lyrics]
    C --> D[Piano roll and sheet view]
    D --> E[Validate and save native score]
    E --> F[YuE2 new performance]
    F --> G[Audition take]
    G --> H[Accept into timeline]
```

The retained-vocal mode additionally extracts/keeps the source vocal, renders backing from the reviewed accompaniment score, and checks alignment before mixing.

SheetSage2 supplies melody, chord, beat, key, and structure information, plus ABC, MIDI parts, and timed annotations. It also supports piano and sheet previews. This is a lead-sheet transcription workflow; the user should review mistakes before generation. [SheetSage2 model card](https://huggingface.co/m-a-p/SheetSage2).

## Proposed editor contract

Expose structured note events and bar information alongside the native ABC. Store note timing as exact beat fractions or integer ticks, not floating-point seconds. Maintain the original recording's bar clock separately so it remains useful for playback and alignment.

Use stable note IDs and validate edits on the server before serialization. Reject out-of-range pitches, non-positive lengths, notes beyond the score, and overlaps within a monophonic lane. Handle cross-bar ties, rests, key changes, and chord onsets explicitly. Preserve source and edited drafts, then test the native score after every save.

The upstream event compiler likewise uses exact beat values and rejects overlapping notes and unsupported timing rather than silently changing them. [Official event schema](https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/instrumental/references/event-schema.md).

Preview from the edited events or newly generated MIDI. Do not pair an edited score with an old MIDI preview. Keep score validity, preserved musical content, and actual generated sound as separate checks.

## Feasibility checks completed

The existing `test_scores.py` passes on the supplied score, jazz-score, and melody fixtures. Its checks include score round-trip preservation, vocal-to-instrument conversion, removing vocals for backing, transposition, tempo edits, chord changes, and lyric sections.

A separate CPU-only probe changed the first melody note from E4 to F-sharp4 and shortened it from an eighth note to a sixteenth note. After native ABC serialization and re-parsing, the requested edit was exact. All other vocal notes, instrumental notes, chords, tempo, bars, keys, meters, and sections stayed unchanged. Evidence is saved in `work/yue2-note-edit-proof/report.json` and `edited-score.abc` at the repository root.

These checks establish that an event-based editor can connect to the existing score serializer. They do not establish how faithfully a live YuE2 render will realize every edit.

## Proposed implementation order

1. Expose the three cover modes, explicit harmony choice, reviewed lyrics, and an Open score action. Preserve the user's chosen model and explain unavailable actions.
2. Add validated note-event read/save operations and the piano roll, using the same draft as the sheet view and preview. Start with pitch, length, position, add/delete, and undo; add form editing after lyric synchronization is ready.
3. Verify authenticated renders for each mode with owned short recordings. Compare sung lyrics, intended notes/chords, instrumental leakage, retained-vocal quality, and alignment. Also test score error handling and the pinned runtime.
4. Return temporary takes with Audition, Accept, and Discard. Retain source audio and scores, effective inputs, actual model/decoder identity, truncation status, and alignment results.
5. Expand to standalone instrumentals, composition-before-render, and conversational score edits after the core workflows pass.

Keep vocal preservation distinct from musical re-performance throughout the flow. Users can then choose how much of the source they care about without needing to understand the underlying model pipeline.

## Hosting terms

YuE2's current license permits individual creators to monetize outputs, but distinguishes that from commercial use of its weights by companies. SheetSage2's published weights are also marked CC BY-NC 4.0. Check the exact checkpoints and supporting components before planning company commercial hosting. [YuE2 model terms](https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE), [SheetSage2 model card](https://huggingface.co/m-a-p/SheetSage2).
