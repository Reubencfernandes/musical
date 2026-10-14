import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../audio/pcm.dart';
import '../audio/wav.dart';
import '../auth/session.dart';
import '../config.dart';
import '../studio/project.dart';
import 'errors.dart';
import 'hub.dart';

/// Ids sort by creation time, like the web app's: base-36 milliseconds and a random tail.
String newId() => '${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-${uid().substring(0, 8)}';

class Song {
  const Song({
    required this.id,
    required this.title,
    required this.caption,
    required this.lyrics,
    required this.instrumental,
    required this.model,
    required this.duration,
    required this.createdAt,
    this.seed,
    this.meta,
    this.idea,
    this.cover,
    this.audio,
  });
  final String id, title, caption, lyrics, model, createdAt;
  final bool instrumental;
  final double duration;
  final int? seed;
  final Map<String, dynamic>? meta, cover;
  final String? idea;

  /// The audio's path in the library when it is not songs/<id>.mp3.
  final String? audio;

  String get audioPath => audio != null && audio!.startsWith('songs/$id.') ? audio! : 'songs/$id.mp3';

  Song copyWith({String? title, Map<String, dynamic>? cover, String? audio}) => Song(
    id: id,
    title: title ?? this.title,
    caption: caption,
    lyrics: lyrics,
    instrumental: instrumental,
    model: model,
    duration: duration,
    createdAt: createdAt,
    seed: seed,
    meta: meta,
    idea: idea,
    cover: cover ?? this.cover,
    audio: audio ?? this.audio,
  );

  factory Song.fromJson(Map<String, dynamic> j) => Song(
    id: j['id'] as String,
    title: j['title'] as String? ?? 'Untitled song',
    caption: j['caption'] as String? ?? '',
    lyrics: j['lyrics'] as String? ?? '',
    instrumental: j['instrumental'] == true,
    model: j['model'] as String? ?? 'ace15',
    duration: (j['duration'] as num?)?.toDouble() ?? 0,
    createdAt: j['createdAt'] as String? ?? '',
    seed: (j['seed'] as num?)?.toInt(),
    meta: (j['meta'] as Map?)?.cast<String, dynamic>(),
    idea: j['idea'] as String?,
    cover: (j['cover'] as Map?)?.cast<String, dynamic>(),
    audio: j['audio'] as String?,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'caption': caption,
    'lyrics': lyrics,
    'instrumental': instrumental,
    'model': model,
    if (seed != null) 'seed': seed,
    'duration': duration,
    'createdAt': createdAt,
    if (meta != null) 'meta': meta,
    if (idea != null) 'idea': idea,
    if (cover != null) 'cover': cover,
    if (audio != null) 'audio': audio,
  };
}

class SavedScore {
  const SavedScore({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.abc,
    required this.duration,
    this.timing,
    this.audio,
  });
  final String id, title, createdAt, abc;
  final double duration;
  final Map<String, dynamic>? timing;
  final String? audio;

  String get audioPath => audio != null && audio!.startsWith('scores/$id.') ? audio! : 'scores/$id.mp3';

  factory SavedScore.fromJson(Map<String, dynamic> j) => SavedScore(
    id: j['id'] as String,
    title: j['title'] as String? ?? 'Score',
    createdAt: j['createdAt'] as String? ?? '',
    abc: j['abc'] as String? ?? '',
    duration: (j['duration'] as num?)?.toDouble() ?? 0,
    timing: (j['timing'] as Map?)?.cast<String, dynamic>(),
    audio: j['audio'] as String?,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'createdAt': createdAt,
    'abc': abc,
    if (timing != null) 'timing': timing,
    'duration': duration,
    if (audio != null) 'audio': audio,
  };
}

class SavedProject {
  const SavedProject({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    required this.duration,
    required this.tracks,
    required this.project,
    required this.audio,
  });
  final String id, name, createdAt, updatedAt;
  final double duration;
  final int tracks;
  final Project project;

  /// Buffer key to its WAV file in the library.
  final Map<String, String> audio;

  factory SavedProject.fromJson(Map<String, dynamic> j) => SavedProject(
    id: j['id'] as String,
    name: j['name'] as String? ?? 'Untitled project',
    createdAt: j['createdAt'] as String? ?? '',
    updatedAt: j['updatedAt'] as String? ?? '',
    duration: (j['duration'] as num?)?.toDouble() ?? 0,
    tracks: (j['tracks'] as num?)?.toInt() ?? 0,
    project: Project.fromJson((j['project'] as Map?)?.cast<String, dynamic>() ?? const {}),
    audio: {
      for (final e in ((j['audio'] as Map?) ?? const {}).entries)
        if (e.value is Map && (e.value as Map)['path'] is String) e.key.toString(): (e.value as Map)['path'] as String,
    },
  );
}

