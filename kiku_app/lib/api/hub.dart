import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'errors.dart';

class HubEntry {
  const HubEntry(this.path, this.type, this.size);
  final String path, type;
  final int size;
  bool get isFile => type == 'file';
}

/// A file to add in a commit.
class HubFile {
  const HubFile(this.path, this.content);
  final String path;
  final Uint8List content;
}

/// The few Hugging Face Hub calls the library needs, on a dataset repo, with
/// the user's own token: the same HTTP API huggingface_hub and @huggingface/hub use.
class HubClient {
  HubClient(this.token, {http.Client? client, this.endpoint = 'https://huggingface.co'}) : _http = client ?? http.Client();
  final String token, endpoint;
  final http.Client _http;

  Map<String, String> get _auth => {'Authorization': 'Bearer $token'};

  Never _fail(http.BaseResponse response, String body, String what) {
    if (response.statusCode == 401) throw const SignedOut();
    if (response.statusCode == 403) throw const NeedsStorage();
    String message = body;
    try {
      final data = jsonDecode(body);
      if (data is Map && data['error'] != null) message = data['error'].toString();
    } catch (_) {}
    throw KikuException('Hugging Face could not $what (${response.statusCode}). ${message.length > 200 ? message.substring(0, 200) : message}'.trim());
  }

  Future<bool> exists(String repo) async {
    final response = await _http.get(Uri.parse('$endpoint/api/datasets/$repo'), headers: _auth);
    if (response.statusCode == 200) return true;
    if (response.statusCode == 404) return false;
    if (response.statusCode == 401) throw const SignedOut();
    return false;
  }

  /// Creates a private dataset in the user's own namespace; an existing one is fine.
  Future<void> create(String name) async {
    final response = await _http.post(
      Uri.parse('$endpoint/api/repos/create'),
      headers: {..._auth, 'Content-Type': 'application/json'},
      body: jsonEncode({'type': 'dataset', 'name': name, 'private': true}),
    );
    if (response.statusCode == 200 || response.statusCode == 409) return;
    _fail(response, response.body, 'create your library');
  }

  /// Files and folders in one folder of the repo; empty when it does not exist.
  Future<List<HubEntry>> list(String repo, String path) async {
    final response = await _http.get(Uri.parse('$endpoint/api/datasets/$repo/tree/main/$path'), headers: _auth);
    if (response.statusCode == 404) return const [];
    if (response.statusCode == 401) throw const SignedOut();
    if (response.statusCode != 200) _fail(response, response.body, 'list your library');
    final items = jsonDecode(response.body);
    if (items is! List) return const [];
    return [
      for (final item in items.whereType<Map>())
        HubEntry(item['path'] as String? ?? '', item['type'] as String? ?? 'file', (item['size'] as num?)?.toInt() ?? 0),
    ];
  }

  /// A file's bytes, or null when it (or the repo) does not exist.
  Future<Uint8List?> download(String repo, String path) async {
    final response = await _http.get(
      Uri.parse('$endpoint/datasets/$repo/resolve/main/${path.split('/').map(Uri.encodeComponent).join('/')}'),
      headers: _auth,
    );
    if (response.statusCode == 200) return response.bodyBytes;
    if (response.statusCode == 404 || response.statusCode == 403) return null;
    if (response.statusCode == 401) throw const SignedOut();
    _fail(response, response.body, 'download $path');
  }

  /// Adds and deletes files in one commit on main. Binary files go through
  /// Git LFS (the Hub's preupload check says which), small text files inline.
  Future<void> commit(String repo, String summary, {List<HubFile> add = const [], List<String> delete = const []}) async {
    final modes = add.isEmpty ? const <String, String>{} : await _uploadModes(repo, add);
    final lines = <Map<String, dynamic>>[
      {
        'key': 'header',
        'value': {'summary': summary, 'description': ''},
      },
    ];
    for (final file in add) {
      if (modes[file.path] == 'lfs') {
        final oid = sha256.convert(file.content).toString();
        await _lfsUpload(repo, oid, file.content);
        lines.add({
          'key': 'lfsFile',
          'value': {'path': file.path, 'algo': 'sha256', 'oid': oid, 'size': file.content.length},
        });
      } else {
        lines.add({
          'key': 'file',
          'value': {'path': file.path, 'content': base64Encode(file.content), 'encoding': 'base64'},
        });
      }
    }
    for (final path in delete) {
      lines.add({
        'key': 'deletedFile',
        'value': {'path': path},
      });
    }
    final response = await _http.post(
      Uri.parse('$endpoint/api/datasets/$repo/commit/main'),
      headers: {..._auth, 'Content-Type': 'application/x-ndjson'},
      body: lines.map(jsonEncode).join('\n'),
    );
    if (response.statusCode != 200) _fail(response, response.body, 'save to your library');
  }

  Future<Map<String, String>> _uploadModes(String repo, List<HubFile> files) async {
    final response = await _http.post(
      Uri.parse('$endpoint/api/datasets/$repo/preupload/main'),
      headers: {..._auth, 'Content-Type': 'application/json'},
      body: jsonEncode({
        'files': [
          for (final f in files)
            {
              'path': f.path,
              'size': f.content.length,
              'sample': base64Encode(f.content.sublist(0, f.content.length < 512 ? f.content.length : 512)),
            },
        ],
      }),
    );
    if (response.statusCode != 200) _fail(response, response.body, 'prepare the upload');
    final data = jsonDecode(response.body) as Map;
    return {
      for (final f in (data['files'] as List? ?? const []).whereType<Map>())
        f['path'] as String: f['uploadMode'] as String? ?? 'regular',
    };
  }

  Future<void> _lfsUpload(String repo, String oid, Uint8List content) async {
    const lfs = 'application/vnd.git-lfs+json';
    final batch = await _http.post(
      Uri.parse('$endpoint/datasets/$repo.git/info/lfs/objects/batch'),
      headers: {..._auth, 'Accept': lfs, 'Content-Type': lfs},
      body: jsonEncode({
        'operation': 'upload',
        'transfers': ['basic'],
        'hash_algo': 'sha256',
        'ref': {'name': 'main'},
        'objects': [
          {'oid': oid, 'size': content.length},
        ],
      }),
    );
    if (batch.statusCode != 200) _fail(batch, batch.body, 'start the upload');
    final object = ((jsonDecode(batch.body) as Map)['objects'] as List).first as Map;
    if (object['error'] != null) {
      throw KikuException('Hugging Face refused the upload: ${(object['error'] as Map)['message'] ?? 'unknown error'}.');
    }
    final actions = object['actions'] as Map?;
    // No actions: the Hub already has this file.
    if (actions == null || actions['upload'] == null) return;
    final upload = actions['upload'] as Map;
    final headers = <String, String>{
      for (final e in ((upload['header'] as Map?) ?? const {}).entries) e.key.toString(): e.value.toString(),
    };
    final put = await _http.put(Uri.parse(upload['href'] as String), headers: headers, body: content);
    if (put.statusCode >= 300) _fail(put, put.body, 'upload the audio');
    final verify = actions['verify'] as Map?;
    if (verify != null) {
      final checked = await _http.post(
        Uri.parse(verify['href'] as String),
        headers: {
          ..._auth,
          'Content-Type': lfs,
          for (final e in ((verify['header'] as Map?) ?? const {}).entries) e.key.toString(): e.value.toString(),
        },
        body: jsonEncode({'oid': oid, 'size': content.length}),
      );
      if (checked.statusCode >= 300) _fail(checked, checked.body, 'check the upload');
    }
  }

  void close() => _http.close();
}
