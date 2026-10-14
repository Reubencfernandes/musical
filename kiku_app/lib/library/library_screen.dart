import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/errors.dart';
import '../api/library.dart';
import '../services.dart';
import '../shell/shell.dart';
import '../songs/song_tile.dart';
import '../studio/project.dart' show formatClock;
import '../ui/theme.dart';
import '../ui/widgets.dart';

String _when(String iso) {
  final date = DateTime.tryParse(iso)?.toLocal();
  if (date == null) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${date.day} ${months[date.month - 1]} ${date.year}, ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});
  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  List<SavedProject>? _projects;
  List<SavedScore>? _scores;
  String _error = '';
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  Future<void> _load() async {
    final library = Kiku.of(context).library;
    setState(() {
      _error = '';
      _projects = null;
      _scores = null;
    });
    await Future.wait([
      library.listProjects().then((v) => _projects = v).catchError((Object e) {
        _projects = const [];
        _error = describe(e);
        return const <SavedProject>[];
      }),
      library.listScores().then((v) => _scores = v).catchError((Object e) {
        _scores = const [];
        _error = describe(e);
        return const <SavedScore>[];
      }),
    ]);
    if (mounted) setState(() {});
  }

  Future<void> _refresh() async {
    final songs = Kiku.of(context).songs;
    await Future.wait([songs.reload(force: true), _load()]);
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final colors = KikuColors.of(context);
    final user = services.auth.user;
    final go = ShellScope.of(context);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: PlaceBar(
          title: const Text('Library'),
          actions: [IconButton(tooltip: 'Refresh', onPressed: _refresh, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: InkWell(
                onTap: user == null ? null : () => launchUrl(services.library.page, mode: LaunchMode.externalApplication),
                child: Text(
                  user?.storage ?? false
                      ? 'Saved privately to ${services.library.repo} on Hugging Face.'
                      : 'Your songs, studio projects and scores, saved to your own Hugging Face account once you allow saving.',
                  style: TextStyle(color: colors.muted, fontSize: 13, height: 1.5),
                ),
              ),
            ),
            ListenableBuilder(
              listenable: services.songs,
              builder: (context, _) => TabBar(
                indicatorColor: accent,
                labelColor: Theme.of(context).colorScheme.onSurface,
                unselectedLabelColor: colors.muted,
                tabs: [
                  Tab(text: 'Songs · ${services.songs.songs.length}'),
                  Tab(text: 'Projects · ${_projects?.length ?? 0}'),
                  Tab(text: 'Scores · ${_scores?.length ?? 0}'),
                ],
              ),
            ),
            if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: ErrorBanner(message: _error)),
            Expanded(
              child: TabBarView(
                children: [
                  ListenableBuilder(
                    listenable: services.songs,
                    builder: (context, _) {
                      final songs = services.songs;
                      return RefreshIndicator(
                        onRefresh: () => songs.reload(force: true),
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                          children: [
                            for (final s in songs.songs) SongTile(item: s),
                            if (songs.loading && songs.songs.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
                            if (!songs.loading && songs.songs.isEmpty)
                              const EmptyNote(icon: Icons.graphic_eq_rounded, text: 'No songs yet. Make one in Generate.'),
                          ],
                        ),
                      );
                    },
                  ),
                  _list(
                    items: _projects,
                    empty: 'Projects you save in the studio appear here.',
                    icon: Icons.tune_rounded,
                    build: (entry) => _Row(
                      icon: Icons.tune_rounded,
                      title: entry.name,
                      detail: '${entry.tracks} track${entry.tracks == 1 ? '' : 's'} · ${formatClock(entry.duration)} · saved ${_when(entry.updatedAt)}',
                      onOpen: () {
                        services.studio.openSaved(entry);
                        go(Place.studio);
                      },
                      onDelete: () async {
                        if (!await confirmDelete(context, '“${entry.name}”')) return;
                        try {
                          await services.library.deleteProject(entry);
                          setState(() => _projects = _projects?.where((p) => p.id != entry.id).toList());
                        } catch (e) {
                          if (context.mounted) showError(context, e);
                        }
                      },
                    ),
                  ),
                  _list(
                    items: _scores,
                    empty: 'Sheet music you make on the Score page appears here.',
                    icon: Icons.library_music_rounded,
                    build: (entry) => _Row(
                      icon: Icons.library_music_rounded,
                      title: entry.title,
                      detail: '${formatClock(entry.duration)} · ${_when(entry.createdAt)}',
                      onOpen: () {
                        services.score.openSaved(entry);
                        go(Place.score);
                      },
                      onDelete: () async {
                        if (!await confirmDelete(context, '“${entry.title}”')) return;
                        try {
                          await services.library.deleteScore(entry);
                          setState(() => _scores = _scores?.where((s) => s.id != entry.id).toList());
                        } catch (e) {
                          if (context.mounted) showError(context, e);
                        }
                      },
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list<T>({required List<T>? items, required String empty, required IconData icon, required Widget Function(T item) build}) =>
      RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            if (items == null) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
            if (items != null && items.isEmpty) EmptyNote(icon: icon, text: empty),
            if (items != null) for (final item in items) build(item),
          ],
        ),
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.title, required this.detail, required this.onOpen, required this.onDelete});
  final IconData icon;
  final String title, detail;
  final VoidCallback onOpen, onDelete;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      onTap: onOpen,
      leading: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(color: colors.accentSoft, borderRadius: BorderRadius.circular(11)),
        child: Icon(icon, color: const Color(0xFFFF9565), size: 20),
      ),
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(detail, style: TextStyle(fontSize: 12, color: colors.muted)),
      trailing: IconButton(tooltip: 'Delete', onPressed: onDelete, icon: const Icon(Icons.delete_outline_rounded)),
    );
  }
}
