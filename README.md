# Score Studio

Audio-to-score web application and a Flutter on-device music studio integration. The app name remains Score Studio; this repository is named `musical`.

Original project folder: `E:\ScoreStudio`.

## Quick start

The web app requires Node.js 24 and FFmpeg/ffprobe. From `outputs/score-studio`, run `npm ci`, copy `env.example` to `.env.local`, configure a private `SESSION_SECRET` and API/OAuth settings, then run `npm run dev`. Never commit credentials.

For Flutter, install the Flutter SDK, then run `flutter pub get`, `flutter analyze`, `flutter test`, and `flutter run` from `flutter_app`. Validated with Flutter 3.44.7 / Dart 3.12.2. iPhone builds require macOS, Xcode, and signing configured for your account.

## Mobile direction and current limits

The goal is on-device music generation/transcription, audio editing and export, retaining the orange dot-matrix musicians and existing visual style. See [mobile feasibility notes](docs/mobile-inference.md). Flutter now calls the pinned audio.cpp C API for YuE2 and SheetSage2 GGUF execution, with verified downloads and file export. Actual inference with model weights and Apple device builds still require validation. Incremental generated audio and the Flutter editor are not implemented. No low-end phone compatibility or generation speed is claimed.

Model weights are downloaded separately. YuE2 and SheetSage2 have their own noncommercial licenses; this repository does not relicense them. Soundfont attribution is in `outputs/score-studio/public/soundfonts/ATTRIBUTION.md`; font notices are in `outputs/score-studio/public/fonts/README.md`; bundled abcjs notices accompany the assets.

Development scripts in `work` may retain Windows-specific paths. Review them before use. Credentials, build caches and private test recordings are excluded.

## Existing application

- `outputs/score-studio`: Next.js web app, including the latest playback improvements.
- `outputs/score-studio-api`: Gradio ZeroGPU API.
- `outputs/sheetsage2-space`: original Gradio implementation.
- `work`: deployment and verification scripts.

Run the web app from `outputs/score-studio` with `npm ci`, then `npm run dev`.
The original C-drive copy is retained; an already-running localhost server may still use it.
Local environment settings are excluded from GitHub. Create your own `.env.local` from `env.example` and keep it private.

Live web app: https://reubencf-score-studio.hf.space/
API: https://reubencf-score-studio-api.hf.space/

## Flutter native studio

`flutter_app` includes model downloads, style/lyrics generation, recording transcription, local result playback/export, device light/dark theme, and the dot-matrix musicians. Follow [Flutter setup](flutter_app/README.md) and [Apple native build instructions](flutter_app/native/README.md). A normal Flutter build alone does not bundle the audio runtime. Browser builds show a native-app notice.

The integration prioritizes iOS/macOS. Android native packaging is pending. Neither phone performance nor universal low-end phone support has been validated.
