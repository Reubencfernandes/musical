import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../auth/session.dart';
import '../config.dart';
import 'errors.dart';
import 'gradio.dart';
import 'kiku_server.dart';

/// The generation models the app offers, as in the web studio.
enum Model {
  ace15('ACE-Step 1.5', 'Generates songs, instrumentals and parts, and edits audio directly.'),
  yue2('YuE2', 'Strong vocals and melody. Plans and performs scores, and makes covers.'),
  ace1('ACE-Step 1', 'The original engine, on your Hugging Face GPU allowance.');

  const Model(this.label, this.blurb);
  final String label, blurb;

  /// Runs on Kiku's private Modal GPUs rather than the user's ZeroGPU allowance.
  bool get modal => this != Model.ace1;
}

/// Which models can do each studio task.
const supports = <String, List<Model>>{
  'restyle': [Model.ace15, Model.ace1],
  'rewrite': [Model.ace15, Model.ace1],
  'extend': [Model.ace15, Model.ace1],
  'part': [Model.ace15, Model.ace1],
  'instrumental': [Model.ace15, Model.yue2, Model.ace1],
  'song': [Model.ace15, Model.yue2],
  'cover': [Model.yue2],
};

/// How each job runs: the web app's lib/jobs.ts, trimmed to what the app needs.
/// Jobs on ACE-Step 1.5 or YuE2 go to Kiku's server, which builds the
/// endpoint's arguments itself; jobs on the Hugging Face engine (SheetSage2,
/// Demucs, Whisper and ACE-Step 1) are built here.
class _Spec {
  const _Spec({this.models, this.fixed, this.audio = true, this.min = 3, this.max = 240, this.waiting});
  final List<Model>? models;

  /// 'engine' for jobs only the Hugging Face engine serves, 'modal' for ACE-Step 1.5's helpers.
  final String? fixed;
  final bool audio;
  final double min, max;
  final String? waiting;
}

const _specs = <String, _Spec>{
  'remix': _Spec(),
  'repaint': _Spec(min: 1),
  'extend': _Spec(max: 200),
  'cover': _Spec(models: [Model.yue2], max: 300, waiting: 'Waiting for a GPU. Covers are queued one at a time…'),
  'part': _Spec(audio: false, waiting: 'Waiting for a GPU. Parts are queued one at a time…'),
  'split': _Spec(fixed: 'engine', max: 360),
  'score': _Spec(fixed: 'engine', max: 300, waiting: 'Waiting for a GPU to read the score…'),
  'lyrics': _Spec(fixed: 'engine', max: 300, waiting: 'Waiting for a GPU to listen to the words…'),
  'transcribe': _Spec(fixed: 'engine', min: 5, max: 600, waiting: 'Waiting for a GPU to write your score…'),
  'song': _Spec(models: [Model.yue2, Model.ace15], audio: false, waiting: 'Waiting for a GPU. Songs are queued one at a time…'),
  'instrumental': _Spec(models: [Model.ace15, Model.yue2, Model.ace1], audio: false),
  'enhance': _Spec(fixed: 'modal', audio: false),
  'sample': _Spec(fixed: 'modal', audio: false),
};

num _num(Map<String, Object?> input, String name, num fallback, num min, num max) {
  final raw = input[name];
  final value = raw is num ? raw : num.tryParse('${raw ?? ''}');
  return (value == null || !value.isFinite ? fallback : value).clamp(min, max);
}

String _text(Map<String, Object?> input, String name) => (input[name] ?? '').toString().trim();
Object? _json(Object? value) {
  if (value is! String) return value is Map ? value : null;
  try {
    return jsonDecode(value);
  } catch (_) {
    return null;
  }
}

/// Runs jobs on whichever engine serves them and fetches their files.
class Engine {
  Engine(this.settings, this.auth);
  final Settings settings;
  final AuthService auth;

  KikuServer get _server => KikuServer(settings.appOrigin, auth.token);

  /// Runs [job] with [input] (and [audio], a WAV, when the job takes audio) and
  /// returns its result: the same shape the web app's jobs return, with files
  /// as [Download]s.
  Future<Map<String, dynamic>> run(
    String job,
    Map<String, Object?> input, {
    File? audio,
    Model? model,
    required CancelToken cancel,
    required StatusFn status,
    ProgressFn? progress,
  }) async {
    final spec = _specs[job];
    if (spec == null) throw ArgumentError('Unknown job $job');
    final allowed = spec.models ?? const [Model.ace15, Model.ace1];
    final chosen = spec.fixed != null ? null : (model ?? allowed.first);
    if (chosen != null && !allowed.contains(chosen)) {
      throw KikuException('${chosen.label} cannot do this. Choose ${allowed.map((m) => m.label).join(' or ')}.');
    }
    if (spec.audio && audio == null && job != 'part') throw const KikuException('There was no audio to send.');
    final client = http.Client();
    cancel.onCancel(client.close);
    try {
      final modal = spec.fixed == 'modal' || (chosen != null && chosen.modal);
      final Map<String, dynamic> result;
      if (modal) {
        final fields = <String, String>{
          for (final entry in input.entries)
            if (entry.value != null) entry.key: entry.value is String ? entry.value as String : jsonEncodeIfNeeded(entry.value),
          if (chosen != null) 'model': chosen.name,
        };
        result = await _server.runModal(job, fields,
            audio: audio, client: client, cancel: cancel, status: status, progress: progress);
        return _files(result);
      }
      final gradio = GradioClient(settings.engineOrigin, auth.token, client);
      status(audio != null ? 'Sending your audio…' : 'Connecting to the studio…');
      final file = audio != null ? await gradio.upload(audio) : null;
      cancel.check();
      final outputs = await gradio.run('/$job', _args(job, input, file),
          status: status, waiting: spec.waiting ?? 'Waiting for an available GPU…');
      cancel.check();
      result = _shape(job, outputs, gradio.file);
      progress?.call(const Progress(fraction: 1, eta: 0, running: true));
      return result;
    } on SignedOut {
      auth.expire();
      rethrow;
    } catch (error) {
      if (cancel.cancelled) throw const Cancelled();
      if (error is KikuException || error is Cancelled) rethrow;
      final message = error.toString();
      if (RegExp(r'\b401\b|unauthori[sz]ed|invalid.*token', caseSensitive: false).hasMatch(message)) {
        auth.expire();
        throw const SignedOut();
      }
      throw KikuException(explain(message.replaceFirst(RegExp(r'^(ClientException|SocketException|Exception):\s*'), '')));
    } finally {
      client.close();
    }
  }

