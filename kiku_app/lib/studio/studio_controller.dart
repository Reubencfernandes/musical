import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../api/engine.dart';
import '../api/errors.dart';
import '../api/gradio.dart';
import '../api/kiku_server.dart';
import '../api/library.dart';
import '../audio/decode.dart';
import '../audio/pcm.dart';
import '../audio/wav.dart';
import '../audio/waveform.dart' as wave;
import 'project.dart';

/// A running AI job, drawn as a lane under the tracks it works on.
class StudioJob {
  StudioJob(this.id, this.label, this.start, this.end) : began = DateTime.now();
  final String id, label;
  final double start, end;
  final DateTime began;
  String status = 'Starting…';
  DateTime? running, etaAt;
  double? progress;
  int? queue;
  String? error;
}

/// One track of a result.
class _Placed {
  const _Placed(this.name, this.pcm);
  final String name;
  final Pcm pcm;
}

const _maxSeconds = 240.0, _scoreMax = 300.0;

/// The studio: a small multitrack editor built around Kiku's AI actions, like
/// the web studio. Every buffer is 16-bit audio at the project rate; playback
/// renders the mix and plays it, so tracks stay sample-locked on every device.
class StudioController extends ChangeNotifier {
  StudioController(this.engine, this.library) {
    _player.positionStream.listen((d) {
      position.value = _mixFrom + d.inMilliseconds / 1000;
    });
    _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        _player.pause();
        position.value = 0;
        _mixFrom = 0;
        _mixPath = null;
      }
      notifyListeners();
    });
  }

  final Engine engine;
  final Library library;

  Project project = Project.empty;
  final Map<String, Pcm> buffers = {};
  final Map<String, Float32List> peaks = {};
  Selection selection = Selection.none;
  String name = 'Untitled project';
  String? projectId;
  String createdAt = DateTime.now().toUtc().toIso8601String();
  final Set<String> _uploaded = {};
  final List<Project> _undo = [], _redo = [];
  final List<StudioJob> jobs = [];
  final Map<String, CancelToken> _cancels = {};

  /// The playhead, in seconds.
  final ValueNotifier<double> position = ValueNotifier(0);
  final _player = AudioPlayer();
  String? _mixPath;
  double _mixFrom = 0;
  int _render = 0;
  Timer? _rerender;

  bool busy = false;
  String notice = '';
  String saveState = '';
  bool dirty = false;

  bool get playing => _player.playing;
  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;
  bool get isEmpty => project.clips.isEmpty;

  void _changed() => notifyListeners();

  void reset() {
    for (final c in _cancels.values) {
      c.cancel();
    }
    _player.stop();
    project = Project.empty;
    buffers.clear();
    peaks.clear();
    selection = Selection.none;
    name = 'Untitled project';
    projectId = null;
    createdAt = DateTime.now().toUtc().toIso8601String();
    _uploaded.clear();
    _undo.clear();
    _redo.clear();
    jobs.clear();
    position.value = 0;
    _mixPath = null;
    notice = '';
    saveState = '';
    dirty = false;
    _changed();
  }

  /// Changes the project, keeping the old one for undo.
  void commit(Project Function(Project current) change) {
    final next = change(project);
    if (identical(next, project)) return;
    _undo.add(project);
    if (_undo.length > 60) _undo.removeAt(0);
    _redo.clear();
    _setProject(next);
  }

  void _setProject(Project next) {
    project = next;
    dirty = true;
    saveState = '';
    // Drop a selection that no longer exists.
    final ids = next.clips.map((c) => c.id).toSet();
    if (selection.clips.any((id) => !ids.contains(id))) selection = Selection(clips: selection.clips.where(ids.contains).toList());
    _mixChanged();
    _changed();
  }

  void undo() {
    if (_undo.isEmpty) return;
    _redo.add(project);
    _setProject(_undo.removeLast());
  }

  void redo() {
    if (_redo.isEmpty) return;
    _undo.add(project);
    _setProject(_redo.removeLast());
  }

  void rename(String value) {
    final next = value.trim();
    name = next.isEmpty ? 'Untitled project' : (next.length > 50 ? next.substring(0, 50) : next);
    dirty = true;
    _changed();
  }

  // ------------------------------------------------------------- audio in

  String _store(Pcm pcm) {
    final key = uid();
    buffers[key] = pcm;
    peaks[key] = _outline(pcm);
    return key;
  }

  static Float32List _outline(Pcm pcm) => wave.peaks(pcm, buckets: math.max(200, math.min(4000, (pcm.duration * 40).round())));

  /// Adds audio as a new track at [at] seconds.
  void addAudio(String trackName, Pcm pcm, double at) {
    final key = _store(pcm);
    commit((current) {
      final (next, track) = addTrack(current, trackName);
      return next.copyWith(clips: [
        ...next.clips,
        Clip(id: uid(), trackId: track.id, buffer: key, start: at, offset: 0, duration: pcm.duration, name: trackName),
      ]);
    });
  }

  Future<void> _opening(Future<void> Function() work) async {
    busy = true;
    notice = '';
    _changed();
    try {
      await work();
    } catch (e) {
      notice = describe(e);
    } finally {
      busy = false;
      _changed();
    }
  }

  /// Opens an audio file as a new track: at the start of an empty project, otherwise at the playhead.
  Future<void> openFile(String path, {String? name}) => _opening(() async {
    final pcm = await decodeAudioFile(path);
    if (pcm.duration < 0.2) throw const KikuException('That file has no audio in it.');
    final title = name ?? p.basenameWithoutExtension(path);
    final at = isEmpty ? 0.0 : position.value;
    if (isEmpty && this.name == 'Untitled project') rename(title);
    addAudio(title, pcm, at);
  });

  /// Opens a project from the library, audio and all.
  Future<void> openSaved(SavedProject entry) => _opening(() async {
    final loaded = <String, Pcm>{};
    for (final e in entry.audio.entries) {
      final bytes = await library.projectAudio(e.value);
      if (bytes != null) loaded[e.key] = await decodeAudio(bytes, name: e.value);
    }
    reset();
    buffers.addAll(loaded);
    for (final e in loaded.entries) {
      peaks[e.key] = _outline(e.value);
    }
    project = entry.project;
    name = entry.name;
    projectId = entry.id;
    createdAt = entry.createdAt.isEmpty ? createdAt : entry.createdAt;
    _uploaded.addAll(loaded.keys);
    dirty = false;
    saveState = 'saved';
    if (loaded.length < entry.audio.length) notice = 'Some of this project’s audio is missing from your library.';
    _mixChanged();
  });

  Future<void> save() async {
    saveState = 'saving';
    _changed();
    try {
      projectId ??= newId();
      await library.saveProject(
        id: projectId!,
        name: name,
        createdAt: createdAt,
        project: project,
        buffers: buffers,
        uploaded: _uploaded,
      );
      saveState = 'saved';
      dirty = false;
    } catch (e) {
      saveState = '';
      notice = describe(e);
    }
    _changed();
  }

  Future<File> _tempWav(Pcm pcm, String label) async {
    final dir = await getTemporaryDirectory();
    final file = File(p.join(dir.path, '$label-${DateTime.now().microsecondsSinceEpoch}.wav'));
    await file.writeAsBytes(await _wavOf(pcm), flush: true);
    return file;
  }

  /// The whole mix as a WAV file, for sharing.
  Future<File> exportMix() async {
    if (isEmpty) throw const KikuException('Add some audio first.');
    final snapshot = project, store = _audibleBuffers(project);
    final dir = await getTemporaryDirectory();
    final safe = name.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1f]'), '_');
    final file = File(p.join(dir.path, '${safe.isEmpty ? 'kiku-mix' : safe}.wav'));
    final bytes = await _mixWavOf(snapshot, store, 0, snapshot.end);
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Map<String, Pcm> _audibleBuffers(Project snapshot) => {
    for (final c in snapshot.clips)
      if (buffers[c.buffer] != null) c.buffer: buffers[c.buffer]!,
  };

  // ------------------------------------------------------------- mixer

  void setTrack(String id, Track Function(Track t) change) =>
      commit((current) => current.copyWith(tracks: current.tracks.map((t) => t.id == id ? change(t) : t).toList()));

  void deleteTrack(String id) => commit((current) => current.copyWith(
    tracks: current.tracks.where((t) => t.id != id).toList(),
    clips: current.clips.where((c) => c.trackId != id).toList(),
  ));

  void deleteClips(List<String> ids) {
    if (ids.isEmpty) return;
    selection = Selection.none;
    commit((current) => current.copyWith(clips: current.clips.where((c) => !ids.contains(c.id)).toList()));
  }

  void splitAtPlayhead() {
    final at = position.value;
    final ids = selection.clips.isNotEmpty
        ? selection.clips
        : project.clips.where((c) => c.start < at && c.end > at).map((c) => c.id).toList();
    commit((current) {
      var next = current;
      for (final id in ids) {
        next = splitClip(next, id, at);
      }
      return next;
    });
  }

  void useTake(String takeId, bool on) => commit((current) => selectTake(current, takeId, on));

  void selectClip(String? id) {
    selection = id == null ? Selection.none : Selection(clips: [id]);
    _changed();
  }

  void selectRange(String trackId, double a, double b) {
    final start = math.max(0.0, math.min(a, b)), end = math.max(a, b);
    selection = end - start < 0.05 ? Selection.none : Selection(range: Range(start, end, [trackId]));
    _changed();
  }

  // ------------------------------------------------------------- playback

  void _mixChanged() {
    _mixPath = null;
    if (!_player.playing) return;
    _rerender?.cancel();
    _rerender = Timer(const Duration(milliseconds: 250), () => play(from: position.value));
  }

  Future<void> play({double? from}) async {
    if (isEmpty) return;
    final start = (from ?? position.value).clamp(0.0, project.end);
    final at = start >= project.end - 0.05 ? 0.0 : start;
    final request = ++_render;
    if (_mixPath == null || from != null) {
      final snapshot = project, store = _audibleBuffers(project);
      final bytes = await _mixWavOf(snapshot, store, at, snapshot.end);
      if (request != _render) return;
      final dir = await getTemporaryDirectory();
      final file = File(p.join(dir.path, 'studio-mix-$request.wav'));
      await file.writeAsBytes(bytes, flush: true);
      if (request != _render) return;
      final old = _mixPath;
      _mixPath = file.path;
      _mixFrom = at;
      await _player.setFilePath(file.path);
      if (old != null) unawaited(File(old).delete().catchError((_) => File(old)));
    } else {
      await _player.seek(Duration(milliseconds: ((at - _mixFrom) * 1000).round()));
    }
    unawaited(_player.play());
    _changed();
  }

  Future<void> pause() async {
    _render++;
    await _player.pause();
    _changed();
  }

  Future<void> stop() async {
    _render++;
    await _player.pause();
    position.value = 0;
    _changed();
  }

  Future<void> seek(double seconds) async {
    final double end = math.max(0.0, project.end);
    final to = seconds.clamp(0.0, end);
    if (_player.playing) {
      await play(from: to);
    } else {
      position.value = to;
      if (_mixPath != null && to >= _mixFrom) {
        await _player.seek(Duration(milliseconds: ((to - _mixFrom) * 1000).round()));
      } else {
        _mixPath = null;
      }
    }
  }

  // ------------------------------------------------------------- AI jobs

  void _run(String label, double start, double end, Future<void> Function(CancelToken cancel, StudioJob job) work) {
    final job = StudioJob(uid(), label, start, end), cancel = CancelToken();
    jobs.add(job);
    _cancels[job.id] = cancel;
    _changed();
    work(cancel, job).then((_) {
      jobs.remove(job);
    }, onError: (Object e) {
      if (cancel.cancelled) {
        jobs.remove(job);
      } else {
        job.error = describe(e);
      }
    }).whenComplete(() {
      _cancels.remove(job.id);
      _changed();
    });
  }

  StatusFn _status(StudioJob job) => (text) {
    job.status = text;
    _changed();
  };

  ProgressFn _progress(StudioJob job) => (Progress p) {
    job.progress = p.fraction;
    job.queue = p.queue;
    if (p.eta != null) job.etaAt = DateTime.now().add(Duration(milliseconds: (p.eta! * 1000).round()));
    if (p.running) job.running ??= DateTime.now();
    _changed();
  };

  void cancelJob(String id) {
    _cancels[id]?.cancel();
    jobs.removeWhere((j) => j.id == id);
    _changed();
  }

  void dismissJob(String id) {
    jobs.removeWhere((j) => j.id == id);
    _changed();
  }

  Target _check(Target? target, {double min = 3, double max = _maxSeconds}) {
    if (target == null) throw const KikuException('Select a clip, or drag across one, first.');
    if (target.length < min) throw KikuException('Select at least ${min.round()} seconds.');
    if (target.length > max) throw KikuException('Select ${(max / 60).toStringAsFixed(max % 60 == 0 ? 0 : 1)} minutes or less at a time.');
    return target;
  }

  Target targetNow({double min = 3, double max = _maxSeconds}) => _check(targetOf(project, selection), min: min, max: max);

  /// The selected stretch as a WAV file: the clip's own audio, or the mix of several.
  Future<File> _source(Project snapshot, Target target, [double? start, double? end]) async {
    final store = {
      for (final c in target.clips)
        if (buffers[c.buffer] != null) c.buffer: buffers[c.buffer]!,
    };
    final only = target.clips.map((c) => c.id).toSet();
    final from = start ?? target.start, to = end ?? target.end;
    final pcm = await _mixOf(snapshot, store, from, to, only: only, mixer: only.length > 1);
    return _tempWav(pcm, 'selection');
  }

  Future<Pcm> _load(Object? file, CancelToken cancel) async {
    final download = Download.from(file);
    if (download == null) throw const KikuException('The engine did not return that audio.');
    final bytes = await engine.fetch(download, cancel: cancel);
    cancel.check();
    return decodeAudio(bytes, name: download.name);
  }

  Future<Map<String, dynamic>> _job(String name, Map<String, Object?> input, StudioJob job, CancelToken cancel,
          {File? audio, Model? model}) =>
      engine.run(name, input, audio: audio, model: model, cancel: cancel, status: _status(job), progress: _progress(job));

  /// Puts a result in the project. A result made from a selection becomes a
  /// take under its source and is used straight away, so it is heard in
  /// context; setting it aside brings the original back.
  void _place({
    required String label,
    required Project snapshot,
    required Target? target,
    required double at,
    required List<_Placed> items,
    required bool replace,
    required String model,
    required String style,
    String? lyrics,
    String? abc,
    Map<String, dynamic>? report,
    Map<String, dynamic>? analysis,
    String? status,
  }) {
    final warnings = <String>[
      if (report?['truncated'] == true || analysis?['truncated'] == true) 'The model stopped early. Listen for an incomplete ending.',
      if (target != null && analysis?['locked'] == false) 'The backing could not be locked to your bars. Check its timing.',
    ];
    final generation = <String, dynamic>{
      'model': model,
      'style': style,
      'lyrics': ?lyrics,
      'seed': ?report?['seed'],
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'sourceClips': target?.clips.map((c) => c.id).toList() ?? const <String>[],
      'status': ?status,
    };
    final made = [for (final item in items) (item, _store(item.pcm))];
    final source = replace && target != null ? TakeSource(tracks: target.tracks, start: target.start, end: target.end) : null;
    final takeId = uid();
    commit((current) {
      var next = current;
      String? after = source != null ? takeAnchor(current, source.tracks) : null;
      for (final (item, key) in made) {
        final (withTrack, track) = addTrack(next, item.name, after: after);
        after = track.id;
        next = withTrack.copyWith(
          tracks: source == null
              ? withTrack.tracks
              : withTrack.tracks
                    .map((t) => t.id == track.id
                        ? t.copyWith(mute: true, take: Take(id: takeId, label: label, selected: false, source: source, warnings: warnings))
                        : t)
                    .toList(),
          clips: [
            ...withTrack.clips,
            Clip(
              id: uid(),
              trackId: track.id,
              buffer: key,
              start: at,
              offset: 0,
              duration: item.pcm.duration,
              name: item.name,
              generation: generation,
              score: abc != null && abc.isNotEmpty ? {'abc': abc, 'lyrics': lyrics ?? ''} : null,
            ),
          ],
        );
      }
      if (source != null) next = selectTake(next, takeId, true);
      // Adopt what the engine measured unless the user changed it while the job ran.
      if (analysis != null) {
        final tempo = analysis['tempo'], key = analysis['key'], chords = analysis['chords'];
        next = next.copyWith(
          bpm: tempo is num && tempo > 0 && current.bpm == snapshot.bpm ? (tempo * 10).round() / 10 : null,
          key: key is String && key.isNotEmpty && current.key == snapshot.key ? key : null,
          chords: chords is List && chords.isNotEmpty && current.chords.length == snapshot.chords.length
              ? [
                  for (final c in chords.whereType<Map>())
                    if (c['time'] is num) Chord((c['time'] as num).toDouble() + at, (c['name'] ?? '').toString()),
                ]
              : null,
        );
      }
      return next;
    });
  }

  /// Restyle: keep the selection's structure while the prompt changes its sound.
  void restyle({required String style, required double change, required String lyrics, required Model model}) {
    final snapshot = project, target = targetNow();
    _run('Restyle · ${model.label}', target.start, target.end, (cancel, job) async {
      final audio = await _source(snapshot, target);
      final result = await _job('remix', {'style': style, 'change': change, 'lyrics': lyrics, 'meta': '{}'}, job, cancel, audio: audio, model: model);
      final full = await _load(result['audio'], cancel);
      _place(
        label: 'Restyle',
        snapshot: snapshot,
        target: target,
        at: target.start,
        items: [_Placed('Restyled', full.slice(0, math.min(full.duration, target.length)))],
        replace: true,
        model: model.label,
        style: style,
        report: (result['report'] as Map?)?.cast<String, dynamic>(),
        status: result['status']?.toString(),
      );
    });
  }

  /// Rewrite just the selected stretch, in context: a few seconds either side go with it.
  void rewrite({required String style, required double variance, required String lyrics, required Model model}) {
    final snapshot = project;
    // ACE-Step 1.5 repaints regions of 3 to 90 seconds.
    final target = model == Model.ace15 ? targetNow(min: 3, max: 90) : targetNow(min: 1);
    final from = target.clips.map((c) => c.start).reduce(math.min), to = target.clips.map((c) => c.end).reduce(math.max);
    var lo = math.max(from, target.start - 8), hi = math.min(to, target.end + 8);
    if (hi - lo < 3) {
      lo = math.max(0.0, math.min(lo, target.end - 3));
      hi = math.max(hi, lo + 3);
    }
    if (hi - lo > _maxSeconds) throw const KikuException('Select four minutes or less.');
    _run('Rewrite · ${model.label}', target.start, target.end, (cancel, job) async {
      final audio = await _source(snapshot, target, lo, hi);
      final result = await _job('repaint', {
        'style': style,
        'lyrics': lyrics,
        'start': target.start - lo,
        'end': target.end - lo,
        'variance': variance,
        'meta': '{}',
      }, job, cancel, audio: audio, model: model);
      final full = await _load(result['audio'], cancel);
      _place(
        label: 'Rewrite',
        snapshot: snapshot,
        target: target,
        at: target.start,
        items: [_Placed('Rewritten', full.slice(target.start - lo, target.end - lo))],
        replace: true,
        model: model.label,
        style: style,
        report: (result['report'] as Map?)?.cast<String, dynamic>(),
        status: result['status']?.toString(),
      );
    });
  }

  /// Continue one clip past its end.
  void extend({required String style, required double seconds, required String lyrics, required Model model}) {
    final snapshot = project, target = targetNow(max: 200);
    final clip = target.sole;
    if (target.range != null || clip == null) throw const KikuException('Select one clip to extend.');
    final original = buffers[clip.buffer];
    if (original == null) throw const KikuException('The original audio is unavailable.');
    _run('Extend · ${model.label}', clip.start, clip.end + seconds, (cancel, job) async {
      final audio = await _source(snapshot, target);
      final result = await _job('extend', {'style': style, 'seconds': seconds, 'lyrics': lyrics}, job, cancel, audio: audio, model: model);
      final full = await _load(result['audio'], cancel);
      final join = math.max(0.5, clip.duration - 0.3);
      if (full.duration <= join) throw const KikuException('The model did not return a continuation.');
      final kept = original.slice(clip.offset, clip.offset + clip.duration);
      final joined = await _spliceOf(kept, join, full.slice(join, full.duration));
      _place(
        label: 'Extend',
        snapshot: snapshot,
        target: target,
        at: clip.start,
        items: [_Placed('Extended', joined)],
        replace: true,
        model: model.label,
        style: style,
        status: result['status']?.toString(),
      );
    });
  }

  /// Perform the selection's tune in a new style with YuE2.
  void cover({required String style, required String lyrics, required bool sing, required bool keepHarmony}) {
    final snapshot = project, target = targetNow(max: _scoreMax);
    final label = sing ? 'AI cover' : 'Instrumental cover';
    _run('Cover · YuE2', target.start, target.end, (cancel, job) async {
      final audio = await _source(snapshot, target);
      final result = await _job('cover', {
        'style': style,
        'lyrics': lyrics,
        'voice': sing ? 'sing' : 'play',
        'harmony': keepHarmony ? 'keep' : 'free',
      }, job, cancel, audio: audio, model: Model.yue2);
      final pcm = await _load(result['audio'], cancel);
      _place(
        label: label,
        snapshot: snapshot,
        target: target,
        at: target.start,
        items: [_Placed(label, pcm)],
        replace: true,
        model: 'YuE2',
        style: style,
        lyrics: result['lyrics']?.toString(),
        abc: result['abc']?.toString(),
        report: (result['report'] as Map?)?.cast<String, dynamic>(),
        status: result['status']?.toString(),
      );
    });
  }

  /// Separate the selection into vocals, drums, bass and everything else.
  void stems() {
    final snapshot = project, target = targetNow(max: 360);
    _run('Separate stems', target.start, target.end, (cancel, job) async {
      final audio = await _source(snapshot, target);
      final result = await _job('split', const {}, job, cancel, audio: audio);
      final parts = await Future.wait([
        for (final name in ['vocals', 'drums', 'bass', 'other']) _load(result[name], cancel),
      ]);
      _place(
        label: 'Stems',
        snapshot: snapshot,
        target: target,
        at: target.start,
        items: [for (int i = 0; i < 4; i++) _Placed(const ['Vocals', 'Drums', 'Bass', 'Other'][i], parts[i])],
        replace: true,
        model: 'Demucs',
        style: 'Stem separation',
        status: result['status']?.toString(),
      );
    });
  }

  /// The words sung in the selection, handed to [done].
  void words(void Function(String lyrics) done) {
    final snapshot = project, target = targetNow(max: _scoreMax);
    _run('Reading the words', target.start, target.end, (cancel, job) async {
      final audio = await _source(snapshot, target);
      final result = await _job('lyrics', const {}, job, cancel, audio: audio);
      final text = (result['lyrics'] ?? '').toString();
      if (text.trim().isEmpty) throw const KikuException('No words were found in this stretch.');
      done(text);
    });
  }

  /// Write one instrument's part, following the project's music when asked.
  void part({
    required String instrument,
    required String label,
    required String style,
    required bool follow,
    required double duration,
    required double strength,
    required Model model,
  }) {
    final snapshot = project, end = snapshot.end, playhead = position.value;
    final following = follow && snapshot.clips.any((c) => !c.muted);
    if (following && end < 3) throw const KikuException('Add at least three seconds of music to follow.');
    final at = following ? (end > _maxSeconds && playhead < end - 3 ? playhead : 0.0) : playhead;
    final until = following ? math.min(end, at + _maxSeconds) : at + duration;
    _run('$label · ${model.label}', at, until, (cancel, job) async {
      File? audio;
      if (following) {
        final store = _audibleBuffers(snapshot);
        final pcm = await _mixOf(snapshot, store, at, until);
        audio = await _tempWav(pcm, 'project');
      }
      final result = await _job('part', {
        'instrument': instrument,
        'style': style,
        'bpm': snapshot.chords.isNotEmpty || !following ? snapshot.bpm : 0,
        'key': snapshot.key,
        'duration': duration,
        'strength': strength,
      }, job, cancel, audio: audio, model: model);
      final pcm = await _load(result['audio'], cancel);
      _place(
        label: label,
        snapshot: snapshot,
        target: null,
        at: at,
        items: [_Placed(label, pcm)],
        replace: false,
        model: model.label,
        style: style,
        analysis: snapshot.chords.isNotEmpty ? null : (result['analysis'] as Map?)?.cast<String, dynamic>(),
        status: result['status']?.toString(),
      );
    });
  }

  /// An instrumental or a song with vocals at the playhead.
  void generate({required bool song, required String style, required String lyrics, required double duration, required Model model}) {
    if (style.trim().isEmpty) throw const KikuException('Describe the sound you want.');
    if (song && lyrics.trim().isEmpty) throw const KikuException('Add lyrics, marked with [verse] and [chorus].');
    final snapshot = project, at = position.value;
    final label = song ? 'Song' : 'Instrumental';
    _run('$label · ${model.label}', at, at + duration, (cancel, job) async {
      final result = song
          ? await _job('song', {'style': style, 'lyrics': lyrics, 'cot': 'full', 'abc': '', 'seed': -1, 'duration': -1, 'meta': jsonEncode(const {})}, job, cancel, model: model)
          : await _job('instrumental', {'style': style, 'lyrics': '', 'duration': duration, 'abc': '', 'seed': -1}, job, cancel, model: model);
      final pcm = await _load(result['audio'], cancel);
      _place(
        label: label,
        snapshot: snapshot,
        target: null,
        at: at,
        items: [_Placed(label, pcm)],
        replace: false,
        model: model.label,
        style: style,
        lyrics: song ? lyrics : null,
        abc: result['abc']?.toString(),
        report: (result['report'] as Map?)?.cast<String, dynamic>() ?? {if (result['seed'] != null) 'seed': result['seed']},
        status: result['status']?.toString(),
      );
    });
  }

  @override
  void dispose() {
    for (final c in _cancels.values) {
      c.cancel();
    }
    _rerender?.cancel();
    _player.dispose();
    position.dispose();
    super.dispose();
  }
}

// Work for other isolates lives in top-level functions, so each closure
// carries only its arguments and never the controller.
Future<Uint8List> _wavOf(Pcm pcm) => Isolate.run(() => encodeWav(pcm));

Future<Pcm> _mixOf(Project project, Map<String, Pcm> store, double start, double end, {Set<String>? only, bool mixer = true}) =>
    Isolate.run(() => renderMix(project, store, start: start, end: end, only: only, mixer: mixer));

Future<Uint8List> _mixWavOf(Project project, Map<String, Pcm> store, double start, double end) =>
    Isolate.run(() => encodeWav(renderMix(project, store, start: start, end: end)));

Future<Pcm> _spliceOf(Pcm kept, double join, Pcm tail) => Isolate.run(() => Pcm.splice(kept, join, tail, 0.3));
