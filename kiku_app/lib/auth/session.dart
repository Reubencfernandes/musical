import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

import '../api/errors.dart';
import '../config.dart';

class KikuUser {
  const KikuUser({required this.id, required this.name, required this.handle, required this.storage});
  final String id, name, handle;

  /// Whether the token may create and write the user's library dataset.
  final bool storage;

  factory KikuUser.fromJson(Map<String, dynamic> j) => KikuUser(
    id: j['id'] as String,
    name: j['name'] as String? ?? 'Musician',
    handle: j['handle'] as String? ?? j['name'] as String? ?? 'musician',
    storage: j['storage'] == true,
  );
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'handle': handle, 'storage': storage};
}

class Session {
  const Session({required this.token, required this.user, this.expires, this.oauth = true});
  final String token;
  final KikuUser user;

  /// Sign-in tokens expire (Hugging Face gives them about eight hours); pasted access tokens do not.
  final DateTime? expires;
  final bool oauth;

  bool get expired => expires != null && DateTime.now().isAfter(expires!.subtract(const Duration(minutes: 1)));

  factory Session.fromJson(Map<String, dynamic> j) => Session(
    token: j['token'] as String,
    user: KikuUser.fromJson((j['user'] as Map).cast<String, dynamic>()),
    expires: j['expires'] is int ? DateTime.fromMillisecondsSinceEpoch(j['expires'] as int) : null,
    oauth: j['oauth'] != false,
  );
  Map<String, dynamic> toJson() => {
    'token': token,
    'user': user.toJson(),
    'expires': expires?.millisecondsSinceEpoch,
    'oauth': oauth,
  };
}

/// Signs in with Hugging Face, like the web app, but from the device: the app
/// runs the OAuth authorization-code flow with PKCE against Kiku AI's own
/// client and holds the user's token itself. Every request then goes out from
/// the user's own connection, with their own GPU allowance.
class AuthService extends ChangeNotifier {
  AuthService(this.settings, {http.Client? client, FlutterSecureStorage? storage})
    : _http = client ?? http.Client(),
      _storage = storage ?? const FlutterSecureStorage();

  final Settings settings;
  final http.Client _http;
  final FlutterSecureStorage _storage;
  static const _key = 'kiku-session';

  Session? _session;
  bool _ready = false;
  bool _remembered = true;

  Session? get session => _session;
  KikuUser? get user => _session?.user;
  bool get ready => _ready;

  /// False when the device refused to keep the session, so it lasts until the app closes.
  bool get remembered => _remembered;

  /// The user's token, or [SignedOut] when there is no live session.
  String get token {
    final current = _session;
    if (current == null || current.expired) throw const SignedOut();
    return current.token;
  }

  Future<void> load() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw != null) {
        final saved = Session.fromJson((jsonDecode(raw) as Map).cast<String, dynamic>());
        if (!saved.expired) _session = saved;
      }
    } catch (_) {
      // Unreadable or unavailable storage: start signed out.
    }
    _ready = true;
    notifyListeners();
  }

  Future<void> _keep(Session session) async {
    _session = session;
    try {
      await _storage.write(key: _key, value: jsonEncode(session.toJson()));
      _remembered = true;
    } catch (_) {
      _remembered = false;
    }
    notifyListeners();
  }

  /// Opens Hugging Face sign-in in the system's secure browser sheet.
  Future<void> signInWithHuggingFace() async {
    final verifier = _random(32), state = _random(24);
    final challenge = base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');
    final authorize = Uri.https('huggingface.co', '/oauth/authorize', {
      'client_id': settings.oauthClientId,
      'redirect_uri': Defaults.redirectUri,
      'response_type': 'code',
      'scope': Defaults.scopes,
      'state': state,
      'code_challenge': challenge,
      'code_challenge_method': 'S256',
    });
    final String result;
    try {
      result = await FlutterWebAuth2.authenticate(url: authorize.toString(), callbackUrlScheme: Defaults.callbackScheme);
    } catch (e) {
      if (e.toString().contains('CANCELED')) throw const Cancelled();
      throw const KikuException('Sign-in did not open. Check your connection and try again, or use an access token.');
    }
    final params = Uri.parse(result).queryParameters;
    if (params['error'] != null) {
      throw KikuException(params['error_description'] ?? 'Hugging Face did not complete sign-in (${params['error']}).');
    }
    if (params['state'] != state || params['code'] == null) {
      throw const KikuException('Sign-in did not complete. Please try again.');
    }
    final response = await _http.post(
      Uri.parse('https://huggingface.co/oauth/token'),
      body: {
        'client_id': settings.oauthClientId,
        'grant_type': 'authorization_code',
        'code': params['code']!,
        'redirect_uri': Defaults.redirectUri,
        'code_verifier': verifier,
      },
    );
    if (response.statusCode != 200) {
      throw const KikuException('Hugging Face did not accept the sign-in. Please try again.');
    }
    final tokens = jsonDecode(response.body) as Map<String, dynamic>;
    final access = tokens['access_token'], seconds = tokens['expires_in'];
    if (access is! String || seconds is! num) throw const KikuException('Hugging Face sent an unexpected answer.');
    final profile = await _http.get(
      Uri.parse('https://huggingface.co/oauth/userinfo'),
      headers: {'Authorization': 'Bearer $access'},
    );
    if (profile.statusCode != 200) throw const KikuException('Could not read your Hugging Face profile.');
    final info = jsonDecode(profile.body) as Map<String, dynamic>;
    final scopes = (tokens['scope'] as String? ?? '').split(RegExp(r'\s+'));
    final handle = (info['preferred_username'] ?? info['name'] ?? 'musician').toString();
    await _keep(Session(
      token: access,
      expires: DateTime.now().add(Duration(seconds: seconds.toInt())),
      user: KikuUser(
        id: info['sub'].toString(),
        name: (info['name'] ?? handle).toString(),
        handle: handle,
        storage: scopes.contains('write-repos') || scopes.length <= 1,
      ),
    ));
  }

  /// Signs in with a Hugging Face access token from huggingface.co/settings/tokens.
  Future<void> signInWithToken(String value) async {
    final token = value.trim();
    if (!RegExp(r'^hf_[A-Za-z0-9_-]{20,}$').hasMatch(token)) {
      throw const KikuException('Paste a Hugging Face access token; it starts with hf_.');
    }
    final response = await _http.get(
      Uri.parse('https://huggingface.co/api/whoami-v2'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode == 401) throw const KikuException('Hugging Face did not accept that token.');
    if (response.statusCode != 200) throw const KikuException('Could not reach Hugging Face. Check your connection.');
    final who = jsonDecode(response.body) as Map<String, dynamic>;
    if (who['type'] != 'user') throw const KikuException('Use a token that belongs to your own user account.');
    final role = ((who['auth'] as Map?)?['accessToken'] as Map?)?['role'];
    await _keep(Session(
      token: token,
      oauth: false,
      user: KikuUser(
        id: who['id'].toString(),
        name: (who['fullname'] ?? who['name']).toString(),
        handle: who['name'].toString(),
        storage: role != 'read',
      ),
    ));
  }

  Future<void> signOut() async {
    _session = null;
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
    notifyListeners();
  }

  /// Called when Hugging Face or Kiku turns the token away.
  void expire() {
    if (_session == null) return;
    unawaited(signOut());
  }

  static String _random(int bytes) {
    final rng = Random.secure();
    return base64Url.encode(List<int>.generate(bytes, (_) => rng.nextInt(256))).replaceAll('=', '');
  }
}
