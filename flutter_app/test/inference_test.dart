import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/inference/inference_service.dart';
import 'package:score_studio/inference/wav.dart';

void main() {
  test('PCM decoding preserves channels, sample rate and signed samples', () {
    final wav = Uint8List(52)..setAll(0, wavHeader(2, 48000, 2));
    final view = ByteData.sublistView(wav);
    for (final entry in [32767, -32768, 0, 16384].asMap().entries) {
      view.setInt16(44 + entry.key * 2, entry.value, Endian.little);
    }
    final decoded = WavAudio.decode(wav);
    expect(decoded.channels, 2);
    expect(decoded.sampleRate, 48000);
    expect(decoded.samples[1], -1);
    expect(decoded.samples[3], .5);
    expect(() => WavAudio.decode(wav.sublist(0, 49)), throwsFormatException);
    expect(() => WavAudio.decode(Uint8List(44)), throwsFormatException);
  });
  test('Failed native load releases worker and allows another job', () async {
    final temp = await Directory.systemTemp.createTemp('score-studio-test-');
    final engine = InferenceService(), events = <Map<String, dynamic>>[];
    final sub = engine.events.stream.listen(events.add);
    try {
      for (int i = 0; i < 2; i++) {
        await engine.run({
          'family': 'yue2',
          'library': '${temp.path}/missing-library',
          'model': temp.path,
          'output': '${temp.path}/job$i',
        });
        expect(engine.busy, false);
      }
      expect(events.where((event) => event['type'] == 'error').length, 2);
      expect(events.where((event) => event['type'] == 'done'), isEmpty);
    } finally {
      await sub.cancel();
      await engine.events.close();
      await temp.delete(recursive: true);
    }
  });
  test('Output directory failure does not leave the worker busy', () async {
    final temp = await Directory.systemTemp.createTemp('score-studio-test-');
    final file = File('${temp.path}/file');
    await file.writeAsString('file');
    final engine = InferenceService();
    try {
      await expectLater(
        engine.run({'output': '${file.path}/bad'}),
        throwsA(isA<FileSystemException>()),
      );
      expect(engine.busy, false);
    } finally {
      await engine.events.close();
      await temp.delete(recursive: true);
    }
  });
}