const _limit = 60;

/// Each user's library: a private dataset in their own Hugging Face account,
/// `<username>/kiku-ai-library`, the same one the web app writes, laid out the
/// same way so songs, projects and scores move freely between web and phone.
class Library {
  Library(this.auth);
  final AuthService auth;
  Future<void>? _ready;
  String? _readyFor;

  String get repo {
    final user = auth.user;
    if (user == null) throw const SignedOut();
    return '${user.handle}/${Defaults.library}';
  }

  /// The browser page of the library on Hugging Face.
  Uri get page => Uri.parse('https://huggingface.co/datasets/$repo');

  Future<T> _with<T>(Future<T> Function(HubClient hub) work) async {
    final hub = HubClient(auth.token);
    try {
      return await work(hub);
    } on SignedOut {
      auth.expire();
      rethrow;
    } finally {
      hub.close();
    }
  }

  Future<void> _ensure(HubClient hub) {
    final name = repo;
    if (_readyFor != name) _ready = null;
    _readyFor = name;
    return _ready ??= () async {
      if (!await hub.exists(name)) await hub.create(Defaults.library);
    }().catchError((Object error) {
      _ready = null;
      throw error;
    });
  }

  Future<void> _commit(String summary, {List<HubFile> add = const [], List<String> delete = const []}) => _with((hub) async {
    await _ensure(hub);
    await hub.commit(repo, summary, add: add, delete: delete);
  });

  Future<Uint8List?> _read(String path) => _with((hub) => hub.download(repo, path));

  Future<Map<String, dynamic>?> _readJson(String path) async {
    final bytes = await _read(path);
    if (bytes == null) return null;
    final value = jsonDecode(utf8.decode(bytes));
    return value is Map ? value.cast<String, dynamic>() : null;
  }

  /// Paths in one folder, newest first: ids start with their creation time.
  Future<List<HubEntry>> _folder(String path) => _with((hub) async {
    final found = await hub.list(repo, path);
    return [...found]..sort((a, b) => b.path.compareTo(a.path));
  });

  static Uint8List _json(Object value) => Uint8List.fromList(utf8.encode(const JsonEncoder.withIndent(' ').convert(value)));

