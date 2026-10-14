import 'dart:math' as math;
import 'dart:typed_data';

import '../audio/pcm.dart';

/// The studio's project, the same shape as the web studio's (lib/studio/model.ts),
/// so a project saved by either opens in the other: tracks holding clips, each
/// clip a window onto an immutable audio buffer.

final _random = math.Random.secure();

/// A random version 4 UUID, the ids the web studio uses.
String uid() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

const trackColors = ['#a28d19', '#1b6eb7', '#9564ba', '#3e8d79', '#b37043', '#b4536b', '#498d9b', '#73844e'];

double _num(Object? v, double fallback) => v is num && v.isFinite ? v.toDouble() : fallback;
List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];

class TakeSource {
  const TakeSource({required this.tracks, required this.start, required this.end});
  final List<String> tracks;
  final double start, end;
  factory TakeSource.fromJson(Map<String, dynamic> j) =>
      TakeSource(tracks: _strings(j['tracks']), start: _num(j['start'], 0), end: _num(j['end'], 0));
  Map<String, dynamic> toJson() => {'tracks': tracks, 'start': start, 'end': end};
}

/// An AI result standing in for a stretch of other tracks. Using it mutes that
/// stretch of the source (remembering which clips in [hidden]); setting it
/// aside restores them, so trying takes never destroys the original.
class Take {
  const Take({
    required this.id,
    required this.label,
    required this.selected,
    required this.source,
    this.hidden = const [],
    this.warnings = const [],
  });
  final String id, label;
  final bool selected;
  final TakeSource source;
  final List<String> hidden, warnings;

  Take copyWith({bool? selected, List<String>? hidden}) => Take(
    id: id,
    label: label,
    selected: selected ?? this.selected,
    source: source,
    hidden: hidden ?? this.hidden,
    warnings: warnings,
  );
  factory Take.fromJson(Map<String, dynamic> j) => Take(
    id: j['id'] as String? ?? uid(),
    label: j['label'] as String? ?? 'Take',
    selected: j['selected'] == true,
    source: TakeSource.fromJson((j['source'] as Map?)?.cast<String, dynamic>() ?? const {}),
    hidden: _strings(j['hidden']),
    warnings: _strings(j['warnings']),
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'selected': selected,
    'source': source.toJson(),
    'hidden': hidden,
    'warnings': warnings,
  };
}

class Track {
  const Track({
    required this.id,
    required this.name,
    required this.color,
    this.volume = 1,
    this.pan = 0,
    this.mute = false,
    this.solo = false,
    this.take,
  });
  final String id, name, color;
  final double volume, pan;
  final bool mute, solo;
  final Take? take;

  Track copyWith({String? name, double? volume, double? pan, bool? mute, bool? solo, Take? take}) => Track(
    id: id,
    name: name ?? this.name,
    color: color,
    volume: volume ?? this.volume,
    pan: pan ?? this.pan,
    mute: mute ?? this.mute,
    solo: solo ?? this.solo,
    take: take ?? this.take,
  );
  factory Track.fromJson(Map<String, dynamic> j) => Track(
    id: j['id'] as String? ?? uid(),
    name: j['name'] as String? ?? 'Track',
    color: j['color'] as String? ?? trackColors.first,
    volume: _num(j['volume'], 1).clamp(0, 2).toDouble(),
    pan: _num(j['pan'], 0).clamp(-1, 1).toDouble(),
    mute: j['mute'] == true,
    solo: j['solo'] == true,
    take: j['take'] is Map ? Take.fromJson((j['take'] as Map).cast<String, dynamic>()) : null,
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'color': color,
    'volume': volume,
    'pan': pan,
    'mute': mute,
    'solo': solo,
    if (take != null) 'take': take!.toJson(),
  };
}

class Clip {
  const Clip({
    required this.id,
    required this.trackId,
    required this.buffer,
    required this.start,
    required this.offset,
    required this.duration,
    required this.name,
    this.muted = false,
    this.score,
    this.generation,
  });
  final String id, trackId, buffer, name;

