// Opt-in entry point for physical-device validation. Never used by main.dart.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'inference/inference_service.dart';
import 'inference/wav.dart';
import 'imports/youtube_import.dart';
import 'imports/audio_converter.dart';
import 'score/score_page.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final status = ValueNotifier('Preparing a short local transcription test…');
  final navigator = GlobalKey<NavigatorState>();
  runApp(
    MaterialApp(
      navigatorKey: navigator,
      theme: ThemeData.dark(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ValueListenableBuilder(
              valueListenable: status,
              builder: (_, value, _) => SelectableText(value),
            ),
          ),
        ),
      ),
    ),
  );
  final root = await getApplicationDocumentsDirectory();
  final diagnostic = Directory('${root.path}/diagnostics');
  await diagnostic.create(recursive: true);
  final report = File('${diagnostic.path}/probe.json');
  final events = <Map<String, dynamic>>[];
  void record(Map<String, dynamic> event) {
    events.add(event);
    status.value =
        (event['message'] ??
                event['stage'] ??
                (event['type'] == 'probe_finished'
                    ? 'Test complete. Success: ${event['success']}'
                    : event['type']))
            .toString();
    // Persist each stage so a native termination leaves useful evidence.
    report.writeAsStringSync(jsonEncode(events), flush: true);
    debugPrint('DEVICE_PROBE ${jsonEncode(event)}');
  }

  try {
    if (Platform.isIOS) {
      await const MethodChannel(
        'score_studio/audio',
      ).invokeMethod<void>('keepAwake', true);
    }
    if (const bool.fromEnvironment('PROBE_SCORE')) {
      // Shows the newest saved transcription in the real score view.
      final scores = await diagnostic
          .list(recursive: true)
          .where((e) => e is File && e.path.endsWith('/score.abc'))
          .cast<File>()
          .toList();
      scores.sort((a, b) => a.path.compareTo(b.path));
      if (scores.isEmpty) throw StateError('No saved score to show');
      final abc = await scores.last.readAsString();
      record({'type': 'score', 'message': 'Opening ${scores.last.path}'});
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => ScorePage(
              abc: abc,
              title: 'My recording',
              onReady: (build) async {
                try {
                  for (final kind in ['pdf', 'mid']) {
                    final made = await build(kind);
                    await made.copy('${diagnostic.path}/score.$kind');
                    record({
                      'type': 'export',
                      'message': '$kind: ${await made.length()} bytes',
                    });
                  }
                } catch (e) {
                  record({'type': 'probe_error', 'message': 'export: $e'});
                }
              },
            ),
          ),
        ),
      );
      return;
    }
    const configuredYoutube = String.fromEnvironment('PROBE_YOUTUBE_URL');
    final youtubeUrl = configuredYoutube.isNotEmpty
        ? configuredYoutube
        : Platform.environment['SCORE_PROBE_YOUTUBE_URL'];
    if (youtubeUrl != null && youtubeUrl.isNotEmpty) {
      for (final url in ['https://www.youtube.com', 'https://www.google.com']) {
        final client = HttpClient()
          ..connectionTimeout = const Duration(seconds: 10);
        try {
          final request = await client
              .getUrl(Uri.parse(url))
              .timeout(const Duration(seconds: 10));
          final response = await request.close().timeout(
            const Duration(seconds: 10),
          );
          record({
            'type': 'network',
            'url': url,
            'status': response.statusCode,
          });
        } catch (error) {
          record({'type': 'network', 'url': url, 'error': error.toString()});
        } finally {
          client.close(force: true);
        }
      }
      final imported = await YoutubeImporter().import(
        youtubeUrl,
        diagnostic,
        convertYoutubeAudio,
        (stage, progress) =>
            record({'type': 'import', 'stage': stage, 'progress': progress}),
      );
      record({
        'type': 'probe_finished',
        'success': true,
        'audio': imported.path,
      });
      return;
    }
    if (const bool.fromEnvironment('PROBE_GENERATE')) {
      final models = await Directory('${root.path}/models/yue2')
          .list(recursive: true)
          .where((e) => e is File && e.path.endsWith('yue2-3b-q4_0.gguf'))
          .cast<File>()
          .toList();
      if (models.length != 1)
        throw StateError('Expected one installed YuE2 model');
      final engine = InferenceService();
      final sub = engine.events.stream.listen(record);
      try {
        await engine.run({
          'family': 'yue2',
          'model': models.single.parent.path,
          'backend': 'metal',
          'style': const String.fromEnvironment('PROBE_PROMPT') == ''
              ? 'gentle acoustic folk, solo guitar, soft voice'
              : const String.fromEnvironment('PROBE_PROMPT') == 'jrock'
              ? 'Japanese alternative rock, emo, post-hardcore, powerful emotional male vocal, distorted electric guitars, driving drums, fast tempo, anthemic chorus'
              : 'J-pop, bright female vocal, upbeat, synth, electric guitar, energetic, catchy',
          'lyrics': switch (const String.fromEnvironment('PROBE_PROMPT')) {
            'jpop' =>
              '[verse]\nNeon rain on the station line\nI keep your voice in my pocket tonight\n\n[chorus]\nHikari, run with me\nThrough the city lights, we are free',
            'jrock' =>
              '[verse]\nI carved your name in the static of the night\nEvery word I swallowed turns to fire inside\nThe clock is breaking, the walls are paper thin\nI am done pretending this is how it ends\n\n'
                  '[chorus]\nSo scream it out, we are not over yet\nTear the silence, no more regret\nEven if the sky comes crashing down\nI will find you in the sound\n\n'
                  '[verse]\nFootsteps echo where we used to run\nShadows burning in the rising sun',
            'jpop_full' =>
              '[verse]\nNeon rain on the station line\nI keep your voice in my pocket tonight\nLast train hums a lullaby\nAnd every window is a little sky\n\n'
                  '[chorus]\nHikari, run with me\nThrough the city lights, we are free\nHold my hand, count to three\nTomorrow starts with you and me\n\n'
                  '[verse]\nPaper stars on a vending machine\nYour laugh is louder than the summer heat\nWe trade our secrets for melon soda\nAnd dance like nobody told us it is over\n\n'
                  '[chorus]\nHikari, run with me\nThrough the city lights, we are free\nHold my hand, count to three\nTomorrow starts with you and me\n\n'
                  '[bridge]\nIf the morning takes the colors away\nI will paint them back in your name\n\n'
                  '[chorus]\nHikari, stay with me\nEvery heartbeat is a melody\nHold my hand, count to three\nTomorrow starts with you and me',
            _ =>
              '[verse]\nMorning light across the sea\nCarry this small song with me',
          },
          'abc': '',
          'abc_max_tokens': const String.fromEnvironment('PROBE_ABC_TOKENS'),
          'semantic_max_tokens': const String.fromEnvironment(
            'PROBE_SEMANTIC_TOKENS',
          ),
          'output':
              '${diagnostic.path}/generation-${DateTime.now().microsecondsSinceEpoch}',
        });
        record({
          'type': 'probe_finished',
          'success': events.any((e) => e['type'] == 'done'),
        });
      } finally {
        await sub.cancel();
        await engine.events.close();
      }
      return;
    }
    // A pushed Documents/probe-input.* exercises the picker's real import path:
    // the platform decoder, the three-minute excerpt and the WAV reader.
    final pushed = await root
        .list()
        .where(
          (e) =>
              e is File && e.uri.pathSegments.last.startsWith('probe-input.'),
        )
        .cast<File>()
        .toList();
    if (pushed.isNotEmpty) {
      final decoded = '${root.path}/import-probe.wav';
      await const MethodChannel('score_studio/audio').invokeMethod<String>(
        'decode',
        {'path': pushed.first.path, 'output': decoded},
      );
      record({'type': 'decoded', 'message': 'Decoded ${pushed.first.path}'});
    }
    final recordings = await root
        .list()
        .where((e) => e is File && e.path.endsWith('.wav'))
        .cast<File>()
        .toList();
    recordings.sort((a, b) => a.path.compareTo(b.path));
    if (recordings.isEmpty) {
      throw StateError('No previously imported recording');
    }
    final models = await Directory('${root.path}/models/sheetsage2')
        .list(recursive: true)
        .where((e) => e is File && e.path.endsWith('.gguf'))
        .cast<File>()
        .toList();
    if (models.length != 1) {
      throw StateError('Expected one installed SheetSage2 model');
    }
    final wav = WavAudio.decode(await recordings.last.readAsBytes());
    final frames = (wav.samples.length ~/ wav.channels).clamp(
      0,
      const bool.fromEnvironment('PROBE_FULL_AUDIO') ||
              Platform.environment['SCORE_PROBE_FULL_AUDIO'] == '1'
          ? wav.samples.length ~/ wav.channels
          : wav.sampleRate * 5,
    );
    record({
      'type': 'input',
      'message': 'Testing ${frames / wav.sampleRate} seconds of saved audio',
      'seconds': frames / wav.sampleRate,
    });
    final clip = File('${diagnostic.path}/clip.wav');
    final bytes = wavHeader(frames, wav.sampleRate, wav.channels);
    final output = await clip.open(mode: FileMode.write);
    await output.writeFrom(bytes);
    await output.close();
    // Write PCM16 from the same saved recording through a bounded buffer.
    final pcm = Uint8List(frames * wav.channels * 2);
    final view = ByteData.sublistView(pcm);
    for (var i = 0; i < frames * wav.channels; i++) {
      final value = (wav.samples[i].clamp(-1, 1) * 32767).round();
      view.setInt16(i * 2, value, Endian.little);
    }
    await clip.writeAsBytes(pcm, mode: FileMode.append);
    final engine = InferenceService();
    final sub = engine.events.stream.listen(record);
    try {
      await engine.run({
        'family': 'sheetsage2',
        'model': models.single.path,
        'audio': clip.path,
        'backend': const String.fromEnvironment(
          'PROBE_BACKEND',
          defaultValue: 'metal',
        ),
        'output':
            '${diagnostic.path}/run-${DateTime.now().microsecondsSinceEpoch}',
      });
      record({
        'type': 'probe_finished',
        'success': events.any((e) => e['type'] == 'done'),
      });
    } finally {
      await sub.cancel();
      await engine.events.close();
    }
  } catch (error) {
    record({'type': 'probe_error', 'message': error.toString()});
  } finally {
    if (Platform.isIOS) {
      await const MethodChannel(
        'score_studio/audio',
      ).invokeMethod<void>('keepAwake', false);
    }
  }
}
