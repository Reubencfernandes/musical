import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../api/engine.dart';
import '../api/errors.dart';
import '../api/gradio.dart';
import '../api/kiku_server.dart';
import '../api/library.dart';
import '../audio/flac.dart';
import '../audio/wav.dart';
import '../auth/session.dart';

/// A song in the list: from the library, or made here and not saved yet.
class SongItem {
  SongItem(this.song, {this.local, this.cover, this.saved = true});
  Song song;

  /// The audio on this device, once made or fetched.
  File? local;
  Uint8List? cover;
  bool saved;
}

/// A song being made, driving a progress row like the web app's.
class Making {
  Making(this.id, this.title) : began = DateTime.now();
  final String id, title;
  final DateTime began;
  String status = 'Starting…';
  DateTime? running, etaAt;
  double? progress;
  int? queue;
  String? error;

  double get shown {
    if (error != null) return 0;
    final now = DateTime.now();
    if (running == null) return (now.difference(began).inMilliseconds / 1000 / 1200).clamp(0.0, 0.05);
    final elapsed = now.difference(running!).inMilliseconds / 1000;
    final eta = etaAt;
    final guess = eta != null ? elapsed / (elapsed + (eta.difference(now).inMilliseconds / 1000).clamp(1.0, 1e9)) : 1 - 1 / (1 + elapsed / 75);
    final known = progress ?? 0.0;
    return (known > guess * 0.97 ? known : guess * 0.97).clamp(0.0, 0.97);
  }
}

/// How to describe a song: a one-line idea (Simple) or style and lyrics (Custom).
class SongRequest {
  const SongRequest.simple({required String this.idea, required this.instrumental, this.model = Model.ace15})
    : caption = '',
      lyrics = '',
      duration = null,
      meta = null;
  const SongRequest.custom({
    required this.caption,
    required this.lyrics,
    required this.instrumental,
    required this.model,
    this.duration,
    this.meta,
  }) : idea = null;
  final String? idea;
  final String caption, lyrics;
  final bool instrumental;
  final Model model;
  final int? duration;
  final Map<String, dynamic>? meta;
  bool get simple => idea != null;
}

String _titleCase(String text) => text.replaceAllMapped(RegExp(r'\b\w'), (m) => m[0]!.toUpperCase());

/// A working title from the idea or the first phrase of the style; the user can rename it.
String titleFrom(String text) {
  final words = text.split(RegExp(r'[,.;:\n]')).first.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(6).join(' ');
  final title = _titleCase(words.isEmpty ? 'Untitled song' : words);
  return title.length > 60 ? title.substring(0, 60) : title;
}

/// The user's songs: what is in their library plus what was made here, and the
/// songs being made. Simple mode lets ACE-Step's language model write the
/// style and lyrics first, as on the web.
class SongsController extends ChangeNotifier {
  SongsController(this.engine, this.library, this.auth);
  final Engine engine;
  final Library library;
  final AuthService auth;

  final List<SongItem> songs = [];
  final List<Making> making = [];
  final Set<String> painting = {};
  final _cancels = <String, CancelToken>{};
  final _removed = <String>{};
  bool loading = false;
  String error = '';
  String? _loadedFor;

  void _changed() => notifyListeners();

  /// Loads the library once per signed-in user; [force] reloads.
  Future<void> reload({bool force = false}) async {
    final user = auth.user;
    if (user == null) return;
    if (!force && _loadedFor == user.id) return;
    _loadedFor = user.id;
    loading = true;
    error = '';
    _changed();
    try {
      final saved = await library.listSongs();
      songs
        ..removeWhere((s) => s.saved)
        ..addAll(saved.map(SongItem.new));
      for (final item in songs.where((s) => s.saved && s.song.cover != null && s.cover == null)) {
        unawaited(library.songCover(item.song.id).then((bytes) {
          if (bytes != null) {
            item.cover = bytes;
            _changed();
          }
        }).catchError((_) {}));
      }
    } catch (e) {
      error = describe(e);
    } finally {
      loading = false;
      _changed();
    }
  }

