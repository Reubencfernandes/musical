import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

import '../api/errors.dart';
import '../studio/project.dart' show formatClock;
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Something the bottom player can play. [load] fetches the audio file only when it is first played.
class Playable {
  const Playable({required this.id, required this.title, this.subtitle = '', this.cover, required this.load});
  final String id, title, subtitle;
  final Uint8List? cover;
  final Future<String> Function() load;
}

/// One player for the whole app, so starting a song stops the last one.
class PlayerController extends ChangeNotifier {
  PlayerController() {
    _subscriptions.add(_player.playerStateStream.listen((_) => notifyListeners()));
    _subscriptions.add(_player.durationStream.listen((_) => notifyListeners()));
  }

  final _player = AudioPlayer();
  final _subscriptions = <StreamSubscription<Object?>>[];
  Playable? _current;
  bool _loading = false;
  String _error = '';
  int _request = 0;

  Playable? get current => _current;
  bool get playing => _player.playing && _player.processingState != ProcessingState.completed;
  bool get loading => _loading;
  String get error => _error;
  Duration get duration => _player.duration ?? Duration.zero;
  Stream<Duration> get position => _player.positionStream;

  Future<void> play(Playable item) async {
    if (_current?.id == item.id && _player.audioSource != null) {
      if (_player.processingState == ProcessingState.completed) {
        await _player.seek(Duration.zero);
        unawaited(_player.play());
      } else if (_player.playing) {
        await _player.pause();
      } else {
        unawaited(_player.play());
      }
      return;
    }
    final request = ++_request;
    _current = item;
    _loading = true;
    _error = '';
    notifyListeners();
    try {
      await _player.stop();
      final path = await item.load();
      if (request != _request) return;
      await _player.setFilePath(path);
      if (request != _request) return;
      unawaited(_player.play());
    } catch (e) {
      if (request == _request) _error = e is KikuException ? e.message : 'This song could not be played.';
    } finally {
      if (request == _request) {
        _loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> seek(Duration to) => _player.seek(to);
  Future<void> pause() => _player.pause();

  /// Stops and forgets [id] if it is playing, after it is deleted.
  Future<void> forget(String id) async {
    if (_current?.id != id) return;
    _request++;
    _current = null;
    await _player.stop();
    notifyListeners();
  }

  @override
  void dispose() {
    for (final s in _subscriptions) {
      s.cancel();
    }
    _player.dispose();
    super.dispose();
  }
}

/// The player along the bottom of Home, Generate and Library.
class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key, required this.player});
  final PlayerController player;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: player,
    builder: (context, _) {
      final item = player.current;
      if (item == null) return const SizedBox.shrink();
      final colors = KikuColors.of(context);
      return Material(
        color: colors.panel,
        child: Container(
          decoration: BoxDecoration(border: Border(top: BorderSide(color: colors.line))),
          padding: const EdgeInsets.fromLTRB(12, 8, 8, 6),
          child: SafeArea(
            top: false,
            bottom: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    SongArt(id: item.id, size: 40, cover: item.cover),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                          Text(
                            player.error.isNotEmpty ? player.error : item.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, color: player.error.isNotEmpty ? Theme.of(context).colorScheme.error : colors.muted),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: player.playing ? 'Pause' : 'Play',
                      onPressed: () => player.play(item),
                      icon: player.loading
                          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Icon(player.playing ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 30),
                    ),
                  ],
                ),
                StreamBuilder<Duration>(
                  stream: player.position,
                  builder: (context, snap) {
                    final total = player.duration.inMilliseconds / 1000;
                    final now = ((snap.data?.inMilliseconds ?? 0) / 1000).clamp(0.0, total <= 0 ? 0.0 : total);
                    return Row(
                      children: [
                        Text(formatClock(now), style: TextStyle(fontSize: 11, color: colors.muted, fontFeatures: const [FontFeature.tabularFigures()])),
                        Expanded(
                          child: SliderTheme(
                            data: SliderTheme.of(context).copyWith(
                              trackHeight: 2.5,
                              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5),
                              overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                            ),
                            child: Slider(
                              value: now,
                              max: total <= 0 ? 1 : total,
                              onChanged: total <= 0 ? null : (v) => player.seek(Duration(milliseconds: (v * 1000).round())),
                            ),
                          ),
                        ),
                        Text(formatClock(total), style: TextStyle(fontSize: 11, color: colors.muted, fontFeatures: const [FontFeature.tabularFigures()])),
                      ],
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