  /// Where the clip sits on the timeline, how far into its buffer it begins, and how much plays, in seconds.
  final double start, offset, duration;
  final bool muted;

  /// Passed through untouched so projects keep what the web studio stores.
  final Map<String, dynamic>? score, generation;

  double get end => start + duration;

  Clip copyWith({String? id, double? start, double? offset, double? duration, bool? muted, String? trackId}) => Clip(
    id: id ?? this.id,
    trackId: trackId ?? this.trackId,
    buffer: buffer,
    start: start ?? this.start,
    offset: offset ?? this.offset,
    duration: duration ?? this.duration,
    name: name,
    muted: muted ?? this.muted,
    score: score,
    generation: generation,
  );
  factory Clip.fromJson(Map<String, dynamic> j) => Clip(
    id: j['id'] as String? ?? uid(),
    trackId: j['trackId'] as String? ?? '',
    buffer: j['buffer'] as String? ?? '',
    start: math.max(0.0, _num(j['start'], 0)),
    offset: math.max(0.0, _num(j['offset'], 0)),
    duration: math.max(0.0, _num(j['duration'], 0)),
    name: j['name'] as String? ?? 'Clip',
    muted: j['muted'] == true,
    score: (j['score'] as Map?)?.cast<String, dynamic>(),
    generation: (j['generation'] as Map?)?.cast<String, dynamic>(),
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'trackId': trackId,
    'buffer': buffer,
    'start': start,
    'offset': offset,
    'duration': duration,
    'name': name,
    if (muted) 'muted': true,
    if (score != null) 'score': score,
    if (generation != null) 'generation': generation,
  };
}

class Chord {
  const Chord(this.time, this.name);
  final double time;
  final String name;
  Map<String, dynamic> toJson() => {'time': time, 'name': name};
}

class Project {
  const Project({this.tracks = const [], this.clips = const [], this.bpm = 120, this.key = '', this.chords = const []});
  final List<Track> tracks;
  final List<Clip> clips;
  final double bpm;
  final String key;
  final List<Chord> chords;

  static const empty = Project();

  double get end => clips.fold(0.0, (e, c) => math.max(e, c.end));

  Project copyWith({List<Track>? tracks, List<Clip>? clips, double? bpm, String? key, List<Chord>? chords}) => Project(
    tracks: tracks ?? this.tracks,
    clips: clips ?? this.clips,
    bpm: bpm ?? this.bpm,
    key: key ?? this.key,
    chords: chords ?? this.chords,
  );

  Track? track(String id) {
    for (final t in tracks) {
      if (t.id == id) return t;
    }
    return null;
  }

  factory Project.fromJson(Map<String, dynamic> j) => Project(
    tracks: (j['tracks'] as List? ?? const []).whereType<Map>().map((t) => Track.fromJson(t.cast<String, dynamic>())).toList(),
    clips: (j['clips'] as List? ?? const []).whereType<Map>().map((c) => Clip.fromJson(c.cast<String, dynamic>())).toList(),
    bpm: _num(j['bpm'], 120).clamp(20, 300).toDouble(),
    key: j['key'] as String? ?? '',
    chords: (j['chords'] as List? ?? const [])
        .whereType<Map>()
        .map((c) => Chord(_num(c['time'], 0), c['name'] as String? ?? ''))
        .toList(),
  );
  Map<String, dynamic> toJson() => {
    'tracks': tracks.map((t) => t.toJson()).toList(),
    'clips': clips.map((c) => c.toJson()).toList(),
    'bpm': bpm,
    'key': key,
    'chords': chords.map((c) => c.toJson()).toList(),
  };
}

/// A stretch of time across one or more tracks.
class Range {
  const Range(this.start, this.end, this.tracks);
  final double start, end;
  final List<String> tracks;
}

class Selection {
  const Selection({this.clips = const [], this.range});
  final List<String> clips;
  final Range? range;
  static const none = Selection();
  bool get isEmpty => clips.isEmpty && range == null;
}

