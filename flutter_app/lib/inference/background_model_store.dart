import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:background_downloader/background_downloader.dart';

import 'model_store.dart';

/// Small boundary around the native queue, also used by the recovery tests.
abstract interface class ModelTransferQueue {
  Future<void> initialize();
  Future<TaskRecord?> record(String id);
  Future<Set<String>> activeIds();
  Future<bool> enqueue(DownloadTask task);
  Future<bool> resume(DownloadTask task);
  Future<bool> pause(DownloadTask task);
  Future<void> remove(String id);
}

class NativeModelTransferQueue implements ModelTransferQueue {
  final downloader = FileDownloader();
  Future<void>? _initialization;

  @override
  Future<void> initialize() async {
    await (_initialization ??= _initialize());
    await downloader.resumeFromBackground();
  }

  Future<void> _initialize() async {
    await downloader.configure(
      iOSConfig: [
        (Config.resourceTimeout, const Duration(days: 2)),
        (Config.excludeFromCloudBackup, true),
      ],
    );
    // Track only our group. Preserve paused records for as long as the user
    // wants to keep them; delete records explicitly when verified/discarded.
    await downloader.trackTasksInGroup('models');
  }

  @override
  Future<TaskRecord?> record(String id) => downloader.database.recordForId(id);
  @override
  Future<Set<String>> activeIds() async {
    final ids = <String>{};
    // 9.5.x includes paused tasks in allTaskIds despite their lack of a live
    // URLSession task. Do not restart explicitly paused downloads on launch.
    for (final id in await downloader.allTaskIds(group: 'models')) {
      if ((await record(id))?.status != TaskStatus.paused) ids.add(id);
    }
    return ids;
  }

  @override
  Future<bool> enqueue(DownloadTask task) => downloader.enqueue(task);
  @override
  Future<bool> resume(DownloadTask task) => downloader.resume(task);
  @override
  Future<bool> pause(DownloadTask task) => downloader.pause(task);
  @override
  Future<void> remove(String id) async {
    if (!await downloader.cancelTaskWithId(id)) {
      throw StateError('Could not stop the transfer. Try again.');
    }
    await downloader.database.deleteRecordWithId(id);
  }
}

/// iOS owns every file transfer before Dart starts waiting for completion.
/// This object lives for the app lifetime, independently of the studio screen.
class BackgroundModelStore extends ModelStore {
  final ModelTransferQueue queue;
  final Duration pollInterval;
  final _progress = StreamController<(int, int, String)>.broadcast();
  (int, int, String)? _lastProgress;
  Future<void>? _operation;
  String? _modelId;
  bool _pauseRequested = false, _pausing = false;
  Completer<void>? _prepared;
  final List<DownloadTask> _tasks = [];

  BackgroundModelStore(
    super.root, {
    ModelTransferQueue? queue,
    this.pollInterval = const Duration(milliseconds: 500),
  }) : queue = queue ?? NativeModelTransferQueue();

  @override
  bool get supportsBackground => true;

  @override
  Future<void> reconnect() => queue.initialize();

  String taskId(ModelPackage model, ModelFile spec) =>
      '${model.id}-${model.revision}-${base64Url.encode(utf8.encode(spec.name))}-${spec.digest}';
  String _path(ModelPackage model, ModelFile spec) =>
      '${directory(model).path}/${spec.name}';

  @override
  Future<ModelDownloadSnapshot> snapshot(ModelPackage model) async {
    await queue.initialize();
    final active = await queue.activeIds();
    var bytes = 0, complete = true, hasRecord = false, running = false;
    for (final spec in model.files) {
      final path = _path(model, spec);
      final record = await queue.record(taskId(model, spec));
      hasRecord |= record != null;
      running |= active.contains(taskId(model, spec));
      final target = File(path), partial = File('$path.part');
      final incoming = File('$path.incoming');
      final saved = await partial.exists() ? await partial.length() : 0;
      if (await target.exists() && await target.length() == spec.size ||
          await incoming.exists() ||
          saved == spec.size) {
        bytes += spec.size;
      } else {
        complete = false;
        final progress = (record?.progress ?? 0).clamp(0.0, 1.0);
        bytes += saved + ((spec.size - saved) * progress).round();
      }
    }
    return ModelDownloadSnapshot(
      running || _modelId == model.id
          ? ModelDownloadState.active
          : complete
          ? ModelDownloadState.verifying
          : hasRecord || bytes > 0
          ? ModelDownloadState.paused
          : ModelDownloadState.none,
      bytes.clamp(0, model.size),
    );
  }

