# Kiku model capability plan

Reviewed 1 October 2026. Scope: ACE-Step 1.5 and YuE2. This is a proposed product plan based on official documentation and local code inspection. Live inference, listening quality, deployment parity, and end-to-end reliability still need verification. No runtime or UI changes are part of this review.

The user's follow-up calls for three cover choices and a piano note editor. See [YuE2 covers and editable scores](yue2-cover-and-score-research.md) for detailed research, local feasibility evidence, and the proposed implementation. YuE2's role includes alternate backing and instrumental covers as well as new songs and score edits.

## Recommended roles

Use ACE-Step 1.5 for working directly with recorded audio: restyling, rewriting a selection, extending, and adding instruments. Use YuE2 for composing songs and rendering arrangements from an editable melody-and-chord score. Offer both for new songs and backing bands, then choose defaults from listening tests.

Keep two model choices in the main composer. The existing ACE-Step 1 entry is a legacy third option; move it out of the main choice after confirming that the newer engine covers the required workflows. This is a recommendation, not a removal made in this review.

ACE-Step's task support depends on its checkpoint. Our adapter uses Turbo for generation, covers, and repainting, and Base for instrument layers and band completion. Keep that routing internal. The upstream task table confirms that Turbo does not implement Base's lego, complete, or extract tasks. [Official ACE-Step task table](https://github.com/ace-step/ACE-Step-1.5#-model-zoo).

## Capability matrix

“Wired” means a local route and adapter exist. It does not mean the deployed workflow has passed listening tests.

| User action | ACE-Step 1.5 | YuE2 | Kiku status and boundary |
| --- | --- | --- | --- |
| Create a song with lyrics | Text-to-music, with an optional language-model planning stage | Style and lyrics, optionally conditioned on a score | Both wired. Compare lyric accuracy, structure, endings, and quality. |
| Create instrumental music | Text-to-music | The current official workflow converts a planned vocal melody into an instrumental score before rendering | ACE wired. YuE2 instrumental covers already have a local adapter; standalone instrumental generation needs integration and runtime verification. |
| Restyle a recording | Audio-conditioned cover | Transcribe the recording, review the score, and render a new interpretation | Both workflows wired under different actions. They have different inputs and preservation limits. |
| Rewrite a selected passage | Repaint with surrounding audio context | Edit the composition and render a new recording | ACE wired. YuE2 is not an equivalent audio punch-in editor. |
| Extend a clip | Our adapter repaints beyond the source ending | A longer edited score could produce a new full recording | ACE wired, continuity unverified. No equivalent YuE2 continuation route exists. |
| Add drums, bass, or another part to existing audio | Base lego task | No dedicated source-audio instrument-layer workflow in our adapter | ACE wired. Test musical alignment and unwanted extra instruments. |
| Add backing under the user's recorded voice | Base complete, then separation and mixing | Transcribed chords/form, score rendering, then alignment and mixing | Both wired. Keeping the singer comes from retaining the original vocal, not generating the same voice. |
| Change chords, key, or tempo through a score | Not exposed as an explicit note-and-chord editing workflow | Supply an edited ABC score | YuE2 wired for transpose, tempo, and chord edits. Detailed note/form editing is a later expansion. |
| Split existing audio into stems | Upstream Base has extract, which our adapter does not expose | Not the studio's stem-separation engine | Kiku currently uses Demucs for vocals, drums, bass, and other. This is a separate tool. |

YuE2's official workflow supports song creation, score-conditioned covers, and instrumental score conversion. It can preserve composition constraints in a score while producing a different performance. [Official YuE2 workflows](https://github.com/multimodal-art-projection/YuE).

For score edits, matching unchanged notes does not guarantee identical singing, sound, or audio outside the edited passage. Preserve the source and present the render as another version. [Official editing guide](https://github.com/multimodal-art-projection/YuE/blob/main/docs/editing.md).

## Findings in the current app

- `lib/studio/models.ts` presents three models, excludes YuE2 from standalone instrumental generation, and describes band timing and melody preservation too confidently. Replace those claims with measured behavior after testing.
- The frontend `modelFor` helper can switch to another supported model when the action changes. Server routes reject unsupported choices. Make the selection visibly match the model that will run, with a short explanation when a choice becomes unavailable.
- `useJobs.ts` places generated results immediately, including replacement edits. Add a temporary take with Audition, Accept, and Discard before making generation part of the project. Capture the original selection and project version so a delayed result cannot overwrite intervening edits.
- YuE2 timing alignment is additional Kiku processing. If bar matching fails, the engine places the result from the first bar; it has not proved alignment. Surface that outcome before acceptance.
- Guitar, keys, strings, and synth parts are filtered through Demucs's shared “other” stem. That does not establish isolated instrument purity. Listen for other instruments and reference leakage.
- Shared request fields do not always have the same effect. For example, the ACE 1.5 adapter accepts repaint variance and band strength but ignores them. Only expose controls with an implemented, verified effect.
- The merged engine pins `yue2_infer` 0.1.5 from a fixed archive. Current upstream documentation describes a newer runtime. Establish compatibility before using new APIs; pin both model and decoder revisions for comparisons. [Official generation and reproducibility guide](https://github.com/multimodal-art-projection/YuE/blob/main/docs/generation.md).

The relevant local sources are `components/studio/useJobs.ts`, `lib/studio/models.ts`, `lib/studio-route.ts`, `app/api/*`, `../kiku-acestep15-space/app.py`, and `../kiku-engine-space/app.py` and `requirements.txt`.

## Composer behavior

Keep the compact composer requested by the user, with Style and AI selectors and no general Settings section.

1. Choose the action: New song, Instrumental, Add part, Add band, Restyle, Rewrite, Extend, or Cover melody.
2. Show the inputs needed for that action: instrument for a part, lyrics for a song, or a recording/selection for an audio action.
3. Offer models verified for that action. Style is a prompt preset with editable text; it is not a separate model or a quality guarantee.
4. Under Cover, offer “New AI performance,” “Keep my vocals,” and “Instrumental melody.” Route each to its appropriate pipeline. Offer “Keep chords” or “New harmony” where supported, plus an Open score action. Make clear whether the recorded vocal is retained or a new performance is generated.
5. Return a playable take, identify the actual model used, and let the user accept or discard it. Warn about a detected truncation or failed alignment in the result itself.

Score controls can open from the relevant cover/composition action. They do not require restoring a general Settings panel. Stem separation and transcription remain available as independent tools.

## Order of work and release gates

### 1. Verify the engines

Inventory the deployed endpoints, checkpoints, decoder, package versions, task variants, limits, and returned artifacts. Mark each capability as documented, wired, or verified. Maintain one capability definition used by both the API and composer.

Start with owned short recordings: a dry vocal, a vocal with backing, a steady instrumental, and a performance with changing tempo. Use the same inputs and brief for both band engines. Run three seeds for each initial supported workflow and retain failures. Test longer selections only after the short workflows succeed.

Check lyric intelligibility, melody and harmony, unwanted vocals, instrument leakage, tempo drift, edit boundaries, clean endings, and truncation. For rewrite, verify that Kiku preserves audio outside the selected interval. For a band, compare the retained vocal with the input and listen to the generated backing alone. For YuE2, inspect the score and listen to the actual realization separately.

Record upload, queue, cold start, generation, post-processing, and download time separately. Publish no fixed speed claims before measuring the deployed path. Use listening results to select the default band engine.

### 2. Make results reviewable

Implement take audition/accept/discard, saved provenance, correct selection placement, undo, and stale-result handling. Keep original audio and score versions. Save effective prompts, seeds, checkpoint identities, and relevant processing reports. Verify failure and cancellation behavior, and ensure exported audio matches the accepted take.

### 3. Align the composer with verified capabilities

Use the shared capability definition for the two model choices, supported actions, required inputs, duration bounds, and meaningful controls. Test model changes, keyboard operation, mobile layout, and signed-in submission. Release a workflow only when an authenticated request completes, its downloadable output is playable, and its advertised behavior passes the checks above.

### 4. Expand composition control

Integrate standalone YuE2 instrumentals, richer score review, note/form editing, and optional multi-take comparisons after the core workflows pass. Treat voice personalization, automatic lyric writing, arbitrary instrument extraction, and conversational score editing as separate integrations requiring their own verification.

## Licensing decision

ACE-Step 1.5's published model cards identify MIT licensing. [Turbo bundle](https://huggingface.co/ACE-Step/Ace-Step1.5), [Base checkpoint](https://huggingface.co/ACE-Step/acestep-v15-base).

YuE2's current weights use CC BY-NC 4.0 with additional permission for individual creators to monetize outputs. Those terms distinguish individual output monetization from commercial use of the model weights by companies, for which the authors request a commercial license. Confirm the applicable permission before planning commercial company hosting. Also check the exact bundled runtime and supporting-model licenses. [Official model license](https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE).

The next concrete step is the engine verification matrix and a retained listening set. Those results should determine the next UI changes.