  /// Saves a library file to the cache for playback and returns it.
  Future<File> _cached(String path, Uint8List bytes) async {
    final dir = Directory(p.join((await getTemporaryDirectory()).path, 'kiku-library'));
    await dir.create(recursive: true);
    final file = File(p.join(dir.path, path.replaceAll('/', '_')));
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  // ------------------------------------------------------------------ songs

  Future<List<Song>> listSongs() async {
    final files = (await _folder('songs')).where((f) => f.path.endsWith('.json')).take(_limit).toList();
    final songs = await Future.wait(files.map((f) => _readJson(f.path).then((j) => j == null ? null : Song.fromJson(j)).catchError((_) => null)));
    return songs.whereType<Song>().toList();
  }

  Future<Song?> loadSong(String id) async {
    final j = await _readJson('songs/$id.json');
    return j == null ? null : Song.fromJson(j);
  }

  /// The song's audio as a local file, fetched once.
  Future<File?> songAudio(Song song) async {
    final bytes = await _read(song.audioPath);
    return bytes == null ? null : _cached(song.audioPath, bytes);
  }

  Future<Uint8List?> songCover(String id) => _read('songs/$id.webp');

  /// Saves a song with its audio (FLAC from this app) and optional cover.
  Future<Song> saveSong(Song song, Uint8List audio, String extension, {Uint8List? cover}) async {
    final saved = extension == 'mp3' ? song : song.copyWith(audio: 'songs/${song.id}.$extension');
    await _commit('Save song: ${song.title}', add: [
      HubFile('songs/${song.id}.json', _json(saved.toJson())),
      HubFile(saved.audioPath, audio),
      if (cover != null) HubFile('songs/${song.id}.webp', cover),
    ]);
    return saved;
  }

  /// Adds artwork, merging into the latest metadata so a rename is kept.
  Future<void> saveSongCover(Song song, Uint8List cover, Map<String, dynamic> metadata) async {
    final current = await loadSong(song.id);
    if (current == null) return;
    await _commit('Save artwork: ${current.title}', add: [
      HubFile('songs/${song.id}.json', _json(current.copyWith(cover: metadata).toJson())),
      HubFile('songs/${song.id}.webp', cover),
    ]);
  }

  Future<void> renameSong(Song song, String title) async {
    final current = await loadSong(song.id);
    if (current == null) return;
    await _commit('Rename song: $title', add: [HubFile('songs/${song.id}.json', _json(current.copyWith(title: title).toJson()))]);
  }

  Future<void> deleteSong(Song song) async {
    final current = await loadSong(song.id) ?? song;
    await _commit('Delete song: ${song.title}', delete: [
      'songs/${song.id}.json',
      current.audioPath,
      if (current.cover != null) 'songs/${song.id}.webp',
    ]);
  }

  // ---------------------------------------------------------------- projects

  Future<List<SavedProject>> listProjects() async {
    final dirs = (await _folder('projects')).where((f) => !f.isFile).take(_limit).toList();
    final found = await Future.wait(dirs.map((d) =>
        _readJson('${d.path}/project.json').then((j) => j == null ? null : SavedProject.fromJson(j)).catchError((_) => null)));
    return found.whereType<SavedProject>().toList()..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<SavedProject?> loadProject(String id) async {
    final j = await _readJson('projects/$id/project.json');
    return j == null ? null : SavedProject.fromJson(j);
  }

  Future<Uint8List?> projectAudio(String path) => _read(path);

  /// Saves a studio project. Buffers never change once made, so each is
  /// uploaded once; later saves send the project file and any new audio.
  Future<void> saveProject({
    required String id,
    required String name,
    required String createdAt,
    required Project project,
    required Map<String, Pcm> buffers,
    required Set<String> uploaded,
  }) async {
    final keys = project.clips.map((c) => c.buffer).toSet();
    final audio = <String, Map<String, String>>{};
    final files = <HubFile>[];
    for (final key in keys) {
      final path = 'projects/$id/audio/$key.wav';
      audio[key] = {'path': path};
      final buffer = buffers[key];
      if (!uploaded.contains(key) && buffer != null) files.add(HubFile(path, encodeWav(buffer)));
    }
    final entry = {
      'id': id,
      'name': name,
      'createdAt': createdAt,
      'updatedAt': DateTime.now().toUtc().toIso8601String(),
      'duration': project.end,
      'tracks': project.tracks.length,
      'project': project.toJson(),
      'audio': audio,
    };
    files.insert(0, HubFile('projects/$id/project.json', _json(entry)));
    await _commit('Save project: $name', add: files);
    uploaded.addAll(keys);
  }

  Future<void> deleteProject(SavedProject entry) => _commit('Delete project: ${entry.name}',
      delete: ['projects/${entry.id}/project.json', ...entry.audio.values]);

  // ------------------------------------------------------------------ scores

  Future<List<SavedScore>> listScores() async {
    final files = (await _folder('scores')).where((f) => f.path.endsWith('.json')).take(_limit).toList();
    final found = await Future.wait(files.map((f) => _readJson(f.path).then((j) => j == null ? null : SavedScore.fromJson(j)).catchError((_) => null)));
    return found.whereType<SavedScore>().toList();
  }

  Future<SavedScore?> loadScore(String id) async {
    final j = await _readJson('scores/$id.json');
    return j == null ? null : SavedScore.fromJson(j);
  }

  Future<File?> scoreAudio(SavedScore score) async {
    final bytes = await _read(score.audioPath);
    return bytes == null ? null : _cached(score.audioPath, bytes);
  }

  Future<void> saveScore(SavedScore score, Uint8List audio, String extension) async {
    final path = extension == 'mp3' ? 'scores/${score.id}.mp3' : 'scores/${score.id}.$extension';
    final saved = SavedScore(
      id: score.id,
      title: score.title,
      createdAt: score.createdAt,
      abc: score.abc,
      duration: score.duration,
      timing: score.timing,
      audio: extension == 'mp3' ? null : path,
    );
    await _commit('Save score: ${score.title}', add: [HubFile('scores/${score.id}.json', _json(saved.toJson())), HubFile(path, audio)]);
  }

  Future<void> deleteScore(SavedScore score) =>
      _commit('Delete score: ${score.title}', delete: ['scores/${score.id}.json', score.audioPath]);
}