  @override
  Future<void> install(
    ModelPackage model,
    void Function(int, int, String) progress,
  ) async {
    if (_operation != null && _modelId != model.id) {
      throw StateError('Another model download is in progress.');
    }
    final subscription = _progress.stream.listen(
      (p) => progress(p.$1, p.$2, p.$3),
    );
    try {
      if (_operation == null) {
        _modelId = model.id;
        _pauseRequested = false;
        _lastProgress = null;
        _prepared = Completer<void>();
        _operation = _install(model).whenComplete(() {
          _operation = null;
          _modelId = null;
        });
      } else if (_lastProgress case final p?) {
        progress(p.$1, p.$2, p.$3);
      }
      await _operation;
    } finally {
      await subscription.cancel();
    }
  }

  void _report(int bytes, int total, String message) {
    _lastProgress = (bytes, total, message);
    _progress.add(_lastProgress!);
  }

  @override
  Future<bool> pause() async {
    if (_operation == null) return true;
    _pausing = true;
    try {
      await _prepared?.future;
      final active = await queue.activeIds();
      var success = true;
      for (final task in _tasks) {
        if (active.contains(task.taskId) && !await queue.pause(task)) {
          // A file may have finished between the queue lookup and pause.
          if ((await queue.record(task.taskId))?.status !=
              TaskStatus.complete) {
            success = false;
          }
        }
      }
      _pauseRequested = success;
      return success;
    } finally {
      _pausing = false;
    }
  }

  @override
  void cancel() {
    unawaited(pause());
  }

  Future<void> _checkpoint() async {
    while (_pausing) {
      await Future<void>.delayed(pollInterval);
    }
    if (_pauseRequested) throw DownloadCancelled();
  }

