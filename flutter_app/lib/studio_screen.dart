import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';
import 'inference/inference_service.dart';
import 'inference/model_store.dart';
import 'inference/background_model_store.dart';
import 'inference/native_api.dart';
import 'widgets/musician.dart';
import 'imports/youtube_import.dart';
import 'imports/audio_converter.dart';
import 'score/score_page.dart';

class StudioScreen extends StatefulWidget {
  const StudioScreen({super.key});
  @override
  State<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends State<StudioScreen>
    with WidgetsBindingObserver {
  // Keep the transfer owner alive when the studio route is disposed/recreated.
  static ModelStore? _appStore;
  final engine = InferenceService(), player = AudioPlayer();
  final style = TextEditingController(),
      lyrics = TextEditingController(),
      abc = TextEditingController(),
      youtube = TextEditingController();
  final youtubeImporter = YoutubeImporter();
  bool importing = false;
  double? importProgress;
  String importStage = '', inputTitle = '';
  StreamSubscription<Map<String, dynamic>>? subscription;
  List<ModelPackage> packages = [];
  final installed = <String>{};
  final downloads = <String, ModelDownloadSnapshot>{};
  ModelStore? store;
  Directory? documents;
  String family = 'yue2',
      stage = '',
      error = '',
      score = '',
      backend = Platform.isIOS || Platform.isMacOS ? 'metal' : 'cpu';
  String? inputAudio, song;
  List<String> files = [];
  bool busy = false, downloading = false, stopping = false, pausing = false;
  double downloadProgress = 0;
  final watch = Stopwatch();
  Timer? elapsedTimer;
  final recorder = AudioRecorder(), recordWatch = Stopwatch();
  Timer? recordTimer;
  bool recording = false;
  static const maxRecording = Duration(minutes: 3);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    subscription = engine.events.stream.listen(_event);
    _setup();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_reconnectDownloads());
  }

  Future<void> _reconnectDownloads() async {
    try {
      await store?.reconnect();
      if (!mounted || downloading || store == null) return;
      for (final model in packages) {
        if (installed.contains(model.id)) continue;
        final saved = await store!.snapshot(model);
        if (!mounted) return;
        setState(() => downloads[model.id] = saved);
        if (saved.state == ModelDownloadState.active ||
            saved.state == ModelDownloadState.verifying) {
          setState(() => family = model.id);
          await _download(model, restoring: true);
        }
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> _setup() async {
    try {
      final root = await getApplicationDocumentsDirectory();
      final loaded =
          (jsonDecode(await rootBundle.loadString('assets/models.json'))
                  as List)
              .map((p) => ModelPackage(p))
              .toList();
      final storage = _appStore ??= Platform.isIOS
          ? BackgroundModelStore(Directory('${root.path}/models'))
          : ModelStore(Directory('${root.path}/models'));
      final ready = <String>{};
      final saved = <String, ModelDownloadSnapshot>{};
      ModelPackage? restore;
      for (final item in loaded) {
        if (await storage.installed(item)) {
          ready.add(item.id);
        } else {
          final state = await storage.snapshot(item);
          saved[item.id] = state;
          if (state.state == ModelDownloadState.active ||
              state.state == ModelDownloadState.verifying) {
            restore ??= item;
          }
        }
      }
      if (mounted) {
        setState(() {
          documents = root;
          packages = loaded;
          store = storage;
          installed.addAll(ready);
          downloads.addAll(saved);
          if (restore != null) family = restore.id;
        });
        if (restore != null) unawaited(_download(restore, restoring: true));
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  void _event(Map<String, dynamic> event) {
    if (!mounted) return;
    setState(() {
      switch (event['type']) {
        case 'stage':
          if (!stopping) stage = event['message'];
          break;
        case 'error':
          error = event['message'];
          break;
        case 'done':
          files = List<String>.from(event['files']);
          stage = 'Complete';
          break;
        case 'cancelled':
          stage = event['message'];
          break;
        case 'idle':
          busy = false;
          stopping = false;
          watch.stop();
          elapsedTimer?.cancel();
          break;
      }
    });
    if (event['type'] == 'done') unawaited(_openResult());
  }

  Future<void> _openResult() async {
    try {
      final audio = files.where((p) => p.endsWith('.wav')).firstOrNull;
      final notation = files.where((p) => p.endsWith('.abc')).firstOrNull;
      if (audio != null) await player.setFilePath(audio);
      final text = notation == null ? '' : await File(notation).readAsString();
      if (mounted) {
        setState(() {
          song = audio;
          score = text;
        });
        if (text.isNotEmpty && audio == null) _openScore();
      }
    } catch (e) {
      if (mounted) setState(() => error = 'Could not open the result: $e');
    }
  }

  void _openScore() {
    if (score.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ScorePage(
          abc: score,
          title: inputTitle.isEmpty ? 'Your score' : inputTitle,
        ),
      ),
    );
  }

  Future<void> _toggleRecording() async {
    if (recording) return _finishRecording();
    if (documents == null || busy || importing || downloading) return;
    try {
      if (!await recorder.hasPermission()) {
        setState(
          () => error =
              'Allow microphone access for Score Studio in Settings to record.',
        );
        return;
      }
      await player.stop();
      await recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.wav,
          sampleRate: 44100,
          numChannels: 1,
        ),
        path:
            '${documents!.path}/recording-${DateTime.now().microsecondsSinceEpoch}.wav',
      );
      recordWatch
        ..reset()
        ..start();
      recordTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
        if (recordWatch.elapsed >= maxRecording) {
          unawaited(_finishRecording());
        } else if (mounted) {
          setState(() {});
        }
      });
      await _keepAwake(true);
      if (mounted) {
        setState(() {
          recording = true;
          error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = 'Could not start recording: $e');
    }
  }

  Future<void> _finishRecording() async {
    if (!recording) return;
    recording = false;
    recordTimer?.cancel();
    recordWatch.stop();
    try {
      final raw = await recorder.stop();
      await _keepAwake(false);
      if (raw == null) throw StateError('Nothing was recorded.');
      if (recordWatch.elapsed < const Duration(seconds: 2)) {
        await File(raw).delete();
        throw StateError('Record for at least a couple of seconds.');
      }
      var selected = raw;
      if (Platform.isIOS) {
        // Same importer as picked files, so the model always sees plain PCM.
        selected =
            await const MethodChannel(
              'score_studio/audio',
            ).invokeMethod<String>('decode', {
              'path': raw,
              'output':
                  '${documents!.path}/import-${DateTime.now().microsecondsSinceEpoch}.wav',
            }) ??
            raw;
        if (selected != raw) await File(raw).delete();
      }
      if (mounted) {
        setState(() {
          inputAudio = selected;
          inputTitle = 'My recording · ${_clock(recordWatch.elapsed)}';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() {});
    }
  }

  static String _clock(Duration d) =>
      '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  Future<void> _download(ModelPackage model, {bool restoring = false}) async {
    if (downloading) return;
    setState(() {
      downloading = true;
      error = '';
      downloadProgress = (downloads[model.id]?.received ?? 0) / model.size;
      stage = restoring ? 'Restoring download…' : 'Preparing download…';
    });
    try {
      if (!restoring && !NativeApi.open().families().contains(model.id)) {
        throw StateError(
          'Rebuild the native engine with ${model.name} enabled.',
        );
      }
      await store!.install(model, (received, total, message) {
        if (mounted) {
          setState(() {
            downloadProgress = received / total;
            stage = message;
          });
        }
      });
      if (mounted) setState(() => installed.add(model.id));
    } on DownloadCancelled {
      if (mounted) {
        setState(() => stage = 'Download paused. Saved data will be reused.');
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      try {
        final saved = await store!.snapshot(model);
        if (mounted) setState(() => downloads[model.id] = saved);
      } catch (e) {
        if (mounted) setState(() => error = e.toString());
      }
      if (mounted) {
        setState(() {
          downloading = false;
          pausing = false;
        });
      }
    }
  }

  Future<void> _pauseDownload() async {
    setState(() => pausing = true);
    try {
      if (!await store!.pause() && mounted) {
        setState(
          () => error =
              'The server could not pause every file yet. Try again in a moment.',
        );
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => pausing = false);
    }
  }

  Future<void> _discardDownload(ModelPackage model) async {
    setState(() => pausing = true);
    try {
      await store!.discard(model);
      final saved = await store!.snapshot(model);
      if (mounted) {
        setState(() {
          downloads[model.id] = saved;
          stage = 'Unfinished download removed. Completed files kept.';
          error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => pausing = false);
    }
  }

  Future<void> _importYoutube() async {
    if (documents == null || importing || busy || downloading) return;
    setState(() {
      importing = true;
      error = '';
      importProgress = null;
    });
    try {
      final result = await youtubeImporter.import(
        youtube.text,
        Directory('${documents!.path}/imports'),
        convertYoutubeAudio,
        (message, progress) {
          if (mounted) {
            setState(() {
              importStage = message;
              importProgress = progress;
            });
          }
        },
      );
      if (mounted) {
        setState(() {
          inputAudio = result.path;
          inputTitle =
              '${result.title}${result.excerpt ? ' · first 3 minutes' : ''}';
        });
      }
    } on ImportCancelled {
      if (mounted) setState(() => error = 'YouTube import cancelled.');
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => importing = false);
    }
  }

  Future<void> _pickAudio() async {
    try {
      final result = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: Platform.isIOS
            ? ['wav', 'mp3', 'm4a', 'aiff', 'caf']
            : ['wav'],
      );
      final path = result?.path;
      if (path == null) return;
      String selected = path;
      if (Platform.isIOS) {
        selected =
            await const MethodChannel(
              'score_studio/audio',
            ).invokeMethod<String>('decode', {
              'path': path,
              'output':
                  '${documents!.path}/import-${DateTime.now().microsecondsSinceEpoch}.wav',
            }) ??
            path;
      }
      if (mounted) {
        setState(() {
          inputAudio = selected;
          inputTitle = 'Uploaded recording';
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = 'Could not import audio: $e');
    }
  }

  Future<void> _run() async {
    if (busy || downloading || importing || recording || documents == null) {
      return;
    }
    if (family == 'yue2' &&
        (style.text.trim().isEmpty || lyrics.text.trim().isEmpty)) {
      setState(() => error = 'Add a style and lyrics first.');
      return;
    }
    if (family == 'sheetsage2' && inputAudio == null) {
      setState(() => error = 'Choose a recording first.');
      return;
    }
    await player.stop();
    if (!mounted) return;
    setState(() {
      busy = true;
      stopping = false;
      error = '';
      stage = 'Starting…';
      files = [];
      score = '';
      song = null;
    });
    watch
      ..reset()
      ..start();
    elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    final model = packages.firstWhere((p) => p.id == family),
        dir = store!.directory(model);
    try {
      if (!await store!.installed(model)) {
        throw StateError('Download the model files first.');
      }
      await _keepAwake(true);
      await engine.run({
        'family': family,
        'model': family == 'sheetsage2'
            ? '${dir.path}/sheetsage2-orig.gguf'
            : dir.path,
        'backend': backend,
        'style': style.text.trim(),
        'lyrics': lyrics.text.trim(),
        'abc': abc.text.trim(),
        'audio': inputAudio ?? '',
        'output':
            '${documents!.path}/results/${DateTime.now().microsecondsSinceEpoch}',
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      watch.stop();
      elapsedTimer?.cancel();
      if (mounted) setState(() => busy = false);
      await _keepAwake(false);
    }
  }

  Future<void> _keepAwake(bool enabled) async {
    if (!Platform.isIOS) return;
    try {
      await const MethodChannel(
        'score_studio/audio',
      ).invokeMethod<void>('keepAwake', enabled);
    } on PlatformException catch (e) {
      debugPrint('Unable to change idle timer: $e');
    }
  }

  Future<void> _stop() async {
    setState(() {
      stopping = true;
      stage = 'Stopping after the current native operation finishes…';
    });
    await engine.cancel();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (!(store?.supportsBackground ?? false)) store?.cancel();
    youtubeImporter.cancel();
    youtube.dispose();
    if (engine.busy) unawaited(engine.cancel());
    subscription?.cancel();
    elapsedTimer?.cancel();
    recordTimer?.cancel();
    unawaited(recorder.dispose());
    player.dispose();
    style.dispose();
    lyrics.dispose();
    abc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final selected = packages.where((p) => p.id == family).firstOrNull;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 700),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'Score Studio',
                  style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                const Text('Your music. On your device.'),
                const SizedBox(height: 28),
                if (importing) ...[
                  const Center(child: Musician()),
                  Text(importStage, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  LinearProgressIndicator(value: importProgress),
                  TextButton(
                    onPressed: () => youtubeImporter.cancel(),
                    child: const Text('Cancel import'),
                  ),
                ] else if (busy) ...[
                  const Center(child: Musician()),
                  Text(stage, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    '${watch.elapsed.inSeconds}s elapsed',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Keep the app open. This engine returns playable audio when rendering finishes.',
                    textAlign: TextAlign.center,
                  ),
                  TextButton(
                    onPressed: stopping ? null : _stop,
                    child: Text(stopping ? 'Stopping…' : 'Cancel'),
                  ),
                ] else ...[
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'yue2',
                        label: Text('Create music'),
                        icon: Icon(Icons.music_note),
                      ),
                      ButtonSegment(
                        value: 'sheetsage2',
                        label: Text('Transcribe'),
                        icon: Icon(Icons.graphic_eq),
                      ),
                    ],
                    selected: {family},
                    onSelectionChanged: downloading
                        ? null
                        : (v) => setState(() => family = v.first),
                  ),
                  const SizedBox(height: 20),
                  if (selected != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${selected.name} · ${(selected.size / 1e9).toStringAsFixed(2)} GB',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              installed.contains(family)
                                  ? 'Downloaded. No internet required for inference.'
                                  : 'Download once to run locally. Free storage and available memory are required.',
                            ),
                            const SizedBox(height: 8),
                            if (downloading) ...[
                              LinearProgressIndicator(value: downloadProgress),
                              Text(stage),
                              TextButton(
                                onPressed: pausing ? null : _pauseDownload,
                                child: Text(
                                  pausing ? 'Pausing…' : 'Pause download',
                                ),
                              ),
                              if (store?.supportsBackground ?? false)
                                const Text(
                                  'You can lock your phone or switch apps. Reopen the app after a force-quit to resume.',
                                ),
                            ] else if (!installed.contains(family)) ...[
                              if (downloads[family]?.state ==
                                  ModelDownloadState.paused)
                                Text(
                                  '${((downloads[family]?.received ?? 0) / 1e9).toStringAsFixed(2)} GB saved · paused or interrupted',
                                ),
                              FilledButton.tonal(
                                onPressed: pausing
                                    ? null
                                    : () => _download(selected),
                                child: Text(
                                  downloads[family] != null &&
                                          downloads[family]!.state !=
                                              ModelDownloadState.none
                                      ? 'Resume download'
                                      : 'Download model',
                                ),
                              ),
                              if (downloads[family]?.state ==
                                  ModelDownloadState.paused)
                                TextButton(
                                  onPressed: pausing
                                      ? null
                                      : () => _discardDownload(selected),
                                  child: const Text(
                                    'Discard unfinished download',
                                  ),
                                ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  if (family == 'yue2') ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: style,
                      decoration: const InputDecoration(
                        labelText: 'Describe your music',
                        hintText:
                            'Warm acoustic pop, soft drums, expressive vocals',
                      ),
                      maxLines: 3,
                      maxLength: 2000,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: lyrics,
                      decoration: const InputDecoration(
                        labelText: 'Lyrics',
                        hintText: '[Verse]\n…\n[Chorus]\n…',
                      ),
                      minLines: 5,
                      maxLines: 10,
                      maxLength: 12000,
                    ),
                    ExpansionTile(
                      title: const Text('Use a melody score'),
                      children: [
                        TextField(
                          controller: abc,
                          decoration: const InputDecoration(
                            labelText: 'Optional ABC notation',
                          ),
                          maxLines: 5,
                          maxLength: 20000,
                        ),
                      ],
                    ),
                  ] else ...[
                    const SizedBox(height: 16),
                    FilledButton.tonalIcon(
                      onPressed: documents == null || downloading || importing
                          ? null
                          : _toggleRecording,
                      icon: Icon(recording ? Icons.stop : Icons.mic),
                      style: recording
                          ? FilledButton.styleFrom(
                              backgroundColor: Theme.of(
                                context,
                              ).colorScheme.error,
                              foregroundColor: Theme.of(
                                context,
                              ).colorScheme.onError,
                            )
                          : null,
                      label: Text(
                        recording
                            ? 'Stop · ${_clock(recordWatch.elapsed)} / ${_clock(maxRecording)}'
                            : 'Record with the microphone',
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: documents == null || downloading || recording
                          ? null
                          : _pickAudio,
                      icon: const Icon(Icons.upload_file),
                      label: Text(
                        inputAudio == null
                            ? 'Choose a recording'
                            : 'Recording selected · change',
                      ),
                    ),
                    const Text(
                      'iPhone accepts WAV, MP3 and M4A; longer recordings use the first 3 minutes. Desktop currently accepts 16-bit PCM WAV.',
                    ),
                  ],
                  if (family == 'sheetsage2') ...[
                    const SizedBox(height: 20),
                    TextField(
                      controller: youtube,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Or paste a YouTube link',
                        hintText: 'https://youtu.be/…',
                      ),
                      onSubmitted: (_) => _importYoutube(),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Imports the first 3 minutes from videos up to 10 minutes. Some videos may block downloads.',
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: documents == null || downloading || recording
                          ? null
                          : _importYoutube,
                      icon: const Icon(Icons.link),
                      label: const Text('Import YouTube audio'),
                    ),
                    if (inputTitle.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text('Ready: $inputTitle'),
                      ),
                  ],
                  ExpansionTile(
                    title: const Text('Processing options'),
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: backend,
                        items: const [
                          DropdownMenuItem(
                            value: 'metal',
                            child: Text('Apple GPU (Metal)'),
                          ),
                          DropdownMenuItem(value: 'cpu', child: Text('CPU')),
                        ],
                        onChanged: (v) => setState(() => backend = v!),
                        decoration: const InputDecoration(
                          labelText: 'Compute device',
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.all(8),
                        child: Text(
                          'Phone compatibility and speed are experimental. Switching to CPU may be slower. No automatic server fallback.',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed:
                        selected != null &&
                            installed.contains(family) &&
                            !downloading &&
                            !recording
                        ? _run
                        : null,
                    icon: const Icon(Icons.auto_awesome),
                    label: Text(
                      family == 'yue2' ? 'Generate music' : 'Create score',
                    ),
                  ),
                ],
                if (error.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: SelectableText(
                      errorSummary(error),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                  if (errorDetails(error).isNotEmpty)
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: Text(
                        'Technical details',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      children: [
                        SelectableText(
                          errorDetails(error),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  const SizedBox(height: 16),
                ],
                if (song != null) ...[
                  const SizedBox(height: 24),
                  StreamBuilder<PlayerState>(
                    stream: player.playerStateStream,
                    builder: (context, snapshot) => FilledButton.tonalIcon(
                      onPressed: () async {
                        if (player.playing) {
                          await player.pause();
                        } else {
                          if (player.processingState ==
                              ProcessingState.completed) {
                            await player.seek(Duration.zero);
                          }
                          unawaited(player.play());
                        }
                      },
                      icon: Icon(
                        snapshot.data?.playing == true
                            ? Icons.pause
                            : Icons.play_arrow,
                      ),
                      label: const Text('Listen'),
                    ),
                  ),
                  StreamBuilder<Duration>(
                    stream: player.positionStream,
                    builder: (context, snapshot) {
                      final max = (player.duration?.inMilliseconds ?? 1)
                          .toDouble();
                      return Slider(
                        value: (snapshot.data?.inMilliseconds ?? 0)
                            .toDouble()
                            .clamp(0, max),
                        max: max > 0 ? max : 1,
                        onChanged: (value) =>
                            player.seek(Duration(milliseconds: value.round())),
                      );
                    },
                  ),
                ],
                if (score.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: _openScore,
                    icon: const Icon(Icons.library_music),
                    label: const Text('Open score and play'),
                  ),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('ABC notation (text)'),
                    children: [SelectableText(score)],
                  ),
                  TextButton(
                    onPressed: () => setState(() {
                      abc.text = score;
                      family = 'yue2';
                    }),
                    child: const Text('Use this melody to create music'),
                  ),
                ],
                if (files.isNotEmpty)
                  Builder(
                    builder: (context) => OutlinedButton.icon(
                      onPressed: () async {
                        try {
                          final box = context.findRenderObject() as RenderBox?;
                          await SharePlus.instance.share(
                            ShareParams(
                              files: files.map((p) => XFile(p)).toList(),
                              sharePositionOrigin: box == null
                                  ? null
                                  : box.localToGlobal(Offset.zero) & box.size,
                            ),
                          );
                        } catch (e) {
                          if (mounted) {
                            setState(() => error = 'Export failed: $e');
                          }
                        }
                      },
                      icon: const Icon(Icons.ios_share),
                      label: const Text('Export files'),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The sentence a person should read: no Dart exception prefix, no diagnostics.
String errorSummary(String error) => error
    .split(' Details: ')
    .first
    .replaceFirst(
      RegExp(r'^(Bad state|Exception|FormatException|Invalid argument\(s\)): '),
      '',
    );

/// Diagnostics that follow ' Details: ', kept available but out of the way.
String errorDetails(String error) {
  final at = error.indexOf(' Details: ');
  return at < 0 ? '' : error.substring(at + ' Details: '.length);
}
