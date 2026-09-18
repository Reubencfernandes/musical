# Score Studio for native devices

Flutter UI with local YuE2 GGUF music generation and SheetSage2 GGUF transcription bindings. Uses audio.cpp in a worker isolate; no hosted inference service or Hugging Face login is used by this app.

## Start on your Mac

Install Flutter and full Xcode. Follow [native build instructions](native/README.md) to build and embed the pinned runtime before running the app. Download each model from inside the app, then create music from style/lyrics or import a recording for transcription. Model downloads require approximately 5.64 GB total disk space, plus temporary files and outputs. Runtime memory use is additional.

Generation produces a WAV that can be played, scrubbed and shared to another app. Transcription exports ABC notation and event data; the notation can condition another generation. The Flutter app does not yet render/edit staff notation or offer a multitrack editor. The existing web application remains separate.

The orange musician animation uses fixed dot positions and smoothly changing radii, with a random saxophone, guitar, piano or drums performer. The theme follows the device.

## Checks

```sh
flutter pub get
flutter analyze
flutter test
flutter build web
dart run bin/native_smoke.dart /absolute/path/to/Audiocpp.framework/Audiocpp
```

Web builds show a native-app notice; browser builds cannot load this Dart FFI engine. Android native packaging is not implemented. Apple framework packaging is provided but needs Xcode/device validation. Windows native compilation and ABI smoke checks do not establish phone compatibility.

Both upstream model adapters currently return complete offline results. Stage messages and the UI remain responsive, but playable audio chunks and immediate cancellation during native execution are not supported. A stop request waits for the next safe boundary. No real-model generation, phone memory fit or generation speed is certified by the automated tests. See [validation notes](../docs/mobile-inference.md).

## YouTube audio import

In **Transcribe**, paste a YouTube video link and select **Import YouTube audio**. The app fetches an audio-only MP4 track directly from YouTube, converts its first three minutes to PCM WAV, and selects it for **Create score**. Limits: finished videos up to 10 minutes, audio downloads up to 100 MB. Downloads require internet; inference remains local after import and model installation.

Uses `youtube_explode_dart` without cookies, a proxy, a hosted downloader or a desktop JavaScript process. YouTube can reject requests or change its stream APIs, so this is a best-effort import, not a guaranteed downloader. Failed/cancelled imports clean up partial files and preserve the previous selected recording. Upload remains available. iPhone/Mac conversion uses AVFoundation; Windows/Linux need FFmpeg on PATH. Android conversion remains pending.

`dart run bin/youtube_smoke.dart <video-url>` checks a real download and converts a ten-second validation excerpt on a desktop with FFmpeg. This command removes its temporary files. Apple native conversion still requires a Mac/iPhone build test.

Validation: 15 automated tests pass, including timeout/cancellation recovery. A live test of the supplied YouTube link reached stream selection but the audio download stalled on the development network; end-to-end YouTube success and Apple conversion are not yet verified.