  Future<void> _install(ModelPackage model) async {
    _tasks.clear();
    final plans = <String, int>{};
    try {
      await queue.initialize();
      final active = await queue.activeIds();
      await directory(model).create(recursive: true);
      for (final spec in model.files) {
        final path = _path(model, spec), id = taskId(model, spec);
        final target = File(path), partial = File('$path.part');
        await target.parent.create(recursive: true);
        if (await target.exists() &&
            await target.length() == spec.size &&
            await hashModelFile(target) == spec.digest) {
          await _cleanFileState(model, spec);
          continue;
        }
        // An invalid old destination must not occupy another model-sized copy.
        if (await target.exists()) await target.delete();
        var offset = await partial.exists() ? await partial.length() : 0;
        if (offset > spec.size) {
          await partial.delete();
          offset = 0;
        }
        if (offset == spec.size) continue;
        final plan = File('$path.transfer.json');
        if (await plan.exists()) {
          offset =
              (jsonDecode(await plan.readAsString()) as Map)['offset'] as int;
        } else {
          final temporary = File('${plan.path}.tmp');
          await temporary.writeAsString(
            jsonEncode({'offset': offset}),
            flush: true,
          );
          await temporary.rename(plan.path);
        }
        plans[id] = offset;
        final record = await queue.record(id);
        final nameParts = spec.name.split('/');
        final task =
            record?.task as DownloadTask? ??
            DownloadTask(
              taskId: id,
              url: spec.url,
              filename: '${nameParts.last}.incoming',
              directory: [
                'models',
                model.id,
                model.revision,
                ...nameParts.take(nameParts.length - 1),
              ].join('/'),
              baseDirectory: BaseDirectory.applicationDocuments,
              headers: {if (offset > 0) 'Range': 'bytes=$offset-'},
              group: 'models',
              updates: Updates.statusAndProgress,
              allowPause: true,
              retries: 3,
              metaData: jsonEncode({'offset': offset}),
            );
        _tasks.add(task);
        if (await File('$path.incoming').exists() || active.contains(id)) {
          continue;
        }
        if (record != null && await queue.resume(task)) continue;
        if (!await queue.enqueue(task)) {
          throw StateError(
            'Could not start ${spec.name}. Tap Resume to retry.',
          );
        }
      }
    } finally {
      // All files must be handed to the OS, not a Dart-only sequential queue.
      _prepared?.complete();
    }

    while (true) {
      await _checkpoint();
      var bytes = 0, pending = false, allPaused = true;
      String? failure;
      for (final spec in model.files) {
        final path = _path(model, spec), id = taskId(model, spec);
        final offset = plans[id] ?? 0;
        if (await File(path).exists() ||
            await File('$path.incoming').exists() ||
            (await File('$path.part').exists() &&
                await File('$path.part').length() == spec.size)) {
          bytes += spec.size;
          continue;
        }
        pending = true;
        final record = await queue.record(id);
        allPaused &= record?.status == TaskStatus.paused;
        if (record != null && record.status.isFinalState) {
          failure =
              'Download interrupted for ${spec.name}. Saved data is kept. Tap Resume to retry.';
        }
        bytes +=
            offset +
            ((spec.size - offset) * (record?.progress ?? 0).clamp(0.0, 1.0))
                .round();
      }
      _report(
        bytes,
        model.size,
        'Downloading · ${(bytes / 1e9).toStringAsFixed(2)} / ${(model.size / 1e9).toStringAsFixed(2)} GB',
      );
      if (failure != null) throw HttpException(failure);
      if (!pending) break;
      if (allPaused) throw DownloadCancelled();
      await Future<void>.delayed(pollInterval);
    }

    for (final spec in model.files) {
      await _checkpoint();
      final path = _path(model, spec);
      final target = File(path),
          partial = File('$path.part'),
          incoming = File('$path.incoming');
      if (!await target.exists()) {
        _report(model.size, model.size, 'Verifying ${spec.name}…');
        if (await incoming.exists() &&
            (!await partial.exists() || await partial.length() != spec.size)) {
          await assembleModelDownload(
            partial,
            incoming,
            plans[taskId(model, spec)] ?? 0,
            spec.size,
          );
        }
        if (!await partial.exists() ||
            await partial.length() != spec.size ||
            await hashModelFile(partial) != spec.digest) {
          await _cleanFileState(model, spec);
          throw const FormatException(
            'Model checksum failed. Invalid download removed. Tap Resume to retry.',
          );
        }
        await _checkpoint();
        await partial.rename(target.path);
      }
      await _cleanFileState(model, spec);
    }
    final marker = File('${directory(model).path}/verified.tmp');
    await marker.writeAsString(
      jsonEncode({'revision': model.revision}),
      flush: true,
    );
    await marker.rename('${directory(model).path}/verified');
    _report(model.size, model.size, 'Ready for offline use');
  }

  Future<void> _cleanFileState(ModelPackage model, ModelFile spec) async {
    await queue.remove(taskId(model, spec));
    for (final suffix in [
      '.part',
      '.incoming',
      '.transfer.json',
      '.transfer.json.tmp',
    ]) {
      final file = File('${_path(model, spec)}$suffix');
      if (await file.exists()) await file.delete();
    }
  }

  @override
  Future<void> discard(ModelPackage model) async {
    if (_operation != null) throw StateError('Pause the download first.');
    for (final spec in model.files) {
      await _cleanFileState(model, spec);
    }
  }
}

/// Preserve pre-upgrade .part files. Appending is restart-safe: truncate back
/// to the saved offset before each merge, then delete the tail only after flush.
Future<void> assembleModelDownload(
  File partial,
  File incoming,
  int offset,
  int total,
) async {
  final length = await incoming.length();
  if (length == total) {
    // A server that ignored Range returned a complete replacement.
    if (await partial.exists()) await partial.delete();
    await incoming.rename(partial.path);
    return;
  }
  if (offset <= 0 ||
      length != total - offset ||
      !await partial.exists() ||
      await partial.length() < offset) {
    await incoming.delete();
    throw const HttpException(
      'Invalid resumed download. Saved bytes kept; tap Resume to retry.',
    );
  }
  final handle = await partial.open(mode: FileMode.append);
  try {
    await handle.truncate(offset);
    await handle.setPosition(offset);
    await for (final bytes in incoming.openRead()) {
      await handle.writeFrom(bytes);
    }
    await handle.flush();
  } finally {
    await handle.close();
  }
  await incoming.delete();
}
