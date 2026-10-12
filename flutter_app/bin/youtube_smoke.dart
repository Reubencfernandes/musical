import 'dart:io';
import 'dart:async';
import 'package:score_studio/imports/youtube_import.dart';
import 'package:score_studio/inference/wav.dart';

// Downloads the supplied public video, converts a 10-second test excerpt,
// validates PCM data, then deletes the temporary test files. Requires FFmpeg.
Future<void> main(List<String> args) async {
  final root = await Directory.systemTemp.createTemp('score-youtube-smoke-');
  String lastStage = '';
  final ticker = Timer.periodic(
    const Duration(seconds: 10),
    (_) => stdout.writeln('Waiting for YouTube...'),
  );
  try {
    final result =
        await YoutubeImporter(
          lookupTimeout: const Duration(seconds: 15),
        ).import(
          args.single,
          root,
          (input, output) async {
            final run = await Process.run('ffmpeg', [
              '-nostdin',
              '-v',
              'error',
              '-y',
              '-i',
              input,
              '-t',
              '10',
              '-vn',
              '-ac',
              '1',
              '-ar',
              '44100',
              '-c:a',
              'pcm_s16le',
              output,
            ]);
            if (run.exitCode != 0) throw StateError('FFmpeg conversion failed');
          },
          (stage, progress) {
            if (stage != lastStage) {
              stdout.writeln(stage);
              lastStage = stage;
            }
          },
        );
    final wav = WavAudio.decode(await File(result.path).readAsBytes());
    if (wav.samples.isEmpty) throw StateError('Empty audio');
    stdout.writeln('PASS: YouTube audio downloaded and converted to PCM WAV.');
  } finally {
    ticker.cancel();
    await root.delete(recursive: true);
  }
}
