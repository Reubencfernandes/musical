import 'dart:io';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/imports/youtube_import.dart';

class FakeSource implements YoutubeSource {
  final YoutubeAudio audio;
  bool closed = false;
  FakeSource(this.audio);
  @override
  Future<YoutubeAudio> open(String id) async => audio;
  @override
  void close() {
    closed = true;
  }
}

class StalledSource implements YoutubeSource {
  bool closed = false;
  @override
  Future<YoutubeAudio> open(String id) => Completer<YoutubeAudio>().future;
  @override
  void close() {
    closed = true;
  }
}

void main() {
  test('A stalled lookup times out and releases the importer', () async {
    final root = await Directory.systemTemp.createTemp('youtube-timeout-');
    final source = StalledSource();
    final importer = YoutubeImporter(
      sourceFactory: () => source,
      lookupTimeout: const Duration(milliseconds: 20),
    );
    try {
      await expectLater(
        importer.import(
          'https://youtu.be/u10U7BHQQ2Y',
          root,
          (_, _) async => fail('Must not convert'),
          (_, _) {},
        ),
        throwsStateError,
      );
      expect(source.closed, true);
      expect(importer.busy, false);
      expect(await root.list().isEmpty, true);
    } finally {
      await root.delete(recursive: true);
    }
  });
  test(
    'Accepts YouTube video links and rejects lookalike hosts and playlists',
    () {
      for (final url in [
        'https://youtu.be/u10U7BHQQ2Y?si=test',
        'https://www.youtube.com/watch?v=u10U7BHQQ2Y',
        'https://music.youtube.com/watch?v=u10U7BHQQ2Y',
        'https://youtube.com/shorts/u10U7BHQQ2Y',
      ]) {
        expect(youtubeVideoId(url), 'u10U7BHQQ2Y');
      }
      for (final url in [
        'file:///etc/passwd',
        'https://youtube.com.evil.com/watch?v=u10U7BHQQ2Y',
        'https://evil.com/youtu.be/u10U7BHQQ2Y',
        'https://youtube.com/playlist?list=123',
        'https://youtube.com@evil.com/watch?v=u10U7BHQQ2Y',
      ]) {
        expect(() => youtubeVideoId(url), throwsFormatException);
      }
    },
  );
  test(
    'Downloads audio, converts it and removes the compressed source',
    () async {
      final root = await Directory.systemTemp.createTemp('youtube-test-');
      final source = FakeSource(
        YoutubeAudio(
          'Song',
          const Duration(minutes: 4),
          3,
          Stream.value([1, 2, 3]),
        ),
      );
      final importer = YoutubeImporter(sourceFactory: () => source);
      try {
        final result = await importer.import(
          'https://youtu.be/u10U7BHQQ2Y',
          root,
          (input, output) async {
            expect(await File(input).readAsBytes(), [1, 2, 3]);
            await File(output).writeAsBytes(List.filled(100, 0));
          },
          (_, _) {},
        );
        expect(result.excerpt, true);
        expect(await File(result.path).exists(), true);
        expect(
          await File('${File(result.path).parent.path}/source.m4a').exists(),
          false,
        );
        expect(source.closed, true);
        expect(importer.busy, false);
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'Truncated download cleans up and does not call the converter',
    () async {
      final root = await Directory.systemTemp.createTemp('youtube-test-');
      final importer = YoutubeImporter(
        sourceFactory: () => FakeSource(
          YoutubeAudio(
            'Song',
            const Duration(seconds: 30),
            10,
            Stream.value([1]),
          ),
        ),
      );
      try {
        await expectLater(
          importer.import(
            'https://youtu.be/u10U7BHQQ2Y',
            root,
            (_, _) async => fail('Must not convert a truncated file'),
            (_, _) {},
          ),
          throwsFormatException,
        );
        expect(await root.list().isEmpty, true);
        expect(importer.busy, false);
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
  test('Cancel removes partial data and permits another import', () async {
    final root = await Directory.systemTemp.createTemp('youtube-test-');
    final importer = YoutubeImporter(
      sourceFactory: () => FakeSource(
        YoutubeAudio(
          'Song',
          const Duration(seconds: 30),
          3,
          Stream.value([1, 2, 3]),
        ),
      ),
    );
    try {
      await expectLater(
        importer.import(
          'https://youtu.be/u10U7BHQQ2Y',
          root,
          (_, _) async => fail('Cancelled download must not convert'),
          (_, progress) {
            if (progress != null) importer.cancel();
          },
        ),
        throwsA(isA<ImportCancelled>()),
      );
      expect(await root.list().isEmpty, true);
      final result = await importer.import(
        'https://youtu.be/u10U7BHQQ2Y',
        root,
        (_, output) async {
          await File(output).writeAsBytes(List.filled(100, 0));
        },
        (_, _) {},
      );
      expect(await File(result.path).exists(), true);
    } finally {
      await root.delete(recursive: true);
    }
  });
  test(
    'Conversion failure cleans up downloaded source and incomplete output',
    () async {
      final root = await Directory.systemTemp.createTemp('youtube-test-');
      final importer = YoutubeImporter(
        sourceFactory: () => FakeSource(
          YoutubeAudio(
            'Song',
            const Duration(seconds: 30),
            3,
            Stream.value([1, 2, 3]),
          ),
        ),
      );
      try {
        await expectLater(
          importer.import('https://youtu.be/u10U7BHQQ2Y', root, (
            _,
            output,
          ) async {
            await File(output).writeAsBytes([1]);
            throw const FormatException('Decoder rejected audio');
          }, (_, _) {}),
          throwsFormatException,
        );
        expect(await root.list().isEmpty, true);
      } finally {
        await root.delete(recursive: true);
      }
    },
  );
}
