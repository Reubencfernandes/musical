import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiku_ai/audio/flac.dart';
import 'package:kiku_ai/audio/pcm.dart';
import 'package:kiku_ai/audio/wav.dart';
import 'package:kiku_ai/audio/waveform.dart';

Pcm _music(int frames, int channels, {int rate = 44100, int seed = 1}) {
  final rng = Random(seed);
  final out = Int16List(frames * channels);
  for (int i = 0; i < frames; i++) {
    final t = i / rate;
    final tone = sin(2 * pi * 220 * t) * 0.4 + sin(2 * pi * 331 * t) * 0.2 + (rng.nextDouble() - .5) * 0.05;
    out[i * channels] = toSample(tone);
    if (channels == 2) out[i * channels + 1] = toSample(tone * 0.8 + sin(2 * pi * 440 * t) * 0.1);
  }
  return Pcm(out, channels, rate);
}

void main() {
  group('WAV', () {
    test('round-trips 16-bit stereo', () {
      final pcm = _music(5000, 2);
      final back = decodeWav(encodeWav(pcm));
      expect(back.channels, 2);
      expect(back.rate, 44100);
      expect(back.samples, pcm.samples);
    });

    test('reads 24-bit and float WAV', () {
      // 24-bit mono, three samples: 0, half scale, -half scale.
      final header = encodeWav(Pcm(Int16List(3), 1, 8000)).sublist(0, 44);
      final d = ByteData.sublistView(header);
      d.setUint16(32, 3, Endian.little);
      d.setUint16(34, 24, Endian.little);
      d.setUint32(28, 8000 * 3, Endian.little);
      d.setUint32(40, 9, Endian.little);
      final body = Uint8List.fromList([0, 0, 0, 0, 0, 0x40, 0, 0, 0xC0]);
      final pcm = decodeWav(Uint8List.fromList([...header, ...body]));
      expect(pcm.samples, [0, 16384, -16384]);

      final f = encodeWav(Pcm(Int16List(2), 1, 8000)).sublist(0, 44);
      final fd = ByteData.sublistView(f);
      fd.setUint16(20, 3, Endian.little);
      fd.setUint16(34, 32, Endian.little);
      fd.setUint32(40, 8, Endian.little);
      final floats = ByteData(8)
        ..setFloat32(0, 0.5, Endian.little)
        ..setFloat32(4, -1.0, Endian.little);
      expect(decodeWav(Uint8List.fromList([...f, ...floats.buffer.asUint8List()])).samples, [16384, -32768]);
    });

    test('rejects other files', () {
      expect(() => decodeWav(Uint8List.fromList(List.filled(64, 1))), throwsFormatException);
    });
  });

  group('FLAC', () {
    for (final (frames, channels) in [(10000, 2), (4096, 1), (4097, 2), (12, 1), (100000, 2)]) {
      test('round-trips $frames frames × $channels', () {
        final pcm = _music(frames, channels, seed: frames);
        final flac = encodeFlac(pcm);
        expect(isFlac(flac), isTrue);
        final back = decodeFlac(flac);
        expect(back.channels, channels);
        expect(back.rate, 44100);
        expect(back.samples, pcm.samples);
        if (frames >= 10000) expect(flac.length, lessThan(pcm.samples.length * 2 * 0.95));
      });
    }

    test('round-trips silence, extremes and a 48 kHz rate', () {
      final silent = Pcm(Int16List(9000 * 2), 2, 48000);
      expect(decodeFlac(encodeFlac(silent)).samples, silent.samples);
      final edges = Int16List(6000);
      for (int i = 0; i < edges.length; i++) {
        edges[i] = i.isEven ? 32767 : -32768;
      }
      final pcm = Pcm(edges, 1, 48000);
      final back = decodeFlac(encodeFlac(pcm));
      expect(back.rate, 48000);
      expect(back.samples, edges);
    });

    test('writes a file for the flac reference tool', () async {
      // CI checks this file with `flac -t`, the reference decoder.
      final out = File('build/kiku-test.flac');
      await out.parent.create(recursive: true);
      await out.writeAsBytes(encodeFlac(_music(44100 * 3, 2, seed: 9)));
    });

    final reference = Platform.environment['KIKU_REFERENCE_FLAC'];
    test('decodes a file made by the reference encoder', () {
      final flac = decodeFlac(File(reference!).readAsBytesSync());
      final wav = decodeWav(File(Platform.environment['KIKU_REFERENCE_WAV']!).readAsBytesSync());
      expect(flac.channels, wav.channels);
      expect(flac.rate, wav.rate);
      expect(flac.samples, wav.samples);
    }, skip: reference == null ? 'Set KIKU_REFERENCE_FLAC and KIKU_REFERENCE_WAV (CI does).' : false);
  });

  group('PCM', () {
    test('resamples, slices and mixes down', () {
      final pcm = _music(48000, 2, rate: 48000);
      final project = pcm.toProject();
      expect(project.rate, projectRate);
      expect((project.duration - 1).abs(), lessThan(0.001));
      expect(project.slice(0.25, 0.75).duration, closeTo(0.5, 0.001));
      expect(project.mono().channels, 1);
      expect(project.mono().stereo().channels, 2);
    });

    test('splices with a crossfade', () {
      final a = Pcm(Int16List.fromList(List.filled(2000, 1000)), 1, 1000);
      final b = Pcm(Int16List.fromList(List.filled(1000, -1000)), 1, 1000);
      final joined = Pcm.splice(a, 1.0, b, 0.1);
      expect(joined.duration, closeTo(2.0, 0.001));
      expect(joined.samples[0], 1000);
      expect(joined.samples.last, -1000);
    });

    test('peaks outline the loudest samples', () {
      final out = peaks(Pcm(Int16List.fromList([0, 16384, -32768, 0]), 1, 4), buckets: 2);
      expect(out[0], closeTo(.5, .001));
      expect(out[1], closeTo(1, .001));
    });
  });
}
