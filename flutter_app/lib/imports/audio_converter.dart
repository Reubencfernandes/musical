import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';

Future<void> convertYoutubeAudio(String source, String output) async {
  if (Platform.isIOS || Platform.isMacOS) {
    await const MethodChannel('score_studio/audio').invokeMethod<String>(
      'decode',
      {'path': source, 'output': output, 'excerpt': true},
    );
    return;
  }
  if (!Platform.isWindows && !Platform.isLinux) {
    throw const FormatException(
      'Audio conversion is currently available on iPhone, Mac and desktop.',
    );
  }
  Process process;
  try {
    process = await Process.start('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-t',
      '180',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      output,
    ]);
  } on ProcessException {
    throw const FormatException(
      'Install FFmpeg to convert YouTube audio on this desktop.',
    );
  }
  final stdoutDone = process.stdout.drain<void>();
  final stderrDone = process.stderr.drain<void>();
  try {
    final code = await process.exitCode.timeout(const Duration(minutes: 2));
    await Future.wait([stdoutDone, stderrDone]);
    if (code != 0) {
      throw const FormatException(
        'Could not convert this audio. Try uploading a WAV file.',
      );
    }
  } on TimeoutException {
    process.kill();
    await process.exitCode;
    await Future.wait([stdoutDone, stderrDone]);
    throw const FormatException(
      'Audio conversion timed out. Try a shorter recording.',
    );
  }
}
