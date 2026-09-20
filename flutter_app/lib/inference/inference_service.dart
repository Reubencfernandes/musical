import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';
import 'package:ffi/ffi.dart';
import 'native_api.dart';
import 'runtime_options.dart';
import 'wav.dart';

class InferenceService {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  bool busy = false;
  String? _cancelPath;

  Future<void> run(Map<String, String> input) async {
    if (busy) {
      throw StateError('Wait for the current model to release its memory.');
    }
    busy = true;
    final port = ReceivePort(), done = Completer<void>();
    final subscription = port.listen((message) {
      if (message == null) {
        if (!done.isCompleted) done.complete();
        return;
      }
      if (message is List) {
        events.add({
          'type': 'error',
          'message': 'Native worker failed: ${message.first}',
        });
        return;
      }
      events.add(Map<String, dynamic>.from(message as Map));
    });
    try {
      await Directory(input['output']!).create(recursive: true);
      final cancel = File('${input['output']}/cancel');
      if (await cancel.exists()) {
        await cancel.delete();
      }
      _cancelPath = cancel.path;
      await Isolate.spawn(
        _worker,
        {'input': input, 'port': port.sendPort, 'cancel': _cancelPath},
        onError: port.sendPort,
        onExit: port.sendPort,
        errorsAreFatal: true,
      );
      await done.future;
    } finally {
      busy = false;
      _cancelPath = null;
      await subscription.cancel();
      port.close();
      events.add({'type': 'idle'});
    }
  }

  Future<void> cancel() async {
    final path = _cancelPath;
    if (path == null) return;
    await File(path).writeAsString('cancel');
    // Never kill an isolate inside a blocking native call or free its live handles.
    events.add({
      'type': 'stage',
      'message':
          'Stop requested. Waiting for the current native operation to release memory…',
    });
  }
}

