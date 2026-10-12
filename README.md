# Kiku AI

A web application for turning a recording into notation and building a full song around it, plus a Flutter on-device music studio integration. The web app was formerly called Score Studio; notation remains one of its modes. This repository is named `musical`.

Original project folder: `E:\ScoreStudio`.

## Quick start

The web app requires Node.js 24 and FFmpeg/ffprobe. From `outputs/kiku-ai`, run `npm ci`, copy `env.example` to `.env.local`, configure a private `SESSION_SECRET` and API/OAuth settings, then run `npm run dev`. Never commit credentials.

For Flutter, install the Flutter SDK, then run `flutter pub get`, `flutter analyze`, `flutter test`, and `flutter run` from `flutter_app`. Validated with Flutter 3.44.7 / Dart 3.12.2. iPhone builds require macOS, Xcode, and signing configured for your account.

## Mobile direction and current limits

The goal is on-device music generation/transcription, audio editing and export, retaining the orange dot-matrix musicians and existing visual style. See [mobile feasibility notes](docs/mobile-inference.md). Flutter now calls the pinned audio.cpp C API for YuE2 and SheetSage2 GGUF execution, with verified downloads and file export. Actual inference with model weights and Apple device builds still require validation. Incremental generated audio and the Flutter editor are not implemented. No low-end phone compatibility or generation speed is claimed.

Model weights are downloaded separately. YuE2 and SheetSage2 have their own noncommercial licenses; this repository does not relicense them. Soundfont attribution is in `outputs/kiku-ai/public/soundfonts/ATTRIBUTION.md`; font notices are in `outputs/kiku-ai/public/fonts/README.md`; bundled abcjs notices accompany the assets.

Development scripts in `work` may retain Windows-specific paths. Review them before use. Credentials, build caches and private test recordings are excluded.

## Deployed architecture

ZeroGPU only supports the Gradio SDK, so inference lives in Gradio Spaces and the interface is
a separate CPU Docker Space. ACE-Step 1.5 needs Python 3.11 and Gradio 6, which cannot share the
engine's stack, so it has its own Space with the same endpoint names:

| Space | SDK | Holds |
| --- | --- | --- |
| [Kiku-Engine](https://huggingface.co/spaces/Reubencf/Kiku-Engine) | Gradio + ZeroGPU | SheetSage2, YuE2, ACE-Step, Demucs, and the OAuth client |
| [Kiku-ACE-Step-15](https://huggingface.co/spaces/Reubencf/Kiku-ACE-Step-15) | Gradio 6 + ZeroGPU | ACE-Step 1.5 (turbo, base and the 1.7B planner) and Demucs |
| [Kiku-AI](https://huggingface.co/spaces/Reubencf/Kiku-AI) | Docker (CPU) | The Next.js interface |

Sources: `outputs/kiku-engine-space`, `outputs/kiku-acestep15-space` and `outputs/kiku-ai`. Deploy with
`work/deploy_kiku_spaces.py` and `work/deploy_kiku_app.py` (both read `HF_TOKEN`).

The ACE-Step 1.5 Modal backend is deployed in the active `konkanillm`
workspace. Source, setup commands, and measured cold/warm timings are in
[the Modal deployment notes](outputs/kiku-modal/README.md) and
[the trial report](outputs/kiku-modal/TEST_RESULTS.md). It uses one L40S worker with private
API access, CPU memory snapshots, and scale-to-zero. The web app routes ACE-Step
1.5 generation and planning through authenticated server routes to Modal.
YuE2 now runs on its own private Modal L40S worker (`kiku-yue2`), using the native
PyTorch runtime and CPU import snapshots. Generate allows choosing YuE2 or
ACE-Step 1.5 in both Simple and Custom mode. SheetSage2, ACE-Step 1 and
standalone stem/lyrics jobs still use Hugging Face.

`outputs/score-studio-api`, `outputs/kiku-yue2-space` and `outputs/kiku-acestep-space` are the
superseded single-model Spaces, kept until the merged engine has run in earnest.
`outputs/sheetsage2-space` is the original Gradio implementation. `work` holds deployment and
verification scripts.

### How three models share one Space

They pin conflicting versions — transformers 4.45.2 (SheetSage2), 4.50.0 (ACE-Step) and 4.57.6
(YuE2) — so pip cannot satisfy all three. The YuE2 wheel's stack wins and the other two run on
it; `acestep` installs with `--no-deps` at startup and its real inference imports are listed in
`requirements.txt`. `torchaudio` and `torchvision` must stay pinned to the torch 2.10.0 pair, or
pip takes CUDA 13 builds that cannot load against CUDA 12 torch.

Each model loads on first use, not at import: YuE2 reaches low-level CUDA init while
constructing, which ZeroGPU refuses outside a `@spaces.GPU` function. SheetSage2 additionally
merges LoRA adapters during load and accepts only CPU float32, so it is cast on the way to
the GPU.

### Keeping the user's voice

`/accompany` never re-sings the user. It lifts the voice off any backing already on the take
(Demucs), measures the beat grid and per-bar chords (from the old backing when there is one),
synthesises a plain guide track on them, and has ACE-Step's audio2audio restyle that guide into
the requested band before mixing it under the voice. ACE-Step treats a tempo in the prompt as a
loose hint but follows audio closely, which is why the guide is needed. `Singing2Accompaniment`
is still unreleased, so the band follows beat and chords, not phrasing.

YuE2 keeps a tune by working from a score, not the sound: SheetSage2 reads a stretch's melody,
chords and bar lines, the user can edit that score, YuE2 plays it (a cover, sung or on an
instrument, or a band on the take's chords), and the render is time-warped bar by bar onto the
recording's own bar lines so it stays in sync with the rest of the project.

The web app's `/studio` is a multitrack editor built around these endpoints: selections of a
clip, several clips or a stretch of time can be restyled, rewritten, extended, split into stems,
or given a band, and single instruments can be added to follow the project.

YuE2 and SheetSage2 are CC BY-NC 4.0 (non-commercial); ACE-Step is Apache 2.0 and Demucs is MIT.
Hosting more than two ZeroGPU Spaces on one account requires PRO.
Live web app: https://reubencf-score-studio.hf.space/ (to be redeployed as Kiku AI)
Transcription API: https://reubencf-score-studio-api.hf.space/
Generation Spaces are in `outputs/kiku-yue2-space` and `outputs/kiku-acestep-space`; neither is deployed yet.

## Flutter native studio

`flutter_app` includes model downloads, style/lyrics generation, recording transcription, local result playback/export, device light/dark theme, and the dot-matrix musicians. Follow [Flutter setup](flutter_app/README.md) and [Apple native build instructions](flutter_app/native/README.md). A normal Flutter build alone does not bundle the audio runtime. Browser builds show a native-app notice.

The integration prioritizes iOS/macOS. Android native packaging is pending. Neither phone performance nor universal low-end phone support has been validated.
