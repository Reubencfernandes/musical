# Native GGUF engine

The app uses the real audio.cpp **C ABI 0.2** through Dart FFI in a background isolate. Pinned source: `542bb4ea2a18273e96b3237e5f1f6941df148d9f`. The runtime and weights are not bundled in Git.

## On the M2 Mac

Install Flutter, full Xcode, CMake, and the Ruby `xcodeproj` gem (`brew install cmake`; `gem install xcodeproj`). Open Xcode once and install iOS platform tools. From `flutter_app`:

```sh
flutter pub get
bash native/build_apple.sh macos
flutter run -d macos
bash native/build_apple.sh ios
open ios/Runner.xcworkspace
```

Choose your signing team and a unique bundle identifier in Xcode. Connect the iPhone with Developer Mode enabled, then use `flutter run -d <device-id>`. The script builds the pinned runtime, creates an arm64 framework for the selected Apple target, and adds its linking/embedding entries to Xcode. Simulator slices are not included. The native build and model inference must be validated on the Mac/iPhone; the Windows development environment cannot run Xcode.

Only the YuE2 and SheetSage2 model modules are selected. Parallel compilation is limited to two jobs for an 8 GB Mac. Do not run model inference and the build simultaneously on that machine.

## App Store Connect and TestFlight release

The iOS target links and embeds `native/artifacts/ios/Audiocpp.framework`. Run the native build before every archive (and again after changing the pinned engine), because the framework is intentionally ignored by Git:

```sh
cd flutter_app
flutter pub get
bash native/build_apple.sh ios
flutter build ipa --release --export-method app-store
```

The IPA is written to `build/ios/ipa/score_studio.ipa`; the archive used for upload is `build/ios/archive/Runner.xcarchive`. `build_apple.sh` updates the Xcode project through `link_ios.rb`, which adds the framework search path and ensures the embed phase runs before Flutter's `Thin Binary` phase. Do not remove or manually reorder those entries.

For an upload, sign in to Xcode with the Apple Developer account that owns `com.reubencf.scoreStudio`, then open the archive in Organizer:

```sh
open build/ios/archive/Runner.xcarchive
```

In Organizer select **Distribute App** → **App Store Connect** → **Upload**. The first upload creates or selects an App Store Connect record with a globally unique app name; this release uses **Kiku AI**. An Organizer status of “Uploaded to Apple” means Apple has accepted the binary, not that it is already testable: wait for App Store Connect processing to finish, then add the build to TestFlight and choose testers there.

The current native framework archive does not include a matching `Audiocpp.framework` dSYM. Upload is still accepted, but native crash reports will not be fully symbolicated until a matching dSYM is produced and uploaded.

## Other desktop platforms

With a C++17 compiler and CMake installed, clone the pinned audio.cpp revision into `native/external/audio.cpp`, then run:

```sh
cmake -S native -B native/build-desktop -DCMAKE_BUILD_TYPE=Release
cmake --build native/build-desktop --target audiocpp --config Release --parallel 2
flutter run --dart-define=AUDIOCPP_LIBRARY=/absolute/path/to/audiocpp.dll
```

Use the corresponding `.so`/`.dylib` filename on Linux/macOS. A system without a working native library reports an actionable error; it never substitutes simulated inference. Windows playback may require a just_audio Windows implementation; the primary supported integration target is iOS/macOS.

## Models and behavior

- YuE2 uses Q4_0 main weights + F16 VAE + pinned tokenizer/config sidecars, approximately 2.93 GB downloaded.
- SheetSage2 uses its complete original-dtype GGUF (including its backbone), approximately 2.71 GB downloaded.
- Downloads are explicitly user initiated, resumable, SHA-256 checked and only marked installed after verification. Existing partial files are retained on cancellation. Weights remain in app documents and are never committed.
- Inference uses Metal on Apple hardware by default; CPU is selectable. Backend failures are surfaced instead of silently uploading audio.
- A job loads one model, executes, saves files and releases all native handles before the next job can start. Transcription outputs ABC/events. Generation outputs a WAV and any ABC artifact. iOS audio import converts supported system audio formats to PCM WAV; other desktop targets accept WAV.
- The pinned adapters support **offline**, complete-result execution. Their C ABI provides no safe interruption/progress callbacks during the blocking run. UI stage updates and an elapsed timer stay responsive. Cancel requests discard the result at the next safe boundary, and the UI stays busy until resources are released. Cancellation does not promise immediate reduction of CPU/GPU load.
- True incremental waveform output is **not yet available** for these adapters. No fabricated percentages, fake audio chunks, fixed generation speed promises, or low-end-device guarantees are presented.

## Validation before claiming phone support

Run each model with real downloaded weights on the Mac and then the physical iPhone. Check output quality, peak memory, thermal state, elapsed time, app backgrounding, cancellation, and a second job after completion/error. Test airplane mode after downloading. Increase from a short test to full songs only when the device remains stable. A Q4 weight file alone does not ensure the full pipeline fits iOS memory limits.