void _worker(Map<String, dynamic> args) {
  final input = Map<String, String>.from(args['input']),
      port = args['port'] as SendPort;
  final cancelFile = File(args['cancel'] as String),
      timer = Stopwatch()..start();
  void send(String type, String message) => port.send({
    'type': type,
    'message': message,
    'elapsedMs': timer.elapsedMilliseconds,
  });
  void checkpoint() {
    if (cancelFile.existsSync()) throw const _Cancelled();
  }

  Map<String, dynamic>? completed;
  try {
    using((arena) {
      checkpoint();
      send('stage', 'Opening the local audio engine…');
      final api = NativeApi.open(path: input['library']);
      final registry = arena<Handle>(),
          model = arena<Handle>(),
          session = arena<Handle>(),
          result = arena<Handle>();
      Handle options = nullptr, request = nullptr;
      Pointer<Utf8> text(String s) => s.toNativeUtf8(allocator: arena);
      try {
        api.check(api.registryCreate(nullptr, registry));
        final family = input['family']!, config = arena<ModelConfig>();
        config.ref.family = text(family);
        WavAudio? recordingAudio;
        if (family == 'sheetsage2') {
          send('stage', 'Checking your recording…');
          final recording = File(input['audio']!);
          if (recording.lengthSync() > 150 * 1024 * 1024) {
            throw StateError('Select an audio file below 150 MB.');
          }
          recordingAudio = WavAudio.decode(
            recording.readAsBytesSync(),
            maxDuration: const Duration(minutes: 3),
          );
        }

        send(
          'stage',
          'Loading ${family == 'yue2' ? 'YuE2' : 'SheetSage2'} from this device…',
        );
        api.check(
          api.modelLoad(
            registry.value,
            text(input['model']!),
            config,
            nullptr,
            model,
          ),
        );
        checkpoint();
        final task = text(family == 'yue2' ? 'gen' : 'midi'),
            mode = text('offline');
        if (api.supports(model.value, task, mode) == 0) {
          throw StateError('This runtime does not support the selected task.');
        }
        options = api.optionsCreate();
        if (options == nullptr) {
          throw StateError('Not enough memory for model options.');
        }
        for (final option in runtimeOptions(family).entries) {
          api.check(
            api.optionsSet(options, text(option.key), text(option.value)),
          );
        }
        final backend = arena<BackendConfig>();
        backend.ref.backend = text(
          input['backend'] ??
              (Platform.isIOS || Platform.isMacOS ? 'metal' : 'cpu'),
        );
        backend.ref.threads = min(4, Platform.numberOfProcessors);
        backend.ref.device = 0;
        send('stage', 'Preparing the model…');
        api.check(
          api.sessionCreate(model.value, task, mode, backend, options, session),
        );
        checkpoint();
        request = api.requestCreate();
        if (request == nullptr) {
          throw StateError('Not enough memory for the request.');
        }
        if (family == 'yue2') {
          api.check(api.setText(request, text(input['lyrics']!), nullptr));
          api.check(
            api.setOption(request, text('style'), text(input['style']!)),
          );
          api.check(
            api.setOption(
              request,
              text('cot'),
              text((input['abc'] ?? '').isEmpty ? 'full' : 'melody'),
            ),
          );
          api.check(
            api.setOption(
              request,
              text('seed'),
              text(input['seed'] ?? '831001'),
            ),
          );
          if ((input['abc'] ?? '').isNotEmpty) {
            api.check(api.setOption(request, text('abc'), text(input['abc']!)));
          }
          for (final limit in const ['abc_max_tokens', 'semantic_max_tokens']) {
            if ((input[limit] ?? '').isNotEmpty) {
              api.check(
                api.setOption(request, text(limit), text(input[limit]!)),
              );
            }
          }
        } else {
          final wav = recordingAudio!;
          final samples = calloc<Float>(wav.samples.length);
          try {
            samples.asTypedList(wav.samples.length).setAll(0, wav.samples);
            api.check(
              api.setAudio(
                request,
                samples,
                wav.samples.length ~/ wav.channels,
                wav.sampleRate,
                wav.channels,
              ),
            );
          } finally {
            calloc.free(samples);
            recordingAudio = null;
          }
        }
        checkpoint();
        send(
          'stage',
          family == 'yue2'
              ? 'Composing and rendering your music on this device…'
              : 'Listening for melody, chords and rhythm…',
        );
        api.check(api.sessionRun(session.value, request, result));
        checkpoint();
        send('stage', 'Saving your result…');
        final output = input['output']!, files = <String>[];
        final pcm = arena<Pointer<Float>>(),
            frames = arena<Size>(),
            rate = arena<Int32>(),
            channels = arena<Int32>();
        final audioStatus = api.resultAudio(
          result.value,
          pcm,
          frames,
          rate,
          channels,
        );
        if (audioStatus == 0 && frames.value > 0) {
          if (channels.value < 1 ||
              channels.value > 2 ||
              rate.value < 8000 ||
              frames.value * channels.value * 2 > 0xffffffff - 36) {
            throw StateError('Invalid generated audio format.');
          }
          final path = '$output/song.wav',
              file = File(path).openSync(mode: FileMode.write);
          try {
            file.writeFromSync(
              wavHeader(frames.value, rate.value, channels.value),
            );
            final count = frames.value * channels.value;
            for (int offset = 0; offset < count; offset += 16384) {
              checkpoint();
              final n = min(16384, count - offset),
                  bytes = Uint8List(n * 2),
                  view = ByteData.sublistView(bytes);
              for (int i = 0; i < n; i++) {
                final sample = pcm.value[offset + i];
                view.setInt16(
                  i * 2,
                  sample.isFinite ? (sample.clamp(-1, 1) * 32767).round() : 0,
                  Endian.little,
                );
              }
              file.writeFromSync(bytes);
            }
          } finally {
            file.closeSync();
          }
          files.add(path);
        } else if (audioStatus != 7) {
          api.check(audioStatus);
        }
        final transcript = arena<Pointer<Utf8>>();
        final textStatus = api.resultText(result.value, transcript, nullptr);
        if (textStatus == 0 &&
            transcript.value != nullptr &&
            transcript.value.toDartString().isNotEmpty) {
          final path = '$output/score.abc';
          File(path).writeAsStringSync(transcript.value.toDartString());
          files.add(path);
        } else if (textStatus != 7) {
          api.check(textStatus);
        }
        for (int i = 0; i < api.artifactCount(result.value); i++) {
          final kind = arena<Int32>(),
              id = arena<Pointer<Utf8>>(),
              payload = arena<Handle>(),
              bytes = arena<Size>();
          api.check(api.artifact(result.value, i, kind, id, payload, bytes));
          if (bytes.value == 0 || payload.value == nullptr) continue;
          final name = id.value.toDartString().replaceAll(
            RegExp(r'[^a-zA-Z0-9_-]'),
            '_',
          );
          final extension = kind.value == 4
              ? 'mid'
              : name == 'score'
              ? 'abc'
              : 'json';
          final path = '$output/artifact-$i-$name.$extension';
          File(path).writeAsBytesSync(
            payload.value.cast<Uint8>().asTypedList(bytes.value),
          );
          files.add(path);
        }
        if (files.isEmpty) {
          throw StateError('The model completed without an output.');
        }
        File('$output/run.json').writeAsStringSync(
          jsonEncode({
            'family': family,
            'runtimeRevision': '542bb4ea2a18273e96b3237e5f1f6941df148d9f',
            'elapsedMs': timer.elapsedMilliseconds,
            'files': files,
          }),
        );
        completed = {
          'type': 'done',
          'files': files,
          'elapsedMs': timer.elapsedMilliseconds,
        };
      } finally {
        api.resultFree(result.value);
        api.requestFree(request);
        api.sessionFree(session.value);
        api.optionsFree(options);
        api.modelFree(model.value);
        api.registryFree(registry.value);
      }
    });
    if (completed != null) port.send(completed);
  } on _Cancelled {
    send('cancelled', 'Stopped. Any unfinished result was discarded.');
  } catch (error) {
    send('error', error.toString());
  }
}

class _Cancelled implements Exception {
  const _Cancelled();
}