/// Add a track, after [after] when given, in the next unused colour.
(Project, Track) addTrack(Project project, String name, {String? after}) {
  final used = project.tracks.map((t) => t.color).toSet();
  final color = trackColors.firstWhere((c) => !used.contains(c),
      orElse: () => trackColors[project.tracks.length % trackColors.length]);
  final track = Track(id: uid(), name: name, color: color);
  final tracks = [...project.tracks];
  final index = after == null ? -1 : tracks.indexWhere((t) => t.id == after);
  tracks.insert(index < 0 ? tracks.length : index + 1, track);
  return (project.copyWith(tracks: tracks), track);
}

/// Whether a track is heard, given every track's mute and solo.
bool audible(Project project, Track track) =>
    project.tracks.any((t) => t.solo) ? track.solo : !track.mute;

const minClip = 0.05;

/// Cut a clip in two at a timeline position.
Project splitClip(Project project, String id, double at) {
  final index = project.clips.indexWhere((c) => c.id == id);
  if (index < 0) return project;
  final clip = project.clips[index];
  if (at <= clip.start + minClip || at >= clip.end - minClip) return project;
  final cut = at - clip.start;
  final left = clip.copyWith(duration: cut);
  final right = clip.copyWith(id: uid(), start: at, offset: clip.offset + cut, duration: clip.duration - cut);
  return project.copyWith(clips: [...project.clips.take(index), left, right, ...project.clips.skip(index + 1)]);
}

/// Clips on the given tracks that overlap a stretch of time.
List<Clip> clipsIn(Project project, Range range) => project.clips
    .where((c) => range.tracks.contains(c.trackId) && c.start < range.end && c.end > range.start)
    .toList();

/// The single clip a range lies inside, if there is one.
Clip? soleClip(Project project, Range range) {
  final inside = clipsIn(project, range);
  if (inside.length != 1 || range.tracks.length != 1) return null;
  final clip = inside.first;
  return clip.start <= range.start + 1e-6 && clip.end >= range.end - 1e-6 ? clip : null;
}

/// Where new takes of these tracks go: after them and after takes already made of them.
String? takeAnchor(Project project, List<String> tracks) {
  String? anchor;
  for (final t in project.tracks) {
    if (tracks.contains(t.id) || (t.take?.source.tracks.any(tracks.contains) ?? false)) anchor = t.id;
  }
  return anchor;
}

bool _overlaps(TakeSource a, TakeSource b) =>
    a.start < b.end && b.start < a.end && a.tracks.any(b.tracks.contains);

/// Use a take in place of its source, or set it aside. Only one take of a
/// stretch plays at once, so using one sets aside any other covering it.
Take? _takeById(Project project, String id) {
  for (final t in project.tracks) {
    if (t.take?.id == id) return t.take;
  }
  return null;
}

Project selectTake(Project project, String id, bool on) {
  final take = _takeById(project, id);
  if (take == null || take.selected == on) return project;
  var next = project;
  var hidden = <String>[];
  if (on) {
    final rivals = project.tracks
        .where((t) => t.take != null && t.take!.id != id && t.take!.selected && _overlaps(t.take!.source, take.source))
        .map((t) => t.take!.id)
        .toSet();
    for (final rival in rivals) {
      next = selectTake(next, rival, false);
    }
    final source = take.source;
    for (final c in next.clips.where((c) => source.tracks.contains(c.trackId)).toList()) {
      next = splitClip(next, c.id, source.start);
    }
    for (final c in next.clips.where((c) => source.tracks.contains(c.trackId)).toList()) {
      next = splitClip(next, c.id, source.end);
    }
    hidden = next.clips
        .where((c) =>
            source.tracks.contains(c.trackId) && !c.muted && c.start >= source.start - 1e-6 && c.end <= source.end + 1e-6)
        .map((c) => c.id)
        .toList();
    next = next.copyWith(clips: next.clips.map((c) => hidden.contains(c.id) ? c.copyWith(muted: true) : c).toList());
  } else {
    next = next.copyWith(clips: next.clips.map((c) => take.hidden.contains(c.id) ? c.copyWith(muted: false) : c).toList());
  }
  return next.copyWith(
    tracks: next.tracks
        .map((t) => t.take?.id == id ? t.copyWith(mute: !on, take: t.take!.copyWith(selected: on, hidden: hidden)) : t)
        .toList(),
  );
}

