import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/inference/model_store.dart';

void main() {
  test('Directory failure releases the download lock for retry', () async {
    final root = await Directory.systemTemp.createTemp('score-model-test-');
    final blocker = File('${root.path}/blocked');
    await blocker.writeAsString('file');
    final store = ModelStore(Directory(blocker.path));
    final model = ModelPackage({
      'id': 'test',
      'name': 'Test',
      'revision': 'pinned',
      'files': [],
    });
    try {
      await expectLater(
        store.install(model, (_, _, _) {}),
        throwsA(isA<FileSystemException>()),
      );
      await blocker.delete();
      await store.install(model, (_, _, _) {});
      expect(await store.installed(model), true);
    } finally {
      await root.delete(recursive: true);
    }
  });
  test('Pause retains received bytes and allows a verified resume', () async {
    final root = await Directory.systemTemp.createTemp('score-model-test-');
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final content = List.generate(16384, (i) => i % 255);
    server.listen((request) async {
      final range = request.headers.value('range');
      final offset = range == null
          ? 0
          : int.parse(range.substring(6).split('-').first);
      request.response.statusCode = range == null ? 200 : 206;
      if (range != null) {
        request.response.headers.set(
          'Content-Range',
          'bytes $offset-${content.length - 1}/${content.length}',
        );
      }
      request.response.add(content.sublist(offset));
      await request.response.close();
    });
    final model = ModelPackage({
      'id': 'test',
      'name': 'Test',
      'revision': 'pinned',
      'files': [
        {
          'name': 'sample.gguf',
          'url': 'http://127.0.0.1:${server.port}/model',
          'size': content.length,
          'sha256': sha256.convert(content).toString(),
        },
      ],
    });
    final store = ModelStore(root);
    try {
      await expectLater(
        store.install(model, (received, _, _) {
          if (received > 0) store.cancel();
        }),
        throwsA(isA<DownloadCancelled>()),
      );
      expect(await store.installed(model), false);
      expect(
        await File('${store.directory(model).path}/sample.gguf.part').length(),
        greaterThan(0),
      );
      await store.install(model, (_, _, _) {});
      expect(await store.installed(model), true);
    } finally {
      await server.close(force: true);
      await root.delete(recursive: true);
    }
  });
  test(
    'Resumes partial downloads, validates hashes, reuses installed files',
    () async {
      final root = await Directory.systemTemp.createTemp('score-model-test-'),
          server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final content = List.generate(4096, (i) => i % 255);
      int requests = 0;
      String? range;
      server.listen((request) async {
        requests++;
        range = request.headers.value('range');
        final start = range == null
            ? 0
            : int.parse(range!.substring(6).split('-').first);
        request.response.statusCode = range == null ? 200 : 206;
        if (range != null) {
          request.response.headers.set(
            'Content-Range',
            'bytes $start-${content.length - 1}/${content.length}',
          );
        }
        request.response.add(content.sublist(start));
        await request.response.close();
      });
      final model = ModelPackage({
        'id': 'test',
        'name': 'Test',
        'revision': 'pinned',
        'files': [
          {
            'name': 'sample.gguf',
            'url': 'http://127.0.0.1:${server.port}/model',
            'size': content.length,
            'sha256': sha256.convert(content).toString(),
          },
        ],
      });
      final store = ModelStore(root), dir = store.directory(model);
      await dir.create(recursive: true);
      await File(
        '${dir.path}/sample.gguf.part',
      ).writeAsBytes(content.sublist(0, 100));
      try {
        expect(await store.installed(model), false);
        await store.install(model, (_, _, _) {});
        expect(range, 'bytes=100-');
        expect(await store.installed(model), true);
        expect(await File('${dir.path}/sample.gguf').readAsBytes(), content);
        await store.install(model, (_, _, _) {});
        expect(requests, 1);
      } finally {
        await server.close(force: true);
        await root.delete(recursive: true);
      }
    },
  );
  test('Corrupt download never becomes an installed model', () async {
    final root = await Directory.systemTemp.createTemp('score-model-test-'),
        server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      request.response.add([1, 2, 3]);
      await request.response.close();
    });
    final model = ModelPackage({
      'id': 'test',
      'name': 'Test',
      'revision': 'pinned',
      'files': [
        {
          'name': 'sample.gguf',
          'url': 'http://127.0.0.1:${server.port}/model',
          'size': 3,
          'sha256': sha256.convert([3, 2, 1]).toString(),
        },
      ],
    });
    final store = ModelStore(root);
    try {
      await expectLater(
        store.install(model, (_, _, _) {}),
        throwsFormatException,
      );
      expect(await store.installed(model), false);
    } finally {
      await server.close(force: true);
      await root.delete(recursive: true);
    }
  });
}
