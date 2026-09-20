import 'dart:io';
import 'package:flutter/services.dart';

/// Serves the bundled score player to the in-app web view over loopback.
/// A real origin lets the page fetch its instrument samples, which file://
/// pages cannot do; nothing here is reachable from outside the device.
class ScoreServer {
  static HttpServer? _server;

  static Future<Uri> start() async {
    final server = _server ??= await _bind();
    return Uri.parse('http://127.0.0.1:${server.port}/index.html');
  }

  static Future<HttpServer> _bind() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_serve, onError: (_) {});
    return server;
  }

  static const _types = {
    'html': 'text/html; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
    'mp3': 'audio/mpeg',
    'md': 'text/plain; charset=utf-8',
  };

  static Future<void> _serve(HttpRequest request) async {
    final response = request.response;
    try {
      final segments = request.uri.pathSegments;
      if (request.method != 'GET' ||
          segments.isEmpty ||
          segments.any((s) => s.isEmpty || s.startsWith('.'))) {
        response.statusCode = HttpStatus.notFound;
        return;
      }
      final data = await rootBundle.load('assets/score/${segments.join('/')}');
      response.headers
        ..set(
          HttpHeaders.contentTypeHeader,
          _types[segments.last.split('.').last] ?? 'application/octet-stream',
        )
        ..set(HttpHeaders.cacheControlHeader, 'max-age=3600');
      response.add(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      );
    } catch (_) {
      response.statusCode = HttpStatus.notFound;
    } finally {
      await response.close();
    }
  }
}
