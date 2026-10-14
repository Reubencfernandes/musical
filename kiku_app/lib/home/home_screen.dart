import 'package:flutter/material.dart';

import '../services.dart';
import '../shell/shell.dart';
import '../songs/song_tile.dart';
import '../songs/songs_controller.dart';
import '../ui/logo.dart';
import '../ui/theme.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _idea = TextEditingController();
  bool _instrumental = false;

  @override
  void dispose() {
    _idea.dispose();
    super.dispose();
  }

  void _start() {
    final idea = _idea.text.trim();
    if (idea.isEmpty) return;
    Kiku.of(context).songs.create(SongRequest.simple(idea: idea, instrumental: _instrumental));
    _idea.clear();
    FocusScope.of(context).unfocus();
    ShellScope.of(context)(Place.generate);
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final colors = KikuColors.of(context);
    final go = ShellScope.of(context);
    final places = [
      (Place.generate, Icons.graphic_eq_rounded, 'Describe a song in a sentence, or write the style and lyrics yourself.'),
      (Place.studio, Icons.tune_rounded, 'Record or import audio, then restyle, rewrite, cover or split any part of it.'),
      (Place.score, Icons.library_music_rounded, 'Turn a recording into sheet music you can play along with.'),
    ];
    return Scaffold(
      appBar: const PlaceBar(title: KikuWordmark(size: 28)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text('What should we make, ${services.auth.user?.handle ?? 'friend'}?', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 18),
          Container(
            decoration: BoxDecoration(color: colors.raise, borderRadius: BorderRadius.circular(20), border: Border.all(color: colors.line)),
            padding: const EdgeInsets.fromLTRB(16, 6, 10, 10),
            child: Column(
              children: [
                TextField(
                  controller: _idea,
                  minLines: 2,
                  maxLines: 5,
                  maxLength: 500,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _start(),
                  decoration: const InputDecoration(
                    hintText: 'Describe the song you want to make…',
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    counterText: '',
                    contentPadding: EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
                Row(
                  children: [
                    Switch(value: _instrumental, onChanged: (v) => setState(() => _instrumental = v)),
                    const SizedBox(width: 6),
                    Text('Instrumental', style: TextStyle(color: colors.muted)),
                    const Spacer(),
                    ListenableBuilder(
                      listenable: _idea,
                      builder: (context, _) => FilledButton.icon(
                        onPressed: _idea.text.trim().isEmpty ? null : _start,
                        icon: const Icon(Icons.graphic_eq_rounded, size: 18),
                        label: const Text('Create'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          for (final (place, icon, text) in places)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => go(place),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(color: colors.accentSoft, borderRadius: BorderRadius.circular(12)),
                          child: Icon(icon, color: const Color(0xFFFF9565), size: 21),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(place.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                              const SizedBox(height: 3),
                              Text(text, style: TextStyle(color: colors.muted, fontSize: 13, height: 1.45)),
                            ],
                          ),
                        ),
                        Icon(Icons.arrow_forward_rounded, size: 18, color: colors.muted),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ListenableBuilder(
            listenable: services.songs,
            builder: (context, _) {
              final recent = services.songs.songs.take(4).toList();
              if (recent.isEmpty) return const SizedBox.shrink();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Text('Recent songs', style: Theme.of(context).textTheme.titleLarge),
                      const Spacer(),
                      TextButton(onPressed: () => go(Place.library), child: const Text('See all')),
                    ],
                  ),
                  for (final item in recent) SongTile(item: item),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
