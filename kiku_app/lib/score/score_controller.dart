import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../api/engine.dart';
import '../api/errors.dart';
import '../api/gradio.dart';
import '../api/library.dart';
import '../audio/decode.dart';
import '../audio/flac.dart';
import '../audio/pcm.dart';
import '../audio/wav.dart';
import '../auth/session.dart';

enum ScoreStage { input, processing, score }

/// The Score page: a recording in, SheetSage2's lead sheet out, saved to the
/// library with its recording, as on the web.
class ScoreController extends ChangeNotifier {
  ScoreController(this.engine, this.library, this.auth);
  final Engine engine;
  final Library library;
  final AuthService auth;

  ScoreStage stage = ScoreStage.input;
  String? filePath, fileName;
  String message = '', error = '';
  String abc = '', title = '';
  Map<String, dynamic>? timing;
  List<Download> downloads = const [];
  Download? pdf;
  String? audioPath;
  double duration = 0;

  /// '', 'saving', 'saved', 'needs' or 'failed'.
  String saveNote = '';
  CancelToken? _cancel;

  void _changed() => notifyListeners();

  /// Seconds into the recording where each bar starts, from SheetSage2's bar timing.
  List<double> get clock {
    final value = timing?['clock'];
    return value is List ? value.whereType<num>().map((n) => n.toDouble()).toList() : const [];
  }