  void clear() {
    for (final c in _cancels.values) {
      c.cancel();
    }
    songs.clear();
    making.clear();
    _loadedFor = null;
    _changed();
  }

  /// A local file of the song's audio, fetching it from the library the first time.
  Future<String> audioPath(SongItem item) async {
    final local = item.local;
    if (local != null && await local.exists()) return local.path;
    final file = await library.songAudio(item.song);
    if (file == null) throw const KikuException('This song’s audio is missing from your library.');
    item.local = file;
    return file.path;
  }

  Future<File> _localFile(String id, String extension) async {
    final dir = Directory(p.join((await getApplicationSupportDirectory()).path, 'songs'));
    await dir.create(recursive: true);
    return File(p.join(dir.path, '$id.$extension'));
  }

  void create(SongRequest request) {
    final id = newId(), cancel = CancelToken();
    _cancels[id] = cancel;
    final row = Making(id, titleFrom(request.idea ?? request.caption));
    making.insert(0, row);
    _changed();
    void status(String text) {
      row.status = text;
      _changed();
    }

    void progress(Progress p) {
      row.progress = p.fraction;
      row.queue = p.queue;
      if (p.eta != null) row.etaAt = DateTime.now().add(Duration(milliseconds: (p.eta! * 1000).round()));
      if (p.running) row.running ??= DateTime.now();
      _changed();
    }

    () async {
      String caption = request.caption, lyrics = request.instrumental ? '' : request.lyrics;
      Map<String, dynamic>? meta = request.meta;
      int? duration = request.duration;
      final model = request.model;
      if (request.simple) {
        status('Writing the lyrics and style…');
        final idea = await engine.run('sample', {'query': request.idea, 'instrumental': '${request.instrumental}', 'language': ''},
            cancel: cancel, status: status, progress: progress);
        caption = (idea['caption'] ?? '').toString();
        lyrics = request.instrumental ? '' : (idea['lyrics'] ?? '').toString();
        meta = (idea['meta'] as Map?)?.cast<String, dynamic>();
        duration = (meta?['duration'] as num?)?.round();
        // The performance starts its own clock: writing the idea was a separate GPU call.
        row
          ..running = null
          ..progress = null
          ..etaAt = null;
      }
      final instrumental = request.instrumental || lyrics.trim().isEmpty;
      final result = instrumental
          ? await engine.run('instrumental', {'style': caption, 'lyrics': '', 'duration': (duration ?? 60).clamp(10, 240), 'abc': '', 'seed': -1},
              model: model, cancel: cancel, status: status, progress: progress)
          : await engine.run('song', {
              'style': caption,
              'lyrics': lyrics,
              'cot': 'full',
              'abc': '',
              'seed': -1,
              'duration': duration ?? -1,
              'meta': jsonEncode(meta ?? const {}),
            }, model: model, cancel: cancel, status: status, progress: progress);
      final download = Download.from(result['audio']);
      if (download == null) throw const KikuException('The engine did not return the song.');
      status('Preparing your song…');
      final bytes = await engine.fetch(download, cancel: cancel);
      cancel.check();
      // Keep it as FLAC: about half a WAV, and both the app and browsers play it.
      final (flac, seconds) = await _asFlac(bytes);
      final file = await _localFile(id, 'flac');
      await file.writeAsBytes(flac, flush: true);
      final report = result['report'];
      final song = Song(
        id: id,
        title: row.title,
        caption: caption,
        lyrics: lyrics,
        instrumental: instrumental,
        model: model.name,
        duration: seconds,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        seed: (result['seed'] as num?)?.toInt() ?? (report is Map ? (report['seed'] as num?)?.toInt() : null),
        meta: meta,
        idea: request.idea,
      );
      final item = SongItem(song, local: file, saved: false);
      songs.insert(0, item);
      making.remove(row);
      _changed();
      final artwork = engine.cover(title: song.title, caption: caption, lyrics: lyrics).then<(Uint8List, int?)?>((c) => c).catchError((_) => null);
      await _keep(item, flac);
      final art = await artwork;
      if (art == null || _removed.contains(id)) return;
      item.cover = art.$1;
      final metadata = {'model': 'carlofkl/DreamLite-base', 'license': 'CC-BY-NC-4.0', if (art.$2 != null) 'seed': art.$2};
      item.song = item.song.copyWith(cover: metadata);
      _changed();
      if (item.saved) {
        try {
          await library.saveSongCover(item.song, art.$1, metadata);
        } catch (_) {
          // The audio is saved; the artwork is optional.
        }
      }
    }().catchError((Object e) {
      if (cancel.cancelled) {
        making.remove(row);
      } else {
        row.error = describe(e);
        if (e is SignedOut) error = 'Your sign-in expired. Sign in again to keep making songs.';
      }
      _changed();
    }).whenComplete(() => _cancels.remove(id));
  }

