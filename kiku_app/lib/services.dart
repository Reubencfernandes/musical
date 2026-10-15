import 'dart:async';

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

  /// The last signed-in user, kept through sign-out, and whether they could save.
  String? _user;
  bool _storage = false;

  /// Forgets the last user's songs and work when someone else signs in. A
  /// lapsed or ended session keeps them: the same user signing back in
  /// carries on, and songs made while saving was off are saved once it is on.
  void _signedInOrOut() {
    final user = auth.user;
    if (user == null) {
      unawaited(studio.pause());
      unawaited(player.pause());
      return;
    }
    if (_user != null && user.id != _user) {
      songs.clear();
      studio.reset();
      score.reset();
    }
    final allowed = user.storage && !(user.id == _user && _storage);
    _user = user.id;
    _storage = user.storage;
    if (allowed) unawaited(songs.saveUnsaved().catchError((Object _) {}));
  }
}

class Kiku extends InheritedWidget {
  const Kiku({super.key, required this.services, required super.child});
  final Services services;

  static Services of(BuildContext context) => context.getInheritedWidgetOfExactType<Kiku>()!.services;

  @override
  bool updateShouldNotify(Kiku oldWidget) => oldWidget.services != services;
}
