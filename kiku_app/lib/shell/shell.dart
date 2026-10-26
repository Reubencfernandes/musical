import 'package:flutter/material.dart';

import '../home/home_screen.dart';
import '../library/library_screen.dart';
import '../score/score_screen.dart';
import '../services.dart';
import '../songs/generate_screen.dart';
import '../studio/studio_screen.dart';
import '../ui/logo.dart';
import '../ui/theme.dart';
import 'player.dart';
import 'settings_sheet.dart';

/// The app's five places, as in the web app's navigation.
enum Place {
  home('Home', Icons.home_outlined, Icons.home_rounded),
  generate('Generate', Icons.graphic_eq_outlined, Icons.graphic_eq_rounded),
  studio('Studio', Icons.tune_outlined, Icons.tune_rounded),
  score('Score', Icons.library_music_outlined, Icons.library_music_rounded),
  library('Library', Icons.collections_bookmark_outlined, Icons.collections_bookmark_rounded);

  const Place(this.label, this.icon, this.selected);
  final String label;
  final IconData icon, selected;
}

/// Lets any screen move to another place.
class ShellScope extends InheritedWidget {
  const ShellScope({super.key, required this.go, required super.child});
  final void Function(Place place) go;
  static void Function(Place place) of(BuildContext context) => context.getInheritedWidgetOfExactType<ShellScope>()!.go;
  @override
  bool updateShouldNotify(ShellScope oldWidget) => false;
}

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> with SingleTickerProviderStateMixin {
  Place _place = Place.home;
  late final _entrance = AnimationController(vsync: this, duration: const Duration(milliseconds: 240), value: 1);
  late final _opacity = Tween(begin: .88, end: 1.0).chain(CurveTween(curve: Curves.easeOutCubic)).animate(_entrance);
  late final _offset = Tween(begin: const Offset(0, .012), end: Offset.zero).chain(CurveTween(curve: Curves.easeOutCubic)).animate(_entrance);

  void _go(Place place) {
    if (_place == place) return;
    setState(() => _place = place);
    if (MediaQuery.disableAnimationsOf(context)) {
      _entrance.value = 1;
    } else {
      _entrance.forward(from: 0);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) _entrance.value = 1;
  }

  @override
  void dispose() {
    _entrance.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    Kiku.of(context).songs.reload();
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final pages = IndexedStack(
      index: _place.index,
      children: [
        for (final (index, page) in const [HomeScreen(), GenerateScreen(), StudioScreen(), ScoreScreen(), LibraryScreen()].indexed)
          TickerMode(
            enabled: _place.index == index,
            child: RepaintBoundary(child: page),
          ),
      ],
    );
    // The studio and score keep their own full-screen layouts, as on the web.
    final player = _place == Place.studio || _place == Place.score ? const SizedBox.shrink() : MiniPlayer(player: services.player);
    final body = Column(
      children: [
        Expanded(
          child: FadeTransition(
            opacity: _opacity,
            child: SlideTransition(position: _offset, child: pages),
          ),
        ),
        player,
      ],
    );
    final colors = KikuColors.of(context);
    return ShellScope(
      go: _go,
      child: wide
          ? Scaffold(
              body: Row(
                children: [
                  NavigationRail(
                    selectedIndex: _place.index,
                    onDestinationSelected: (i) => _go(Place.values[i]),
                    labelType: NavigationRailLabelType.all,
                    leading: const Padding(padding: EdgeInsets.fromLTRB(0, 12, 0, 18), child: KikuMark(size: 36)),
                    trailing: Expanded(
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 16),
                          child: IconButton(tooltip: 'Settings', icon: const Icon(Icons.settings_outlined), onPressed: () => showSettings(context)),
                        ),
                      ),
                    ),
                    destinations: [
                      for (final p in Place.values)
                        NavigationRailDestination(icon: Icon(p.icon), selectedIcon: Icon(p.selected), label: Text(p.label)),
                    ],
                  ),
                  VerticalDivider(width: 1, color: colors.line),
                  Expanded(child: body),
                ],
              ),
            )
          : Scaffold(
              body: body,
              bottomNavigationBar: NavigationBar(
                selectedIndex: _place.index,
                onDestinationSelected: (i) => _go(Place.values[i]),
                destinations: [
                  for (final p in Place.values) NavigationDestination(icon: Icon(p.icon), selectedIcon: Icon(p.selected, color: accent), label: p.label),
                ],
              ),
            ),
    );
  }
}

/// The app bar every place uses: its title, and the settings button on phones.
class PlaceBar extends StatelessWidget implements PreferredSizeWidget {
  const PlaceBar({super.key, required this.title, this.actions = const []});
  final Widget title;
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 840;
    return AppBar(
      title: title,
      titleSpacing: 20,
      actions: [
        ...actions,
        if (!wide) IconButton(tooltip: 'Settings', icon: const Icon(Icons.account_circle_outlined), onPressed: () => showSettings(context)),
        const SizedBox(width: 6),
      ],
    );
  }
}
