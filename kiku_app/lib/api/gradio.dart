import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import 'errors.dart';

/// A file a job returned: where to fetch it and what it is called.
class Download {
  const Download(this.url, this.name);
  final String url, name;

  static Download? from(Object? value) {
    if (value is Download) return value;
    if (value is Map && value['url'] is String) {
      return Download(value['url'] as String, value['name'] as String? ?? 'download');
    }
    return null;
  }

  Map<String, String> toJson() => {'url': url, 'name': name};
}

class SseEvent {
  const SseEvent(this.event, this.data);
  final String event, data;
}

/// Splits a server-sent event stream into events.
Stream<SseEvent> parseSse(Stream<List<int>> bytes) async* {
  var buffer = '';
  SseEvent read(String block) {
    var event = 'message';
    final data = <String>[];
    for (final line in block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        data.add(line.substring(5).trimLeft());
      }
    }
    return SseEvent(event, data.join('\n'));
  }

  await for (final chunk in bytes.transform(utf8.decoder)) {
    buffer += chunk.replaceAll('\r\n', '\n');
    for (int cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
      final block = buffer.substring(0, cut);
      buffer = buffer.substring(cut + 2);
      if (block.trim().isNotEmpty) yield read(block);
    }
  }
  if (buffer.trim().isNotEmpty) yield read(buffer);
}

Object? _parse(String data) {
  try {
    return jsonDecode(data);
  } catch (_) {
    return data;
  }
}

/// Failures that are Hugging Face's gateway or a Space waking up, worth trying again.
final passing = RegExp(r'\b(429|50[0234])\b|too many requests|starting|bad gateway|<!doctype html|<html|connection|socket|network',
    caseSensitive: false);

/// Calls a Gradio Space's API with the signed-in user's token, so the work
/// counts against their own ZeroGPU allowance, as the web app's browser calls do.
class GradioClient {
  GradioClient(this.origin, this.token, this.client);
  final String origin, token;
  final http.Client client;

  Map<String, String> get _auth => {'Authorization': 'Bearer $token'};

  Never _fail(int status, String body, String step) {
    if (status == 401) throw const SignedOut();
    if (status == 403 || status == 404) {
      throw KikuException('The engine refused the $step ($status). Check the engine address in Settings.');
    }
    throw KikuException(explain('The $step failed ($status). ${body.length > 300 ? body.substring(0, 300) : body}'.trim()));
  }

  /// Uploads a file and returns the FileData to pass as an argument.
  Future<Map<String, dynamic>> upload(File file) async {
    final name = p.basename(file.path);
    final request = await _multipart(file, name);
    final response = await http.Response.fromStream(await client.send(request));
    if (response.statusCode != 200) _fail(response.statusCode, response.body, 'upload');
    final paths = jsonDecode(response.body);
    if (paths is! List || paths.isEmpty || paths.first is! String) throw const KikuException('The engine did not accept the audio.');
    return {
      'path': paths.first,
      'orig_name': name,
      'size': await file.length(),
      'mime_type': 'audio/wav',
      'meta': {'_type': 'gradio.FileData'},
    };
  }

  Future<http.MultipartRequest> _multipart(File file, String name) async {
    final request = http.MultipartRequest('POST', Uri.parse('$origin/gradio_api/upload'))..headers.addAll(_auth);
    request.files.add(await http.MultipartFile.fromPath('files', file.path, filename: name));
    return request;
  }

  /// Runs an endpoint and follows it to the end, reporting each status the
  /// endpoint yields. Returns the endpoint's outputs.
  Future<List<dynamic>> run(
    String endpoint,
    List<dynamic> data, {
    required void Function(String) status,
    String waiting = 'Waiting for an available GPU…',
  }) async {
    final name = endpoint.replaceFirst(RegExp(r'^/'), '');
    String? eventId;
    // A request that never reached the queue is sent again; once queued it never is,
    // so nobody is charged GPU time twice for one tap.
    for (int attempt = 0; eventId == null; attempt++) {
      try {
        final response = await client.post(
          Uri.parse('$origin/gradio_api/call/$name'),
          headers: {..._auth, 'Content-Type': 'application/json'},
          body: jsonEncode({'data': data}),
        );
        if (response.statusCode != 200) _fail(response.statusCode, response.body, 'request');
        eventId = (jsonDecode(response.body) as Map)['event_id'] as String?;
        if (eventId == null) throw const KikuException('The engine did not queue the job.');
      } catch (error) {
        if (error is SignedOut || attempt >= 3 || !passing.hasMatch(error.toString())) rethrow;
        status('Hugging Face is busy. Trying again in a moment…');
        await Future<void>.delayed(Duration(seconds: 3 << attempt));
      }
    }
    status(waiting);
    final request = http.Request('GET', Uri.parse('$origin/gradio_api/call/$name/$eventId'))..headers.addAll(_auth);
    final response = await client.send(request);
    if (response.statusCode != 200) _fail(response.statusCode, await response.stream.bytesToString(), 'result stream');
    List<dynamic>? last;
    await for (final event in parseSse(response.stream)) {
      switch (event.event) {
        case 'generating':
          final value = _parse(event.data);
          if (value is List) {
            last = value;
            if (value.isNotEmpty && value.first is String && (value.first as String).isNotEmpty) status(value.first as String);
          }
        case 'complete':
          final value = _parse(event.data);
          if (value is List) return value;
          if (last != null) return last;
          throw const KikuException('The engine returned nothing. Please try again.');
        case 'error':
          final message = _parse(event.data);
          throw KikuException(explain(message is String && message.isNotEmpty && message != 'null'
              ? message
              : last != null
              ? 'The engine could not finish this one. Try a shorter piece.'
              : 'The engine turned the request away without saying why, usually because the GPU allowance is used up. Try again later.'));
      }
    }
    if (last != null) return last;
    throw const KikuException('The engine closed the connection before finishing. Try again; your project is safe.');
  }

  /// A file output, refusing anything not served by this Space.
  Download? file(Object? value) {
    if (value is! Map) return null;
    final url = value['url'] as String? ?? (value['path'] is String ? '$origin/gradio_api/file=${value['path']}' : null);
    if (url == null || !_sameOrigin(url, origin)) return null;
    final path = value['path'] as String?;
    return Download(url, value['orig_name'] as String? ?? (path != null ? p.basename(path) : 'download'));
  }
}

bool _sameOrigin(String url, String origin) {
  final a = Uri.tryParse(url), b = Uri.tryParse(origin);
  return a != null && b != null && a.scheme == b.scheme && a.host == b.host && a.port == b.port;
}
