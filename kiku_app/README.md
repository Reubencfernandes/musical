# Kiku AI for phones and Macs

<img src="assets/kiku-mark.png" width="72" alt="Kiku AI mark" align="right">

A Flutter version of the [Kiku AI web app on Hugging Face](https://huggingface.co/spaces/Reubencf/Kiku-AI):
the same five places, the same engines, and the same library in your Hugging Face account.

| Place | What it does |
| --- | --- |
| **Home** | Type an idea, tap **Create**, and the song starts in Generate. Shortcuts to the other places and your recent songs. |
| **Generate** | **Simple** (one-line idea; ACE-Step's planner writes the style and lyrics) or **Custom** (your style and lyrics, section tags, **Enhance**). ACE-Step 1.5 or YuE2, instrumental switch, length. Songs show live queue and progress, get DreamLite cover art, and can be renamed, shared, opened in the studio or deleted. |
| **Studio** | A small multitrack editor: import or record audio, mute/solo/volume/pan per track, split, undo/redo, WAV export. Select a clip, or long-press and drag across one, then **Restyle**, **Rewrite**, **Extend**, **Cover** (YuE2), **Stems** (Demucs) or **Lyrics**. With nothing selected, **Add instrument** (drums, bass, keys, guitar, strings, synth, full band), **Instrumental** or **Song**. Results arrive as takes under their source and can be switched on and off. |
| **Score** | Choose or record a recording (5 s to 10 min) and SheetSage2 writes a lead sheet. It is drawn with abcjs and the web app's own layout code, and the current bar follows the recording as it plays; tap a bar to jump there. Share the PDF, MIDI, MusicXML, ABC or every file. |
| **Library** | Songs, studio projects and scores, kept in the private dataset `<you>/kiku-ai-library` that the web app uses, so work moves freely between phone and browser. |

The bottom player, light and dark themes (following the device or chosen in Settings), the
Supreme and Bespoke Stencil fonts, the orange dot-matrix musicians and the new Kiku mark all
match the web app.

## How it connects

The app calls the deployed services directly, from your own connection and with your own
Hugging Face token:

- **Kiku AI** (`https://reubencf-kiku-ai.hf.space`): ACE-Step 1.5 and YuE2 on private Modal
  GPUs, the Simple-mode planner, Enhance and DreamLite covers. The app sends your token as a
  bearer header; the server checks it with Hugging Face.
- **Kiku Engine** (`https://reubencf-kiku-engine.hf.space`): SheetSage2 transcription, Demucs
  stems, lyrics and ACE-Step 1, on your Hugging Face ZeroGPU allowance.
- **Hugging Face Hub**: your library dataset.

Both addresses can be changed under **Settings → Servers**, for a fork or a local server.

> The bearer-token support and the app's sign-in redirect are in this repository's web app
> (`outputs/kiku-ai`). Redeploy the Kiku-AI Space (`work/deploy_kiku_app.py`) before using the
> app against it.

### Signing in

- **Sign in with Hugging Face** opens Hugging Face in the system's secure sign-in sheet and comes
  back through `kikuai://oauth/callback` (authorization code with PKCE, using the web app's
  OAuth client `https://reubencf-kiku-ai.hf.space/oauth/client`). It asks for the same scopes
  as the web app: your profile, and permission to keep your music in a private dataset.
- **Use an access token instead** works everywhere: create a token at
  [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (write access lets the
  app save to your library) and paste it.

Tokens are kept in the device's secure storage (Keychain or Android Keystore). If a device
refuses, the app says so and keeps you signed in until it closes.

## Run it

Install Flutter (tested in CI with 3.44.7), then from `kiku_app`:

```sh
flutter pub get
flutter run            # pick an Android phone, iPhone, simulator or macOS
```

Checks:

```sh
flutter analyze
flutter test
flutter build apk --release        # Android, signed with the debug key for testing
flutter build ios --no-codesign    # needs macOS and Xcode; sign in Xcode to install
flutter build macos
```

GitHub Actions runs the same checks on every change to `kiku_app/`
([workflow](../.github/workflows/kiku-app.yml)) and keeps the Android APK as a downloadable
artifact of each run.

## Audio on the device

Studio buffers are 16-bit audio at 44.1 kHz and the studio plays a rendered mix, so tracks stay
sample-locked. WAV and FLAC are read in Dart; MP3, M4A, OGG and the rest go through
AVFoundation (iOS, macOS) or MediaCodec (Android), or FFmpeg on other desktops. Songs and scores
are saved as FLAC (Dart encoder, checked in CI against the reference `flac` tool) with their
file named in the library JSON; the web app plays them too. Studio projects keep WAV per buffer,
exactly like the web studio.

## Limits

- Audio sent from the studio is 3 seconds to 4 minutes (stems up to 6 minutes, covers and lyrics
  up to 5); transcription takes 5 seconds to 10 minutes.
- Sheet music is drawn on Android, iOS and macOS. Elsewhere the score is shown as ABC text.
- The studio has no clip dragging or trimming yet; split, delete, undo, takes and the mixer are there.
- Each generation runs while the app is open. Closing the app stops waiting for it; a Modal job
  that nobody follows is cancelled after two minutes.
- YuE2, SheetSage2 and DreamLite-base are CC BY-NC 4.0 (non-commercial). ACE-Step is Apache 2.0,
  Demucs MIT, abcjs MIT. Supreme and Bespoke Stencil are by Indian Type Foundry via Fontshare.

## Layout

```
lib/
  main.dart, services.dart, config.dart
  auth/      Hugging Face sign-in (PKCE or token) and the sign-in screen
  api/       Gradio client, Kiku server client (Modal jobs), job routing, Hub client, library
  audio/     PCM buffers, WAV and FLAC codecs, platform decoding, waveforms
  studio/    project model (same JSON as the web studio), controller, screen, AI sheets
  songs/     Generate: controller, screen, song rows
  score/     Score: controller, screen, abcjs sheet view
  library/, home/, shell/ (navigation, player, settings), ui/ (theme, logo, widgets)
assets/score/  abcjs, the web app's engrave.js (tool/score_assets.sh rebuilds it), the page
```

The launcher icons and `lib/ui/logo_dots.g.dart` come from `branding/generate.py`.
