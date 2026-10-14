import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiku_ai/audio/pcm.dart';
import 'package:kiku_ai/studio/project.dart';

void main() {
  // A project as the web studio saves it.
  final saved = {
    'tracks': [
      {'id': 't1', 'name': 'Vocal', 'color': '#a28d19', 'volume': 1, 'pan': 0, 'mute': false, 'solo': false},
      {
        'id': 't2',
        'name': 'Restyled',
        'color': '#1b6eb7',
        'volume': .8,
        'pan': -.5,
        'mute': true,
        'solo': false,
        'take': {
          'id': 'k1',
          'label': 'Restyle',
          'selected': false,
          'source': {'tracks': ['t1'], 'start': 1, 'end': 3},
          'hidden': [],
          'warnings': [],
        },
      },
    ],
    'clips': [
      {'id': 'c1', 'trackId': 't1', 'buffer': 'b1', 'start': 0, 'offset': 0, 'duration': 4, 'name': 'Vocal'},
      {
        'id': 'c2',
        'trackId': 't2',
        'buffer': 'b2',
        'start': 1,
        'offset': 0,
        'duration': 2,
        'name': 'Restyled',
        'generation': {'model': 'ACE-Step 1.5', 'style': 'jazz', 'createdAt': '2026-01-01T00:00:00Z', 'sourceClips': ['c1']},
      },
    ],
    'bpm': 96,
    'key': 'A minor',
    'chords': [
      {'time': 0, 'name': 'Am'},
    ],
  };

  test('reads and writes the web studio’s project format', () {
    final project = Project.fromJson(saved);
    expect(project.tracks.length, 2);
    expect(project.tracks[1].take?.source.tracks, ['t1']);
    expect(project.clips[1].generation?['style'], 'jazz');
    expect(project.end, 4);
    final again = Project.fromJson(project.toJson());
    expect(again.toJson(), project.toJson());
  });

  test('using a take mutes the stretch of its source and setting it aside restores it', () {
    var project = Project.fromJson(saved);
    project = selectTake(project, 'k1', true);
    expect(project.track('t2')!.mute, isFalse);
    final muted = project.clips.where((c) => c.trackId == 't1' && c.muted).toList();
    expect(muted.length, 1);
    expect(muted.single.start, 1);
    expect(muted.single.end, 3);
    expect(project.clips.where((c) => c.trackId == 't1').length, 3);
    project = selectTake(project, 'k1', false);
    expect(project.clips.where((c) => c.muted), isEmpty);
    expect(project.track('t2')!.mute, isTrue);
  });

  test('selection targets clips and ranges', () {
    final project = Project.fromJson(saved);
    final clip = targetOf(project, const Selection(clips: ['c1']))!;
    expect(clip.start, 0);
    expect(clip.end, 4);
    expect(clip.sole?.id, 'c1');
    final range = targetOf(project, const Selection(range: Range(0.5, 2.5, ['t1'])))!;
    expect(range.length, closeTo(2, 1e-9));
    expect(range.sole?.id, 'c1');
    expect(targetOf(project, Selection.none), isNull);
  });

  test('adds tracks in unused colours', () {
    final (next, track) = addTrack(Project.fromJson(saved), 'Drums', after: 't1');
    expect(next.tracks[1].id, track.id);
    expect(track.color, isNot(anyOf('#a28d19', '#1b6eb7')));
  });

  test('mixes clips with volume, pan, mute and solo', () {
    final one = Pcm(Int16List.fromList(List.filled(projectRate, 16384)), 1, projectRate);
    final project = Project(
      tracks: const [
        Track(id: 'a', name: 'A', color: '#a28d19', pan: -1),
        Track(id: 'b', name: 'B', color: '#1b6eb7', volume: .5),
      ],
      clips: const [
        Clip(id: 'x', trackId: 'a', buffer: 'one', start: 0, offset: 0, duration: 1, name: 'A'),
        Clip(id: 'y', trackId: 'b', buffer: 'one', start: .5, offset: 0, duration: .5, name: 'B'),
      ],
    );
    final mix = renderMix(project, {'one': one}, start: 0, end: 1);
    expect(mix.channels, 2);
    expect(mix.frames, projectRate);
    // Early on only A plays, panned hard left.
    expect(mix.samples[100 * 2], closeTo(16384, 2));
    expect(mix.samples[100 * 2 + 1], 0);
    // Later B joins at half volume in the centre.
    final late = (projectRate * .75).round();
    expect(mix.samples[late * 2], closeTo(16384 + 8192, 3));
    expect(mix.samples[late * 2 + 1], closeTo(8192, 2));
    final soloed = project.copyWith(tracks: [project.tracks[0], project.tracks[1].copyWith(solo: true)]);
    final solo = renderMix(soloed, {'one': one}, start: 0, end: 1);
    expect(solo.samples[100 * 2], 0);
  });

  test('formats times', () {
    expect(formatClock(75.4), '1:15');
    expect(formatTime(5.25), '0:05.2');
    expect(uid(), matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
  });
}
