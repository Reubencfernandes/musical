import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'errors.dart';

/// How far a job has got: the engine's own fraction when it reports one, the
/// queue's estimate of the seconds left, and the place in the queue.
class Progress {
  const Progress({this.fraction, this.eta, this.queue, this.running = false});
  final double? fraction, eta;
  final int? queue;
  final bool running;

  static Progress from(Object? value) {
    if (value is! Map) return const Progress();
    double? n(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
    return Progress(
      fraction: n(value['fraction'])?.clamp(0.0, 1.0),
      eta: n(value['eta']),
      queue: (value['queue'] as num?)?.toInt(),
      running: value['running'] == true,
    );
  }
}

typedef StatusFn = void Function(String message);
typedef ProgressFn = void Function(Progress progress);

/// The Kiku AI web app's server, which holds the private Modal GPU
/// credentials for ACE-Step 1.5 and YuE2. The app calls it with the user's own
/// Hugging Face token as a bearer header.
class KikuServer {
  KikuServer(this.origin, this.token);
  final String origin, token;

  Map<String, String> get _auth => {'Authorization': 'Bearer $token'};

  /// Runs a Modal job and follows its event stream. The job lives on the
  /// server, not in this connection: when a proxy drops the stream, this
  /// reattaches and carries on from the last event it saw.
  Future<Map<String, dynamic>> runModal(
    String job,
    Map<String, String> fields, {
    File? audio,
    required http.Client client,
    required CancelToken cancel,
    required StatusFn status,
    ProgressFn? progress,
  }) async {
    status('Starting Modal GPU…');
    String id = '';
    int seq = 0;
    Map<String, dynamic>? result;
    String? failure;
    void receive(String line) {
      if (line.trim().isEmpty) return;
      final event = jsonDecode(line);
      if (event is! Map) return;
      if (event['type'] == 'job') {
        id = event['id'] as String? ?? '';
        return;
      }
      final number = event['seq'];
      if (number is num) {
        if (number <= seq) return;
        seq = number.toInt();
      }
      switch (event['type']) {
        case 'status':
          if (event['message'] is String) status(event['message'] as String);
          if (event['progress'] != null) progress?.call(Progress.from(event['progress']));
        case 'result':
          result = (event['data'] as Map).cast<String, dynamic>();
        case 'error':
          failure = (event['error'] ?? 'The Modal generation could not finish.').toString();
      }
    }

    // Stopping a job here stops it on the GPU too.
    cancel.onCancel(() {
      if (id.isNotEmpty && result == null && failure == null) {
        final other = http.Client();
        other
            .delete(Uri.parse('$origin/api/modal/jobs?id=${Uri.encodeQueryComponent(id)}'), headers: _auth)
            .catchError((_) => http.Response('', 499))
            .whenComplete(other.close);
      }
    });

    Future<void> read(http.StreamedResponse response) async {
      try {
        await for (final line in response.stream.transform(utf8.decoder).transform(const LineSplitter())) {
          receive(line);
          if (failure != null || result != null) break;
        }
      } catch (_) {
        cancel.check();
        // A dropped connection: reattach below.
      }
    }

    final request = http.MultipartRequest('POST', Uri.parse('$origin/api/modal/jobs?job=${Uri.encodeQueryComponent(job)}'))
      ..headers.addAll(_auth)
      ..fields.addAll(fields);
    if (audio != null) request.files.add(await http.MultipartFile.fromPath('audio', audio.path, filename: 'selection.wav'));
    http.StreamedResponse? response;
    try {
      response = await client.send(request);
    } catch (_) {
      cancel.check();
      throw const KikuException('Could not reach Kiku AI. Check your connection and try again; nothing was started.');
    }
    if (response.statusCode != 200) {
      final body = await response.stream.bytesToString();
      if (response.statusCode == 401) throw const SignedOut();
      throw KikuException(_error(body) ?? 'Could not reach the Modal GPU (${response.statusCode}). Try again.');
    }
    for (int drops = 0;; drops++) {
      if (response != null) await read(response);
      cancel.check();
      if (failure != null) throw KikuException(failure!);
      if (result != null) break;
      if (id.isEmpty || drops >= 8) {
        throw const KikuException('The connection to Kiku dropped and could not be restored. Try again; your project is safe.');
      }
      status('Connection dropped. Reconnecting…');
      await cancel.pause(Duration(milliseconds: (1000 * (1 << drops)).clamp(1000, 15000)));
      cancel.check();
      try {
        final again = http.Request('GET', Uri.parse('$origin/api/modal/jobs?id=${Uri.encodeQueryComponent(id)}&after=$seq'))
          ..headers.addAll(_auth);
        response = await client.send(again);
        if (response.statusCode == 401) throw const SignedOut();
        if (response.statusCode == 404) {
          throw const KikuException('Kiku restarted while this was running, so the generation was lost. Try again; your project is safe.');
        }
        if (response.statusCode != 200) response = null;
      } on SignedOut {
        rethrow;
      } on KikuException {
        rethrow;
      } catch (_) {
        cancel.check();
        response = null;
      }
    }
    progress?.call(const Progress(fraction: 1, eta: 0, running: true));
    return result!;
  }

  static String? _error(String body) {
    try {
      final data = jsonDecode(body);
      return data is Map && data['error'] is String ? data['error'] as String : null;
    } catch (_) {
      return null;
    }
  }
}
