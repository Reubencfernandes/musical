import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'flac.dart';
import 'pcm.dart';
import 'wav.dart';

const _channel = MethodChannel('kiku/audio');

/// Decodes audio bytes at the project rate. WAV and FLAC are read here; MP3,
/// M4A, OGG and the rest go through the platform's decoder (AVFoundation on
/// Apple devices, MediaCodec on Android, FFmpeg on desktops).
Future<Pcm> decodeAudio(Uint8List bytes, {String name = 'audio'}) async {
  if (isWav(bytes) || isFlac(bytes)) {
    return Isolate.run(() => (isWav(bytes) ? decodeWav(bytes) : decodeFlac(bytes)).toProject());
  }
  final dir = await getTemporaryDirectory();
  final stamp = DateTime.now().microsecondsSinceEpoch;
  final ext = p.extension(name).isEmpty ? '.audio' : p.extension(name);
  final input = File(p.join(dir.path, 'decode-$stamp$ext'));
  await input.writeAsBytes(bytes, flush: true);
  try {
    return await decodeAudioFile(input.path);
  } finally {
    unawaited(input.delete().catchError((_) => input));
  }
}

/// Decodes an audio file at the project rate.
Future<Pcm> decodeAudioFile(String path) async {
  final file = File(path);
  final head = await _head(file);
  if (isWav(head) || isFlac(head)) {
    return Isolate.run(() {
      final bytes = File(path).readAsBytesSync();
      return (isWav(bytes) ? decodeWav(bytes) : decodeFlac(bytes)).toProject();
    });
  }
  final dir = await getTemporaryDirectory();
  final output = p.join(dir.path, 'decoded-${DateTime.now().microsecondsSinceEpoch}.wav');
  try {
    await _platformDecode(path, output);
    return await Isolate.run(() => decodeWav(File(output).readAsBytesSync()).toProject());
  } finally {
    final out = File(output);
    if (await out.exists()) unawaited(out.delete().catchError((_) => out));
  }
}

Future<Uint8List> _head(File file) async {
  final raf = await file.open();
  try {
    return await raf.read(64);
  } finally {
    await raf.close();
  }
}

Future<void> _platformDecode(String input, String output) async {
  if (Platform.isIOS || Platform.isMacOS || Platform.isAndroid) {
    try {
      await _channel.invokeMethod<String>('decode', {'path': input, 'output': output});
    } on PlatformException catch (e) {
      throw FormatException(e.message ?? 'This audio could not be read. Try a WAV, FLAC, MP3 or M4A file.');
    } on MissingPluginException {
      throw const FormatException('This device cannot read that audio format. Try a WAV or FLAC file.');
    }
    return;
  }
  ProcessResult result;
  try {
    result = await Process.run('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, //
      '-vn', '-ar', '$projectRate', '-c:a', 'pcm_s16le', output,
    ]).timeout(const Duration(minutes: 3));
  } on ProcessException {
    throw const FormatException('Install FFmpeg to open MP3 or M4A files on this computer, or use WAV or FLAC.');
  }
  if (result.exitCode != 0) {
    throw const FormatException('This audio could not be read. Try a WAV, FLAC, MP3 or M4A file.');
  }
}