  static String jsonEncodeIfNeeded(Object? value) => value is num || value is bool ? '$value' : jsonEncode(value);

  /// Modal results name files by paths on Kiku's server.
  Map<String, dynamic> _files(Map<String, dynamic> result) => {
    for (final entry in result.entries) entry.key: Download.from(entry.value) ?? entry.value,
  };

  /// The endpoint's arguments for jobs the Hugging Face engine runs.
  List<dynamic> _args(String job, Map<String, Object?> input, Map<String, dynamic>? audio) {
    final style = _text(input, 'style'), lyrics = _text(input, 'lyrics');
    final steps = _num(input, 'steps', 60, 20, 120), seed = _num(input, 'seed', -1, -1, 2147483647);
    switch (job) {
      case 'remix':
        // The engine's strength is how closely to keep the source; the app asks how much to change.
        final strength = ((1 - _num(input, 'change', 0.5, 0.1, 0.9)) * 100).round() / 100;
        return [audio, style, lyrics, strength, steps, seed];
      case 'repaint':
        return [audio, style, lyrics, _num(input, 'start', 0, 0, 240), _num(input, 'end', 0, 0, 240), _num(input, 'variance', 0.5, 0.1, 1), steps, seed];
      case 'extend':
        return [audio, style, lyrics, _num(input, 'seconds', 20, 5, 40), steps, seed];
      case 'part':
        return [audio, _text(input, 'instrument'), style, _num(input, 'bpm', 0, 0, 300), _text(input, 'key'), _num(input, 'duration', 30, 5, 240), _num(input, 'strength', 0.45, 0.2, 0.8), steps, seed];
      case 'instrumental':
        return [style, lyrics, _num(input, 'duration', 60, 10, 240), steps, _num(input, 'guidance', 15, 3, 25), seed];
      case 'split':
      case 'lyrics':
        return [audio];
      case 'score':
        return [audio, _text(input, 'words') != 'false'];
      case 'transcribe':
        return [audio, 0, _num(input, 'duration', 30, 5, 600), false, false];
    }
    throw KikuException('$job does not run on the Hugging Face engine.');
  }

  Map<String, dynamic> _shape(String job, List<dynamic> data, Download? Function(Object?) file) {
    Object? at(int i) => i < data.length ? data[i] : null;
    final status = (at(0) ?? '').toString();
    switch (job) {
      case 'remix':
      case 'repaint':
      case 'extend':
      case 'instrumental':
        return {'status': status, 'audio': file(at(1)), 'abc': ''};
      case 'part':
        return {'status': status, 'audio': file(at(1)), 'prompt': at(2) is String ? at(2) : '', 'analysis': _json(at(3))};
      case 'split':
        return {'status': status, 'vocals': file(at(1)), 'drums': file(at(2)), 'bass': file(at(3)), 'other': file(at(4))};
      case 'score':
        return {'status': status, 'abc': (at(1) ?? '').toString(), 'summary': _json(at(2))};
      case 'lyrics':
        return {'status': status, 'lyrics': (at(1) ?? '').toString()};
      case 'transcribe':
        final abc = at(5);
        if (abc is! String || abc.trim().isEmpty) throw const KikuException('No editable score was returned. Try another recording.');
        final downloads = at(4) is List ? (at(4) as List).map(file).whereType<Download>().toList() : <Download>[];
        return {'status': status, 'abc': abc, 'downloads': downloads, 'pdf': file(at(2)), 'audio': file(at(3)), 'timing': _json(at(6))};
    }
    return {'status': status};
  }

  /// Fetches a result file. Files on Kiku's server and on the engine both need
  /// the user's token. Gateway hiccups are retried; the finished job is not lost.
  Future<Uint8List> fetch(Download file, {CancelToken? cancel}) async {
    final url = file.url.startsWith('/') ? '${settings.appOrigin}${file.url}' : file.url;
    final client = http.Client();
    cancel?.onCancel(client.close);
    try {
      for (int attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await Future<void>.delayed(Duration(seconds: 2 * attempt));
        cancel?.check();
        try {
          final response = await client.get(Uri.parse(url), headers: {'Authorization': 'Bearer ${auth.token}'});
          if (response.statusCode == 200) return response.bodyBytes;
          if (response.statusCode == 401) {
            auth.expire();
            throw const SignedOut();
          }
          if (response.statusCode == 404 || response.statusCode == 403) {
            throw const KikuException('That file has expired. Run the step again.');
          }
        } on SignedOut {
          rethrow;
        } on KikuException {
          rethrow;
        } catch (_) {
          cancel?.check();
        }
      }
      throw const KikuException('The result could not be downloaded. Try again; your project is safe.');
    } finally {
      client.close();
    }
  }

  /// DreamLite artwork for a song, through Kiku's server.
  Future<(Uint8List, int?)> cover({required String title, required String caption, required String lyrics}) =>
      _server.cover(title: title, caption: caption, lyrics: lyrics);
}
