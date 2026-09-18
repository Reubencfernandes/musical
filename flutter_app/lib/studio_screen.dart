import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'inference/inference_service.dart';
import 'inference/model_store.dart';
import 'inference/native_api.dart';
import 'widgets/musician.dart';

class StudioScreen extends StatefulWidget {
  const StudioScreen({super.key});
  @override
  State<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends State<StudioScreen> {
  final engine = InferenceService(), player = AudioPlayer();
  final style = TextEditingController(),
      lyrics = TextEditingController(),
      abc = TextEditingController();
  StreamSubscription<Map<String, dynamic>>? subscription;
  List<ModelPackage> packages = [];
  final installed = <String>{};
  ModelStore? store;
  Directory? documents;
  String family = 'yue2',
      stage = '',
      error = '',
      score = '',
      backend = Platform.isIOS || Platform.isMacOS ? 'metal' : 'cpu';
  String? inputAudio, song;
  List<String> files = [];
  bool busy = false, downloading = false, stopping = false;
  double downloadProgress = 0;
  final watch = Stopwatch();
  Timer? elapsedTimer;

  @override
  void initState() {
    super.initState();
    subscription = engine.events.stream.listen(_event);
    _setup();
  }

  Future<void> _setup() async {
    try {
      final root = await getApplicationDocumentsDirectory();
      final loaded =
          (jsonDecode(await rootBundle.loadString('assets/models.json'))
                  as List)
              .map((p) => ModelPackage(p))
              .toList();
      final storage = ModelStore(Directory('${root.path}/models'));
      final ready = <String>{};
      for (final item in loaded) {
        if (await storage.installed(item)) ready.add(item.id);
      }
      if (mounted) {
        setState(() {
          documents = root;
          packages = loaded;
          store = storage;
          installed.addAll(ready);
        });
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
      }
    } catch (e) {
      if (mounted) setState(() => error = 'Could not open the result: $e');
    }
  }

  Future<void> _download(ModelPackage model) async {
    setState(() {
      downloading = true;
      error = '';
      downloadProgress = 0;
    });
    try {
      if (!NativeApi.open().families().contains(model.id)) {
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
        setState(() => stage = 'Download paused. Tap Download to resume.');
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => downloading = false);
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
      if (mounted) setState(() => inputAudio = selected);
    } catch (e) {
      if (mounted) setState(() => error = 'Could not import audio: $e');
    }
  }

  Future<void> _run() async {
    if (busy || downloading || documents == null) return;
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
    store?.cancel();
    if (engine.busy) unawaited(engine.cancel());
    subscription?.cancel();
    elapsedTimer?.cancel();
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
                if (busy) ...[
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
                                onPressed: () => store?.cancel(),
                                child: const Text('Pause download'),
                              ),
                            ] else if (!installed.contains(family))
                              FilledButton.tonal(
                                onPressed: () => _download(selected),
                                child: const Text('Download model'),
                              ),
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
                    OutlinedButton.icon(
                      onPressed: documents == null || downloading
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
                      'Up to 3 minutes. iPhone accepts WAV, MP3 and M4A; desktop currently accepts PCM WAV.',
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
                            !downloading
                        ? _run
                        : null,
                    icon: const Icon(Icons.auto_awesome),
                    label: Text(
                      family == 'yue2' ? 'Generate music' : 'Create score',
                    ),
                  ),
                ],
                if (error.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: SelectableText(
                      error,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
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
                  const Text('Your score · ABC notation'),
                  SelectableText(score),
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