  /// The bar playing at [seconds], or -1 before the first.
  int barAt(double seconds) {
    final c = clock;
    if (c.length < 2) return -1;
    int lo = 0, hi = c.length - 1, found = -1;
    while (lo <= hi) {
      final mid = (lo + hi) >> 1;
      if (c[mid] <= seconds) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= c.length - 1 ? c.length - 2 : found;
  }

  void choose(String path, String name) {
    filePath = path;
    fileName = name;
    error = '';
    _changed();
  }

  void reset() {
    _cancel?.cancel();
    stage = ScoreStage.input;
    filePath = fileName = null;
    error = message = '';
    abc = title = '';
    timing = null;
    downloads = const [];
    pdf = null;
    audioPath = null;
    saveNote = '';
    _changed();
  }

  void cancel() {
    _cancel?.cancel();
    stage = ScoreStage.input;
    _changed();
  }

  Future<void> transcribe() async {
    final path = filePath;
    if (path == null) return;
    final cancel = _cancel = CancelToken();
    stage = ScoreStage.processing;
    message = 'Preparing the full recording…';
    error = '';
    _changed();
    try {
      final Pcm pcm;
      try {
        pcm = await decodeAudioFile(path);
      } on FormatException catch (e) {
        throw KikuException(e.message);
      }
      if (pcm.duration < 5) throw const KikuException('Use a recording with at least five seconds of audio.');
      if (pcm.duration > 600) {
        throw const KikuException('This recording is longer than the current ten-minute limit. Nothing was cut or submitted.');
      }
      cancel.check();
      final dir = await getTemporaryDirectory();
      final wav = File(p.join(dir.path, 'recording-${DateTime.now().microsecondsSinceEpoch}.wav'));
      await wav.writeAsBytes(await _monoWav(pcm), flush: true);
      final result = await engine.run('transcribe', {'duration': pcm.duration}, audio: wav, cancel: cancel, status: (text) {
        message = text;
        _changed();
      });
      cancel.check();
      // Keep the recording where the system will not clear it while the score is open.
      final keep = File(p.join((await getApplicationSupportDirectory()).path, 'scores', '${newId()}${p.extension(path)}'));
      await keep.parent.create(recursive: true);
      await File(path).copy(keep.path);
      abc = result['abc'] as String;
      timing = (result['timing'] as Map?)?.cast<String, dynamic>();
      downloads = (result['downloads'] as List? ?? const []).whereType<Download>().toList();
      pdf = Download.from(result['pdf']);
      title = p.basenameWithoutExtension(fileName ?? path);
      if (title.isEmpty) title = 'Your recording';
      audioPath = keep.path;
      duration = pcm.duration;
      stage = ScoreStage.score;
      _changed();
      await _save(pcm, keep);
    } catch (e) {
      if (cancel.cancelled) return;
      error = describe(e);
      stage = ScoreStage.input;
      _changed();
    }
  }

  /// Keeps the score in the library with its recording: the original MP3, or FLAC.
  Future<void> _save(Pcm pcm, File original) async {
    if (!(auth.user?.storage ?? false)) {
      saveNote = 'needs';
      _changed();
      return;
    }
    saveNote = 'saving';
    _changed();
    try {
      final mp3 = p.extension(original.path).toLowerCase() == '.mp3';
      final audio = mp3 ? await original.readAsBytes() : await _flac(pcm);
      final score = SavedScore(
        id: newId(),
        title: title,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        abc: abc,
        duration: duration,
        timing: timing,
      );
      await library.saveScore(score, audio, mp3 ? 'mp3' : 'flac');
      saveNote = 'saved';
    } catch (e) {
      saveNote = e is NeedsStorage ? 'needs' : 'failed';
    }
    _changed();
  }

  /// Reopens a score from the library, recording and all.
  Future<void> openSaved(SavedScore score) async {
    _cancel?.cancel();
    stage = ScoreStage.processing;
    message = 'Opening your score…';
    error = '';
    _changed();
    try {
      final file = await library.scoreAudio(score);
      abc = score.abc;
      timing = score.timing;
      title = score.title;
      downloads = const [];
      pdf = null;
      audioPath = file?.path;
      duration = score.duration;
      saveNote = 'saved';
      stage = ScoreStage.score;
    } catch (e) {
      error = describe(e);
      stage = ScoreStage.input;
    }
    _changed();
  }

  /// A file to share: the PDF, the MIDI, all downloads, or the ABC text.
  Future<File?> exportFile(String kind) async {
    final dir = await getTemporaryDirectory();
    final safe = title.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1f]'), '_');
    if (kind == 'abc') {
      final file = File(p.join(dir.path, '${safe.isEmpty ? 'score' : safe}.abc'));
      await file.writeAsString(abc);
      return file;
    }
    final Download? source = switch (kind) {
      'pdf' => pdf ?? downloads.where((d) => d.name.toLowerCase().endsWith('.pdf')).firstOrNull,
      'midi' => downloads.where((d) => RegExp(r'\.midi?$', caseSensitive: false).hasMatch(d.name)).firstOrNull,
      'musicxml' => downloads.where((d) => RegExp(r'\.(musicxml|mxl|xml)$', caseSensitive: false).hasMatch(d.name)).firstOrNull,
      _ => downloads.where((d) => d.name.toLowerCase().endsWith('.zip')).firstOrNull,
    };
    if (source == null) return null;
    final bytes = await engine.fetch(source);
    final ext = p.extension(source.name);
    final file = File(p.join(dir.path, '${safe.isEmpty ? 'score' : safe}$ext'));
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  bool has(String kind) => switch (kind) {
    'abc' => abc.isNotEmpty,
    'pdf' => pdf != null || downloads.any((d) => d.name.toLowerCase().endsWith('.pdf')),
    'midi' => downloads.any((d) => RegExp(r'\.midi?$', caseSensitive: false).hasMatch(d.name)),
    'musicxml' => downloads.any((d) => RegExp(r'\.(musicxml|mxl|xml)$', caseSensitive: false).hasMatch(d.name)),
    _ => downloads.any((d) => d.name.toLowerCase().endsWith('.zip')),
  };
}

Future<Uint8List> _monoWav(Pcm pcm) => Isolate.run(() => encodeWav(pcm.mono()));
Future<Uint8List> _flac(Pcm pcm) => Isolate.run(() => encodeFlac(pcm));
