import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';

class ModelFile {
  final String name, url, digest;
  final int size;
  ModelFile(Map<String, dynamic> json)
    : name = json['name'],
      url = json['url'],
      digest = json['sha256'],
      size = json['size'];
}

class ModelPackage {
  final String id, name, revision;
  final List<ModelFile> files;
  ModelPackage(Map<String, dynamic> json)
    : id = json['id'],
      name = json['name'],
      revision = json['revision'],
      files = (json['files'] as List).map((f) => ModelFile(f)).toList();
  int get size => files.fold(0, (n, f) => n + f.size);
}

class DownloadCancelled implements Exception {}

class ModelStore {
  final Directory root;
  HttpClient? _client;
  bool _cancelled = false;
  ModelStore(this.root);
  Directory directory(ModelPackage model) =>
      Directory('${root.path}/${model.id}/${model.revision}');
  Future<bool> installed(ModelPackage model) async {
    final dir = directory(model);
    if (!await File('${dir.path}/verified').exists()) return false;
    for (final file in model.files) {
      final local = File('${dir.path}/${file.name}');
      if (!await local.exists() || await local.length() != file.size) {
        return false;
      }
    }
    return true;
  }

  void cancel() {
    _cancelled = true;
    _client?.close(force: true);
  }

  Future<void> install(
    ModelPackage model,
    void Function(int, int, String) progress,
  ) async {
    if (_client != null) throw StateError('Another download is in progress.');
    _cancelled = false;
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30);
    _client = client;
    final dir = directory(model);
    int finished = 0;
    try {
      await dir.create(recursive: true);
      for (final spec in model.files) {
        if (_cancelled) throw DownloadCancelled();
        final target = File('${dir.path}/${spec.name}');
        await target.parent.create(recursive: true);
        if (await target.exists() &&
            await target.length() == spec.size &&
            await _hash(target) == spec.digest) {
          finished += spec.size;
          continue;
        }
        final partial = File('${target.path}.part');
        int offset = await partial.exists() ? await partial.length() : 0;
        if (offset > spec.size) {
          await partial.delete();
          offset = 0;
        }
        if (offset < spec.size) {
          final request = await client.getUrl(Uri.parse(spec.url));
          if (offset > 0) {
            request.headers.set(HttpHeaders.rangeHeader, 'bytes=$offset-');
          }
          final response = await request.close().timeout(
            const Duration(seconds: 45),
          );
          if (response.statusCode != 200 && response.statusCode != 206) {
            throw HttpException(
              'Model download returned ${response.statusCode}.',
            );
          }
          if (response.statusCode == 200) {
            offset = 0;
          } else if (!(response.headers.value(HttpHeaders.contentRangeHeader) ??
                  '')
              .startsWith('bytes $offset-')) {
            throw const HttpException('Invalid resumed download.');
          }
          final sink = partial.openWrite(
            mode: offset > 0 ? FileMode.append : FileMode.write,
          );
          try {
            await for (final bytes in response.timeout(
              const Duration(seconds: 45),
            )) {
              if (_cancelled) throw DownloadCancelled();
              offset += bytes.length;
              if (offset > spec.size) {
                throw const HttpException('Unexpected model file size.');
              }
              sink.add(bytes);
              progress(finished + offset, model.size, spec.name);
            }
          } finally {
            await sink.flush();
            await sink.close();
          }
        }
        if (_cancelled) throw DownloadCancelled();
        progress(finished + offset, model.size, 'Verifying ${spec.name}');
        if (await partial.length() != spec.size) {
          throw const HttpException(
            'Download interrupted. Tap download to resume.',
          );
        }
        if (await _hash(partial) != spec.digest) {
          await partial.delete();
          throw const FormatException(
            'Model checksum failed. Please download again.',
          );
        }
        if (_cancelled) throw DownloadCancelled();
        if (await target.exists()) await target.delete();
        await partial.rename(target.path);
        finished += spec.size;
      }
      if (_cancelled) throw DownloadCancelled();
      await File(
        '${dir.path}/verified',
      ).writeAsString(jsonEncode({'revision': model.revision}));
      progress(model.size, model.size, 'Ready for offline use');
    } catch (error) {
      if (_cancelled) throw DownloadCancelled();
      rethrow;
    } finally {
      client.close(force: true);
      _client = null;
    }
  }

  Future<String> _hash(File file) async =>
      (await sha256.bind(file.openRead()).first).toString();
}