  /// Saves a song made here; without permission it stays on this device, marked unsaved.
  Future<void> _keep(SongItem item, Uint8List flac) async {
    if (!(auth.user?.storage ?? false)) {
      error = 'Songs stay on this device until Kiku AI may save to your Hugging Face account. Sign in again and allow saving.';
      _changed();
      return;
    }
    try {
      item.song = await library.saveSong(item.song, flac, 'flac', cover: item.cover);
      item.saved = true;
    } catch (e) {
      error = e is NeedsStorage ? e.toString() : 'Saved on this device, but not to your library: ${describe(e)}';
    }
    _changed();
  }

  /// Saves songs that are only on this device, after permission is granted.
  Future<void> saveUnsaved() async {
    for (final item in songs.where((s) => !s.saved).toList()) {
      final local = item.local;
      if (local != null && await local.exists()) await _keep(item, await local.readAsBytes());
    }
  }

  void cancel(String id) {
    _cancels[id]?.cancel();
    making.removeWhere((m) => m.id == id);
    _changed();
  }

  void dismiss(String id) {
    making.removeWhere((m) => m.id == id);
    _changed();
  }

  Future<void> remove(SongItem item) async {
    _removed.add(item.song.id);
    _cancels[item.song.id]?.cancel();
    if (item.saved) await library.deleteSong(item.song);
    songs.remove(item);
    final local = item.local;
    if (local != null && await local.exists()) await local.delete();
    _changed();
  }

  Future<void> rename(SongItem item, String title) async {
    final next = title.trim().length > 80 ? title.trim().substring(0, 80) : title.trim();
    if (next.isEmpty || next == item.song.title) return;
    item.song = item.song.copyWith(title: next);
    _changed();
    if (item.saved) await library.renameSong(item.song, next);
  }

  /// Cover art on request: songs made before covers existed, or a new take on one.
  Future<void> paint(SongItem item) async {
    painting.add(item.song.id);
    _changed();
    try {
      final (bytes, seed) = await engine.cover(title: item.song.title, caption: item.song.caption, lyrics: item.song.lyrics);
      if (_removed.contains(item.song.id)) return;
      final metadata = {'model': 'carlofkl/DreamLite-base', 'license': 'CC-BY-NC-4.0', if (seed != null) 'seed': seed};
      item
        ..cover = bytes
        ..song = item.song.copyWith(cover: metadata);
      if (item.saved) await library.saveSongCover(item.song, bytes, metadata);
    } finally {
      painting.remove(item.song.id);
      _changed();
    }
  }
}

/// The song as FLAC and its length, worked out on another isolate. Top level,
/// so the closure carries only the bytes.
Future<(Uint8List, double)> _asFlac(Uint8List bytes) => Isolate.run(() {
  final pcm = isWav(bytes) ? decodeWav(bytes) : decodeFlac(bytes);
  return (isFlac(bytes) ? bytes : encodeFlac(pcm), pcm.duration);
});
