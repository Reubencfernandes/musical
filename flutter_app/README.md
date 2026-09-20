# Score Studio for native devices

Flutter UI with local YuE2 GGUF music generation and SheetSage2 GGUF transcription bindings. Uses audio.cpp in a worker isolate; no hosted inference service or Hugging Face login is used by this app.

## Start on your Mac

Install Flutter and full Xcode. Follow [native build instructions](native/README.md) to build and embed the pinned runtime before running the app. Download each model from inside the app, then create music from style/lyrics or import a recording for transcription. Model downloads require approximately 5.64 GB total disk space, plus temporary files and outputs. Runtime memory use is additional.

Generation produces a WAV that can be played, scrubbed and shared to another app. Transcription exports ABC notation and event data; the notation can condition another generation. The Flutter app does not yet render/edit staff notation or offer a multitrack editor. The existing web application remains separate.

## Model downloads on iPhone

iOS model downloads use native background URLSession transfers through `background_downloader` 9.5.5. All files in a model package are queued before waiting for completion, so locking the phone, switching apps, or leaving the studio screen does not cancel the transfer. Pause saves native resume data; Resume reconnects to the same task. On reopening, active transfers are reattached and completed files are verified before enabling inference. Explicitly paused downloads stay paused.

The download card shows saved progress and offers **Discard unfinished download**. Discard cancels the transfer and removes app-owned partial/staging files while keeping completed model files. Successful installation keeps one verified copy of each file; corrupt downloads are removed. Partial `.part` files from older builds are reused with HTTP Range requests. Checksum verification runs outside the UI isolate and may finish when the app returns to the foreground.

Force-quitting by swiping the app away is an iOS limitation: transfers may stop until the app is reopened. Resume depends on server support and the operating system retaining its temporary transfer data; if that data is unavailable, the affected file may need to restart. Completed files are reused. See [Apple's background transfer behavior](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)). Background inference is separate and is not implemented by this download change.

Validation: automated tests cover queue handoff, reconnecting without duplicate tasks, pause/restart/resume, legacy partial migration, checksum rejection, discard cleanup, and interrupted file assembly. An unsigned iOS release build compiles with the native plugin. Lock/unlock, prolonged network loss, and force-quit recovery still require physical-iPhone testing; these changes are not included in the previously uploaded build 1.

The orange musician animation uses fixed dot positions and smoothly changing radii, with a random saxophone, guitar, piano or drums performer. The theme follows the device.

## Checks

```sh
flutter pub get
flutter analyze
flutter test
flutter build web
dart run bin/native_smoke.dart /absolute/path/to/Audiocpp.framework/Audiocpp
```

Web builds show a native-app notice; browser builds cannot load this Dart FFI engine. Android native packaging is not implemented. iOS release packaging compiles with the native framework and downloader; physical-device inference and background lifecycle validation remain outstanding. Windows native compilation and ABI smoke checks do not establish phone compatibility.

Both upstream model adapters currently return complete offline results. Stage messages and the UI remain responsive, but playable audio chunks and immediate cancellation during native execution are not supported. A stop request waits for the next safe boundary. No real-model generation, phone memory fit or generation speed is certified by the automated tests. See [validation notes](../docs/mobile-inference.md).

## YouTube audio import

In **Transcribe**, paste a YouTube video link and select **Import YouTube audio**. The app fetches an audio-only MP4 track directly from YouTube, converts its first three minutes to PCM WAV, and selects it for **Create score**. Limits: finished videos up to 10 minutes, audio downloads up to 100 MB. Downloads require internet; inference remains local after import and model installation.

Uses `youtube_explode_dart` without cookies, a proxy, a hosted downloader or a desktop JavaScript process. YouTube can reject requests or change its stream APIs, so this is a best-effort import, not a guaranteed downloader. Failed/cancelled imports clean up partial files and preserve the previous selected recording. Upload remains available. iPhone/Mac conversion uses AVFoundation; Windows/Linux need FFmpeg on PATH. Android conversion remains pending.

`dart run bin/youtube_smoke.dart <video-url>` checks a real download and converts a ten-second validation excerpt on a desktop with FFmpeg. This command removes its temporary files. Apple native conversion still requires a Mac/iPhone build test.

Validation of the original implementation covered timeout/cancellation recovery. The original downloader stalled on the development network. See the September 2026 repair notes below for current validation.

## September 2026 phone repair

Keep audio.cpp for YuE2/SheetSage2; a llama.cpp Flutter binding is not a replacement for these model-specific audio pipelines. The reported device is an iPhone 15 Pro, closing after Create score or Generate music.

The pinned runtime used desktop-sized, `no_alloc` GGML metadata arenas: SheetSage2 defaults to a 1536 MiB decoder arena and multiplies that by eight for its encoder (12 GiB); YuE2 defaults to several 1.5–6 GiB contexts. `runtime_options.dart` now sets explicit 16 MiB weight metadata contexts and 128 MiB graph contexts (the native patch also removes SheetSage2's encoder multiplier). These do not cap tensor weights, GPU workspaces, or total process memory. They are a mitigation pending real-model validation, not proof that inference fits the phone. Audio duration is checked before float allocation and before model loading.

YouTube import tries iOS, Android VR and Android SDK-less manifests separately and requires actual audio bytes before choosing one. The app reads the CDN with the matching client user agent and bounded stream buffers, waits for disk writes, and propagates stream errors. Each mobile stream uses a single request because reusing its URL for further ranges can return HTTP 403. Cancellation releases a stalled lookup immediately; decoder failures are reported separately from download failures. Direct import remains dependent on YouTube allowing the request.

Tests cover HTTP ranges and full responses, invalid/truncated/oversized responses, cancellation and decoder errors. Phone crash logs and real-model inference still require a connected, unlocked device. Changes are local and are not in the existing TestFlight installation.

Repair validation on 2026-09-19: `flutter analyze` passes and all 33 tests pass. A real CDN probe received audio bytes, but subsequent complete live downloads were rejected with HTTP 403; end-to-end YouTube import is still unverified. The Mac's attempts to read the paired iPhone's crash logs failed to connect. Do not describe either feature as fixed on the phone until those checks succeed.

## Physical iPhone repair, 2026-09-20

Cable access confirmed two build-2 crashes with `EXC_BAD_ACCESS` in
`ggml_metal_buffer_is_shared` while uploading SheetSage2 encoder weights.
`native/patch_runtime.py` now propagates failed Metal allocations and cleans
up resources they owned. CMake applies this checked patch during configuration.

A first patched-device run stayed open and reported an encoder workspace
allocation failure (3652.97 MiB). SheetSage2's Metal encoder now uses the
runtime's existing non-causal flash attention implementation, and its metadata
context uses the configured 128 MiB directly instead of multiplying by eight.
A five-second excerpt of the phone's existing recording then completed in
28.5 seconds and produced nonempty ABC notation and note/chord events.
No generation-model or other-device performance claim follows from this test.

The full 111.16-second recording initially exposed an iOS GPU command-buffer
failure. The native patch now divides large graphs across up to eight command
buffers on iOS and caps the initial submission at 64 nodes. The full recording
then completed on the iPhone 15 Pro in 55.6 seconds, producing ABC notation and
note/chord events. The app disables auto-lock while inference runs and restores
the idle timer afterward. The repaired cable installation is build 3.

The physical-phone YouTube diagnostic reached both youtube.com and google.com
(HTTP 200), but stream access returned HTTP 403 or a bot/sign-in challenge.
Direct YouTube import is not verified working; failures are bounded and reported,
and local audio import/transcription is the verified path. These changes have
not been uploaded to TestFlight.
