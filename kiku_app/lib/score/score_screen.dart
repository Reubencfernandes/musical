import 'dart:async';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../services.dart';
import '../shell/shell.dart';
import '../songs/song_tile.dart' show shareFile;
import '../studio/project.dart' show formatClock;
import '../ui/musician.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'score_controller.dart';
import 'sheet_view.dart';

class ScoreScreen extends StatefulWidget {
  const ScoreScreen({super.key});
  @override
  State<ScoreScreen> createState() => _ScoreScreenState();
}

class _ScoreScreenState extends State<ScoreScreen> {
  final _recorder = AudioRecorder();
  final _player = AudioPlayer();
  bool _recording = false;
  int _recordSeconds = 0;
  Timer? _tick;
  String? _loaded;
  bool _follow = true;

  @override
  void dispose() {
    _tick?.cancel();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }

  ScoreController get _score => Kiku.of(context).score;

  Future<void> _pick() async {
    final score = _score;
    final file = await FilePicker.pickFile(type: FileType.audio);
    if (file == null || file.path == null) return;
    if (file.size > 100 * 1024 * 1024) {
      if (mounted) showNote(context, 'Choose an audio file under 100 MB.');
      return;
    }
    score.choose(file.path!, file.name);
  }

  Future<void> _record() async {
    final score = _score;
    if (_recording) {
      final path = await _recorder.stop();
      _tick?.cancel();
      if (mounted) setState(() => _recording = false);
      if (path != null) score.choose(path, 'My recording.wav');
      return;
    }
    if (!await _recorder.hasPermission()) {
      if (mounted) showNote(context, 'Microphone access was not available. Allow it in Settings, or choose a file.');
      return;
    }
    final dir = await getTemporaryDirectory();
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 44100, numChannels: 1),
      path: p.join(dir.path, 'score-take-${DateTime.now().millisecondsSinceEpoch}.wav'),
    );
    _recordSeconds = 0;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _recordSeconds++);
      if (_recordSeconds >= 600) _record();
    });
    if (mounted) setState(() => _recording = true);
  }

  Future<void> _loadAudio(String? path) async {
    if (path == _loaded) return;
    _loaded = path;
    await _player.stop();
    if (path != null) {
      try {
        await _player.setFilePath(path);
      } catch (_) {
        if (mounted) showNote(context, 'The recording could not be played on this device.');
      }
    }
  }

  Future<void> _share(String kind) async {
    final score = _score;
    try {
      final file = await score.exportFile(kind);
      if (file == null) {
        if (mounted) showNote(context, 'That file is not available for this score.');
        return;
      }
      if (mounted) await shareFile(context, file.path, text: score.title);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final score = _score;
    return ListenableBuilder(
      listenable: score,
      builder: (context, _) {
        if (score.stage == ScoreStage.score) unawaited(_loadAudio(score.audioPath));
        return switch (score.stage) {
          ScoreStage.input => _input(context, score),
          ScoreStage.processing => _processing(context, score),
          ScoreStage.score => _result(context, score),
        };
      },
    );
  }

  Widget _input(BuildContext context, ScoreController score) {
    final colors = KikuColors.of(context);
    return Scaffold(
      appBar: const PlaceBar(title: Text('Score')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text('Your music.\nWritten down.', style: Theme.of(context).textTheme.headlineMedium?.copyWith(height: 1.15)),
          const SizedBox(height: 10),
          Text('Turn a recording into a lead sheet you can play along with: melody, chords and sections, by SheetSage2.',
              style: TextStyle(color: colors.muted, height: 1.55)),
          const SizedBox(height: 20),
          InkWell(
            onTap: _recording ? null : _pick,
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 18),
              decoration: BoxDecoration(
                color: colors.raise,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: score.filePath != null ? accent : colors.line),
              ),
              child: Column(
                children: [
                  Container(
                    width: 60,
                    height: 60,
                    decoration: const BoxDecoration(color: accent, shape: BoxShape.circle),
                    child: const Icon(Icons.cloud_upload_outlined, color: Colors.white, size: 28),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    score.fileName ?? 'Choose a recording',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 16),
                  ),
                  const SizedBox(height: 6),
                  Text('MP3, WAV, M4A, OGG or FLAC · 5 seconds to 10 minutes · up to 100 MB',
                      textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: colors.muted)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: TextButton.icon(
              onPressed: _record,
              icon: Icon(_recording ? Icons.stop_circle_rounded : Icons.mic_rounded, color: _recording ? accent : null),
              label: Text(_recording ? 'Stop recording · ${formatClock(_recordSeconds.toDouble())}' : 'Record with the microphone'),
            ),
          ),
          if (score.error.isNotEmpty) ErrorBanner(message: score.error, onClose: () {
            score.error = '';
            setState(() {});
          }),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: score.filePath == null || _recording ? null : score.transcribe,
            icon: const Icon(Icons.library_music_rounded),
            label: const Text('Create score'),
          ),
        ],
      ),
    );
  }

  Widget _processing(BuildContext context, ScoreController score) {
    final colors = KikuColors.of(context);
    return Scaffold(
      appBar: const PlaceBar(title: Text('Score')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Musician(size: math.min(320.0, MediaQuery.sizeOf(context).width * .8)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(color: colors.accentSoft, borderRadius: BorderRadius.circular(4)),
                child: const Text('TRANSCRIBING', style: TextStyle(fontFamily: 'monospace', letterSpacing: 2, fontSize: 12, color: accent)),
              ),
              const SizedBox(height: 18),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Text(score.message, textAlign: TextAlign.center, style: TextStyle(color: colors.muted, height: 1.6)),
              ),
              const SizedBox(height: 14),
              TextButton(onPressed: score.cancel, child: const Text('Cancel')),
            ],
          ),
        ),
      ),
    );
  }

  Widget _result(BuildContext context, ScoreController score) {
    final colors = KikuColors.of(context);
    final note = switch (score.saveNote) {
      'saving' => 'Saving to your library…',
      'saved' => 'Saved to your library',
      'needs' => 'Not saved: sign in again and allow saving',
      'failed' => 'Could not save to your library',
      _ => '',
    };
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: PlaceBar(
          title: Text(score.title, overflow: TextOverflow.ellipsis),
          actions: [
            PopupMenuButton<String>(
              tooltip: 'Download',
              icon: const Icon(Icons.ios_share_rounded),
              onSelected: _share,
              itemBuilder: (context) => [
                for (final (kind, label) in const [
                  ('pdf', 'PDF'),
                  ('midi', 'MIDI'),
                  ('musicxml', 'MusicXML'),
                  ('abc', 'ABC notation'),
                  ('zip', 'All files (ZIP)'),
                ])
                  PopupMenuItem(value: kind, enabled: score.has(kind), child: Text(label)),
              ],
            ),
            IconButton(
              tooltip: 'New score',
              onPressed: () {
                _player.stop();
                _loaded = null;
                score.reset();
              },
              icon: const Icon(Icons.add_rounded),
            ),
          ],
        ),
        body: Column(
          children: [
            TabBar(tabs: const [Tab(text: 'Sheet music'), Tab(text: 'ABC')], indicatorColor: accent, labelColor: Theme.of(context).colorScheme.onSurface),
            Expanded(
              child: TabBarView(
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  StreamBuilder<Duration>(
                    stream: _player.positionStream,
                    builder: (context, snap) => SheetView(
                      abc: score.abc,
                      follow: _follow,
                      bar: score.barAt((snap.data?.inMilliseconds ?? 0) / 1000),
                      onBar: (bar) {
                        final clock = score.clock;
                        if (bar >= 0 && bar < clock.length) _player.seek(Duration(milliseconds: (clock[bar] * 1000).round()));
                      },
                    ),
                  ),
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: SelectableText(score.abc, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, height: 1.6)),
                  ),
                ],
              ),
            ),
            Container(
              decoration: BoxDecoration(color: colors.panel, border: Border(top: BorderSide(color: colors.line))),
              padding: const EdgeInsets.fromLTRB(8, 4, 14, 8),
              child: SafeArea(
                top: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        StreamBuilder<PlayerState>(
                          stream: _player.playerStateStream,
                          builder: (context, snap) {
                            final playing = snap.data?.playing ?? false;
                            final ended = snap.data?.processingState == ProcessingState.completed;
                            return IconButton(
                              tooltip: playing && !ended ? 'Pause' : 'Play along',
                              onPressed: score.audioPath == null
                                  ? null
                                  : () async {
                                      if (ended) await _player.seek(Duration.zero);
                                      if (playing && !ended) {
                                        await _player.pause();
                                      } else {
                                        unawaited(_player.play());
                                      }
                                    },
                              icon: Icon(playing && !ended ? Icons.pause_circle_filled_rounded : Icons.play_circle_fill_rounded, size: 40, color: accent),
                            );
                          },
                        ),
                        Expanded(
                          child: StreamBuilder<Duration>(
                            stream: _player.positionStream,
                            builder: (context, snap) {
                              final total = (_player.duration?.inMilliseconds ?? 0) / 1000;
                              final now = ((snap.data?.inMilliseconds ?? 0) / 1000).clamp(0.0, total <= 0 ? 0.0 : total);
                              return Row(
                                children: [
                                  Text(formatClock(now), style: TextStyle(fontSize: 12, color: colors.muted)),
                                  Expanded(
                                    child: Slider(
                                      value: now,
                                      max: total <= 0 ? 1 : total,
                                      onChanged: total <= 0 ? null : (v) => _player.seek(Duration(milliseconds: (v * 1000).round())),
                                    ),
                                  ),
                                  Text(formatClock(total), style: TextStyle(fontSize: 12, color: colors.muted)),
                                ],
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        const SizedBox(width: 8),
                        Expanded(child: Text(note, style: TextStyle(fontSize: 12, color: score.saveNote == 'saved' ? const Color(0xFF5FAE8A) : colors.muted))),
                        Text('Follow', style: TextStyle(fontSize: 12, color: colors.muted)),
                        Switch(value: _follow, onChanged: (v) => setState(() => _follow = v)),
                      ],
                    ),
                    if (score.audioPath == null)
                      Text('The recording for this score is not in your library.', style: TextStyle(fontSize: 12, color: colors.muted)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