/// What an AI action works on: a stretch of time and the clips in it.
class Target {
  const Target({required this.start, required this.end, required this.clips, required this.tracks, this.range, this.sole});
  final double start, end;
  final List<Clip> clips;
  final List<String> tracks;
  final Range? range;
  final Clip? sole;
  double get length => end - start;
}

Target? targetOf(Project project, Selection selection) {
  final range = selection.range;
  if (range != null && range.end - range.start > 0.05) {
    final clips = clipsIn(project, range).where((c) => !c.muted).toList();
    if (clips.isEmpty) return null;
    final start = math.max(range.start, clips.map((c) => c.start).reduce(math.min));
    final end = math.min(range.end, clips.map((c) => c.end).reduce(math.max));
    final clamped = Range(start, end, range.tracks);
    return Target(start: start, end: end, clips: clips, tracks: range.tracks, range: clamped, sole: soleClip(project, clamped));
  }
  final clips = project.clips.where((c) => selection.clips.contains(c.id)).toList();
  if (clips.isEmpty) return null;
  return Target(
    start: clips.map((c) => c.start).reduce(math.min),
    end: clips.map((c) => c.end).reduce(math.max),
    clips: clips,
    tracks: clips.map((c) => c.trackId).toSet().toList(),
    sole: clips.length == 1 ? clips.first : null,
  );
}

/// Mix part of a project to stereo at the project rate.
///
/// With [only], just those clips play, raw (no track volume or pan) when
/// [mixer] is false; otherwise every unmuted clip on an audible track, through
/// its track's volume and pan.
Pcm renderMix(
  Project project,
  Map<String, Pcm> buffers, {
  required double start,
  required double end,
  Set<String>? only,
  bool mixer = true,
}) {
  const rate = projectRate;
  final frames = math.max(1, ((end - start) * rate).ceil());
  final left = Float32List(frames), right = Float32List(frames);
  final tracks = {for (final t in project.tracks) t.id: t};
  for (final clip in project.clips) {
    if (only != null ? !only.contains(clip.id) : clip.muted) continue;
    final track = tracks[clip.trackId], pcm = buffers[clip.buffer];
    if (track == null || pcm == null) continue;
    final gain = !mixer ? 1.0 : track.volume * (only != null || audible(project, track) ? 1 : 0);
    if (gain == 0) continue;
    final pan = mixer ? track.pan : 0.0;
    final gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    final from = math.max(start, clip.start), to = math.min(end, clip.end);
    if (to <= from) continue;
    final outStart = ((from - start) * rate).round();
    final srcStart = ((clip.offset + from - clip.start) * rate).round();
    final count = math.min(((to - from) * rate).round(), math.min(frames - outStart, pcm.frames - srcStart));
    final ch = pcm.channels, s = pcm.samples;
    for (int i = 0; i < count; i++) {
      final f = (srcStart + i) * ch;
      left[outStart + i] += s[f] / 32768 * gl;
      right[outStart + i] += s[f + ch - 1] / 32768 * gr;
    }
  }
  final out = Int16List(frames * 2);
  for (int i = 0; i < frames; i++) {
    out[i * 2] = toSample(left[i]);
    out[i * 2 + 1] = toSample(right[i]);
  }
  return Pcm(out, 2, rate);
}

String formatTime(double seconds) {
  final s = seconds.abs(), m = s ~/ 60, sec = (s % 60).floor(), tenths = ((s % 1) * 10).floor();
  return '${seconds < 0 ? '-' : ''}$m:${sec.toString().padLeft(2, '0')}.$tenths';
}

String formatClock(double seconds) {
  if (!seconds.isFinite || seconds < 0) return '0:00';
  return '${seconds ~/ 60}:${(seconds % 60).floor().toString().padLeft(2, '0')}';
}
