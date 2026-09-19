import 'dart:io';

import 'package:background_downloader/background_downloader.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/inference/background_model_store.dart';
import 'package:score_studio/inference/model_store.dart';

class FakeQueue implements ModelTransferQueue {
  final records = <String, TaskRecord>{};
  final live = <String>{};
  final enqueued = <DownloadTask>[];
  final resumed = <DownloadTask>[];
  bool canPause = true;

  @override
  Future<void> initialize() async {}
  @override
  Future<TaskRecord?> record(String id) async => records[id];
  @override
  Future<Set<String>> activeIds() async => {...live};
  @override
  Future<bool> enqueue(DownloadTask task) async {
    enqueued.add(task);
    live.add(task.taskId);
    records[task.taskId] = TaskRecord(task, TaskStatus.running, 0, -1);
    return true;
  }

  @override
  Future<bool> pause(DownloadTask task) async {
    if (!canPause) return false;
    live.remove(task.taskId);
    records[task.taskId] = records[task.taskId]!.copyWith(
      status: TaskStatus.paused,
    );
    return true;
  }

  @override
  Future<bool> resume(DownloadTask task) async {
    if (records[task.taskId]?.status != TaskStatus.paused) return false;
    resumed.add(task);
    live.add(task.taskId);
    records[task.taskId] = records[task.taskId]!.copyWith(
      status: TaskStatus.running,
    );
    return true;
  }

  @override
  Future<void> remove(String id) async {
    live.remove(id);
    records.remove(id);
  }
}

