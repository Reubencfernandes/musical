import 'package:flutter/widgets.dart';

import 'api/engine.dart';
import 'api/library.dart';
import 'auth/session.dart';
import 'config.dart';
import 'score/score_controller.dart';
import 'shell/player.dart';
import 'songs/songs_controller.dart';
import 'studio/studio_controller.dart';

/// Everything the screens share, created once at start-up.
class Services {
  Services(this.settings) : auth = AuthService(settings) {
    engine = Engine(settings, auth);
    library = Library(auth);
    songs = SongsController(engine, library, auth);
    studio = StudioController(engine, library);
    score = ScoreController(engine, library, auth);
    auth.addListener(_signedInOrOut);
  }

  final Settings settings;
  final AuthService auth;
  final PlayerController player = PlayerController();
  late final Engine engine;
  late final Library library;
  late final SongsController songs;
  late final StudioController studio;
  late final ScoreController score;
  String? _user;

  /// Forgets the last user's songs and work when someone else signs in.
  void _signedInOrOut() {
    final id = auth.user?.id;
    if (id == _user) return;
    final hadUser = _user != null;
    _user = id;
    if (hadUser) {
      songs.clear();
      studio.reset();
      score.reset();
    }
  }
}

class Kiku extends InheritedWidget {
  const Kiku({super.key, required this.services, required super.child});
  final Services services;

  static Services of(BuildContext context) => context.getInheritedWidgetOfExactType<Kiku>()!.services;

  @override
  bool updateShouldNotify(Kiku oldWidget) => oldWidget.services != services;
}
