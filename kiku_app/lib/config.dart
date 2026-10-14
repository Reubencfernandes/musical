import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the app finds Kiku AI. The defaults are the deployed Spaces; both can
/// be changed in Settings, for a fork or a local server.
class Defaults {
  /// The Kiku AI web app: its OAuth client document and its private Modal GPU routes.
  static const appOrigin = 'https://reubencf-kiku-ai.hf.space';

  /// The Gradio ZeroGPU engine: transcription, stems, lyrics and ACE-Step 1.
  static const engineOrigin = 'https://reubencf-kiku-engine.hf.space';

  /// The app comes back from Hugging Face sign-in through this URL scheme.
  static const callbackScheme = 'kikuai';
  static const redirectUri = 'kikuai://oauth/callback';

  /// What sign-in asks for: who you are, and permission to keep your music in
  /// a private dataset in your own account (the same as the web app).
  static const scopes = 'openid profile read-repos write-repos manage-repos';

  /// The private dataset in each user's account that holds their library.
  static const library = 'kiku-ai-library';
}

class Settings extends ChangeNotifier {
  Settings(this._prefs);
  final SharedPreferences _prefs;

  static Future<Settings> load() async => Settings(await SharedPreferences.getInstance());

  String get appOrigin => _origin(_prefs.getString('appOrigin'), Defaults.appOrigin);
  String get engineOrigin => _origin(_prefs.getString('engineOrigin'), Defaults.engineOrigin);
  String get oauthClientId => '$appOrigin/oauth/client';

  ThemeMode get themeMode => switch (_prefs.getString('theme')) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  Future<void> setOrigins({required String app, required String engine}) async {
    await _prefs.setString('appOrigin', normalizeOrigin(app) ?? Defaults.appOrigin);
    await _prefs.setString('engineOrigin', normalizeOrigin(engine) ?? Defaults.engineOrigin);
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await _prefs.setString('theme', mode.name);
    notifyListeners();
  }

  static String _origin(String? saved, String fallback) => normalizeOrigin(saved ?? '') ?? fallback;
}

/// "owner/name" Space ids and full URLs both become an https origin; anything else is null.
String? normalizeOrigin(String value) {
  final text = value.trim();
  if (text.isEmpty) return null;
  final space = RegExp(r'^([\w.-]+)/([\w.-]+)$').firstMatch(text);
  if (space != null) {
    final id = '${space.group(1)}-${space.group(2)}'.toLowerCase().replaceAll(RegExp(r'[_.]'), '-');
    return 'https://$id.hf.space';
  }
  final uri = Uri.tryParse(text);
  if (uri == null || uri.host.isEmpty || !(uri.scheme == 'https' || uri.scheme == 'http')) return null;
  return '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
}