Future<void> until(bool Function() condition) async {
  for (var i = 0; i < 500; i++) {
    if (condition()) return;
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  fail('Timed out waiting for queue state');
}

void main() {
  late Directory root;
  late FakeQueue queue;
  late BackgroundModelStore store;
  final bytes = List.generate(4096, (i) => i % 251);
  late ModelPackage model;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('background-model-test-');
    queue = FakeQueue();
    store = BackgroundModelStore(
      root,
      queue: queue,
      pollInterval: const Duration(milliseconds: 5),
    );
    model = ModelPackage({
      'id': 'test',
      'name': 'Test',
      'revision': 'pinned',
      'files': [
        for (final name in ['weights.gguf', 'sidecars/config.json'])
          {
            'name': name,
            'url': 'https://example.com/$name',
            'size': bytes.length,
            'sha256': sha256.convert(bytes).toString(),
          },
      ],
    });
  });
  tearDown(() async {
    await root.delete(recursive: true);
  });

  Future<void> complete(ModelFile spec, List<int> content) async {
    final file = File('${store.directory(model).path}/${spec.name}.incoming');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(content);
    final id = store.taskId(model, spec);
    queue.live.remove(id);
    queue.records[id] = queue.records[id]!.copyWith(
      status: TaskStatus.complete,
      progress: 1,
    );
  }

  test(
    'queues every file, reconnects without duplicate tasks, then cleans staging',
    () async {
      final first = store.install(model, (_, _, _) {});
      await until(() => queue.enqueued.length == 2);
      final second = store.install(model, (_, _, _) {});
      expect(queue.enqueued.every((t) => t.allowPause), true);
      expect((await store.snapshot(model)).state, ModelDownloadState.active);
      for (final spec in model.files) {
        await complete(spec, bytes);
      }
      await Future.wait([first, second]);
      expect(queue.enqueued.length, 2);
      expect(await store.installed(model), true);
      expect(queue.records, isEmpty);
      final files = await store
          .directory(model)
          .list(recursive: true)
          .where((e) => e is File)
          .toList();
      expect(files.length, 3); // two model files and the verification marker
    },
  );

  test(
    'pause survives store recreation and resumes existing native tasks',
    () async {
      final running = store.install(model, (_, _, _) {});
      final paused = expectLater(running, throwsA(isA<DownloadCancelled>()));
      await until(() => queue.enqueued.length == 2);
      for (final entry in queue.records.entries.toList()) {
        queue.records[entry.key] = entry.value.copyWith(progress: 0.5);
      }
      expect(await store.pause(), true);
      await paused;
      store = BackgroundModelStore(
        root,
        queue: queue,
        pollInterval: const Duration(milliseconds: 5),
      );
      final saved = await store.snapshot(model);
      expect(saved.state, ModelDownloadState.paused);
      expect(saved.received, bytes.length);
      final resumed = store.install(model, (_, _, _) {});
      await until(() => queue.resumed.length == 2);
      for (final spec in model.files) {
        await complete(spec, bytes);
      }
      await resumed;
      expect(queue.enqueued.length, 2);
      expect(await store.installed(model), true);
    },
  );

  test(
    'failed pause is surfaced and does not falsely stop active downloads',
    () async {
      queue.canPause = false;
      final running = store.install(model, (_, _, _) {});
      await until(() => queue.enqueued.length == 2);
      expect(await store.pause(), false);
      expect((await store.snapshot(model)).state, ModelDownloadState.active);
      for (final spec in model.files) {
        await complete(spec, bytes);
      }
      await running;
    },
  );

  test(
    'existing foreground partial is requested by Range and reused',
    () async {
      final partial = File('${store.directory(model).path}/weights.gguf.part');
      await partial.parent.create(recursive: true);
      await partial.writeAsBytes(bytes.take(123).toList());
      final running = store.install(model, (_, _, _) {});
      await until(() => queue.enqueued.length == 2);
      expect(queue.enqueued.first.headers['Range'], 'bytes=123-');
      await complete(model.files.first, bytes.sublist(123));
      await complete(model.files.last, bytes);
      await running;
      expect(await store.installed(model), true);
      expect(
        await File('${store.directory(model).path}/weights.gguf').readAsBytes(),
        bytes,
      );
      expect(await partial.exists(), false);
    },
  );

  test(
    'completed background transfers verify on reopening without network',
    () async {
      for (final spec in model.files) {
        final file = File(
          '${store.directory(model).path}/${spec.name}.incoming',
        );
        await file.parent.create(recursive: true);
        await file.writeAsBytes(bytes);
      }
      expect((await store.snapshot(model)).state, ModelDownloadState.verifying);
      await store.install(model, (_, _, _) {});
      expect(queue.enqueued, isEmpty);
      expect(await store.installed(model), true);
    },
  );

  test(
    'bad checksum removes corrupt staging and never marks model ready',
    () async {
      final running = store.install(model, (_, _, _) {});
      final failed = expectLater(running, throwsFormatException);
      await until(() => queue.enqueued.length == 2);
      await complete(model.files.first, List.filled(bytes.length, 0));
      await complete(model.files.last, bytes);
      await failed;
      expect(await store.installed(model), false);
      expect(
        await File('${store.directory(model).path}/weights.gguf.part').exists(),
        false,
      );
      expect(
        await File(
          '${store.directory(model).path}/weights.gguf.incoming',
        ).exists(),
        false,
      );
    },
  );

  test(
    'discard removes paused tasks and partials but preserves completed files',
    () async {
      final target = File('${store.directory(model).path}/weights.gguf');
      await target.parent.create(recursive: true);
      await target.writeAsBytes(bytes);
      final running = store.install(model, (_, _, _) {});
      final paused = expectLater(running, throwsA(isA<DownloadCancelled>()));
      await until(() => queue.enqueued.length == 1);
      expect(await store.pause(), true);
      await paused;
      await store.discard(model);
      expect(await target.readAsBytes(), bytes);
      expect(queue.records, isEmpty);
      expect(queue.live, isEmpty);
      final files = await store
          .directory(model)
          .list(recursive: true)
          .where((e) => e is File)
          .toList();
      expect(files.length, 1);
    },
  );

  test(
    'interrupted tail merge can be repeated without duplicating bytes',
    () async {
      final partial = File('${root.path}/file.part'),
          tail = File('${root.path}/file.incoming');
      await partial.writeAsBytes(
        bytes.take(230).toList(),
      ); // 100 old + 130 already appended
      await tail.writeAsBytes(bytes.sublist(100));
      await assembleModelDownload(partial, tail, 100, bytes.length);
      expect(await partial.readAsBytes(), bytes);
      expect(await tail.exists(), false);
    },
  );

  test(
    'server ignoring Range replaces partial instead of appending full file',
    () async {
      final partial = File('${root.path}/file.part'),
          tail = File('${root.path}/file.incoming');
      await partial.writeAsBytes(bytes.take(100).toList());
      await tail.writeAsBytes(bytes);
      await assembleModelDownload(partial, tail, 100, bytes.length);
      expect(await partial.readAsBytes(), bytes);
      expect(await partial.length(), bytes.length);
    },
  );
}
