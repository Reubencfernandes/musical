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
