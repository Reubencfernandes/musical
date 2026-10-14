import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../api/engine.dart';
import '../services.dart';
import '../shell/player.dart';
import '../shell/shell.dart';
import '../studio/project.dart' show formatClock;
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'songs_controller.dart';

String modelName(String id) => Model.values.where((m) => m.name == id).map((m) => m.label).firstOrNull ?? id;

/// Shares a file through the system sheet; on iPads the sheet points at [context]'s widget.
Future<void> shareFile(BuildContext context, String path, {String? text}) async {
  final box = context.findRenderObject() as RenderBox?;
  await SharePlus.instance.share(ShareParams(
    files: [XFile(path)],
    text: text,
    sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size,
  ));
}

class SongTile extends StatelessWidget {
  const SongTile({super.key, required this.item});
  final SongItem item;

  Future<void> _rename(BuildContext context) async {
    final songs = Kiku.of(context).songs;
    final controller = TextEditingController(text: item.song.title);
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename song'),
        content: TextField(controller: controller, autofocus: true, maxLength: 80, onSubmitted: (v) => Navigator.pop(context, v)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Rename')),
        ],
      ),
    );
    controller.dispose();
    if (title == null || !context.mounted) return;
    try {
      await songs.rename(item, title);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final colors = KikuColors.of(context);
    final song = item.song;
    final bpm = song.meta?['bpm'], key = song.meta?['keyscale'];
    final tags = [
      modelName(song.model),
      if (song.instrumental) 'Instrumental',
      if (bpm is num && bpm > 0) '${bpm.round()} BPM',
      if (key is String && key.isNotEmpty) key,
      if (!item.saved) 'Not saved',
    ];
    final playable = Playable(
      id: song.id,
      title: song.title,
      subtitle: song.caption,
      cover: item.cover,
      load: () => services.songs.audioPath(item),
    );
    return ListenableBuilder(
      listenable: services.player,
      builder: (context, _) {
        final active = services.player.current?.id == song.id, playing = active && services.player.playing;
        return InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => services.player.play(playable),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
            child: Row(
              children: [
                SongArt(
                  id: song.id,
                  size: 56,
                  cover: item.cover,
                  child: Center(
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: Colors.black.withValues(alpha: active ? .45 : .25), shape: BoxShape.circle),
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: Colors.white, size: 22),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(song.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontWeight: FontWeight.w600, color: active ? accent : null)),
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          for (final tag in tags)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(color: colors.raise, borderRadius: BorderRadius.circular(6)),
                              child: Text(tag, style: TextStyle(fontSize: 11, color: tag == 'Not saved' ? accent : colors.muted)),
                            ),
                        ],
                      ),
                      if (song.caption.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(song.caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: colors.muted)),
                        ),
                    ],
                  ),
                ),
                Text(formatClock(song.duration), style: TextStyle(fontSize: 12, color: colors.muted)),
                PopupMenuButton<String>(
                  tooltip: 'More',
                  icon: services.songs.painting.contains(song.id)
                      ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.more_vert_rounded),
                  onSelected: (choice) async {
                    try {
                      switch (choice) {
                        case 'rename':
                          await _rename(context);
                        case 'cover':
                          await services.songs.paint(item);
                        case 'share':
                          final path = await services.songs.audioPath(item);
                          if (context.mounted) await shareFile(context, path, text: song.title);
                        case 'studio':
                          final path = await services.songs.audioPath(item);
                          await services.studio.openFile(path, name: song.title);
                          if (context.mounted) ShellScope.of(context)(Place.studio);
                        case 'delete':
                          if (await confirmDelete(context, '“${song.title}”')) {
                            await services.player.forget(song.id);
                            await services.songs.remove(item);
                          }
                      }
                    } catch (e) {
                      if (context.mounted) showError(context, e);
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(value: 'rename', child: Text('Rename')),
                    PopupMenuItem(value: 'cover', child: Text(item.cover != null ? 'New cover art' : 'Make cover art')),
                    const PopupMenuItem(value: 'share', child: Text('Share or save audio')),
                    const PopupMenuItem(value: 'studio', child: Text('Open in the studio')),
                    const PopupMenuItem(value: 'delete', child: Text('Delete')),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class MakingTile extends StatelessWidget {
  const MakingTile({super.key, required this.making});
  final Making making;

  @override
  Widget build(BuildContext context) {
    final songs = Kiku.of(context).songs;
    final colors = KikuColors.of(context);
    final failed = making.error != null;
    final done = making.shown;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Row(
        children: [
          SongArt(
            id: making.id,
            size: 56,
            child: failed ? const Icon(Icons.error_outline_rounded, color: Colors.white) : const Center(child: SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(making.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(
                  making.error ?? (making.queue != null && making.queue! > 0 ? 'In queue · ${making.queue} ahead' : making.status),
                  maxLines: failed ? 4 : 2,
                  style: TextStyle(fontSize: 12, color: failed ? Theme.of(context).colorScheme.error : colors.muted),
                ),
                if (!failed) ...[const SizedBox(height: 6), Meter(value: done)],
              ],
            ),
          ),
          if (!failed) Padding(padding: const EdgeInsets.only(left: 8), child: Text('${(done * 100).round()}%', style: TextStyle(fontSize: 12, color: colors.muted))),
          IconButton(
            tooltip: failed ? 'Dismiss' : 'Cancel',
            onPressed: () => failed ? songs.dismiss(making.id) : songs.cancel(making.id),
            icon: const Icon(Icons.close_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}
