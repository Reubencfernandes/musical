import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'package:youtube_explode_dart/youtube_explode_dart.dart';

String youtubeVideoId(String value) {
  final uri = Uri.tryParse(value.trim());
  if (uri == null ||
      !['https', 'http'].contains(uri.scheme) ||
      uri.userInfo.isNotEmpty) {
    throw const FormatException('Paste a valid YouTube video link.');
  }
  final host = uri.host.toLowerCase();
  String? id;
  if (host == 'youtu.be' && uri.pathSegments.length == 1) {
    id = uri.pathSegments.first;
  } else if ([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
  ].contains(host)) {
    if (uri.path == '/watch') id = uri.queryParameters['v'];
    if (uri.pathSegments.length == 2 &&
        ['shorts', 'embed', 'live'].contains(uri.pathSegments.first)) {
      id = uri.pathSegments.last;
    }
  }
  if (id == null || !RegExp(r'^[a-zA-Z0-9_-]{11}$').hasMatch(id)) {
    throw const FormatException(
      'Paste a YouTube video link, rather than a playlist or channel.',
    );
  }
  return id;
}

class YoutubeAudio {
  final String title;
  final Duration duration;
  final int size;
  final Stream<List<int>> bytes;
  YoutubeAudio(this.title, this.duration, this.size, this.bytes);
}

abstract interface class YoutubeSource {
  Future<YoutubeAudio> open(String id);
  void close();
}

// YouTube page parsing runs off the UI isolate. Its regex/JSON work can be
// expensive, so closing this source terminates only this network worker.
class DirectYoutubeSource implements YoutubeSource {
  Isolate? _worker;
  ReceivePort? _port;
  StreamIterator<dynamic>? _messages;
  bool _closed = false;

  @override
  Future<YoutubeAudio> open(String id) async {
    final port = ReceivePort();
    _port = port;
    final messages = StreamIterator<dynamic>(port);
    _messages = messages;
    final worker = await Isolate.spawn(
      _youtubeWorker,
      [id, port.sendPort],
      onError: port.sendPort,
      onExit: port.sendPort,
    );
    _worker = worker;
    if (_closed) {
      worker.kill(priority: Isolate.immediate);
      throw ImportCancelled();
    }
    if (!await messages.moveNext()) throw StateError('YouTube worker stopped.');
    final first = messages.current;
    if (first is! Map || first['type'] != 'ready') {
      throw StateError('YouTube did not provide audio.');
    }
    final ack = first['ack'] as SendPort;
    Stream<List<int>> chunks() async* {
      while (true) {
        ack.send(true);
        if (!await messages.moveNext()) {
          throw StateError('YouTube download interrupted.');
        }
        final message = messages.current;
        if (message is Map && message['type'] == 'done') return;
        if (message is! Map || message['bytes'] == null) {
          throw StateError('YouTube download failed.');
        }
        yield List<int>.from(message['bytes']);
      }
    }

    return YoutubeAudio(
      first['title'] as String,
      Duration(milliseconds: first['duration'] as int),
      first['size'] as int,
      chunks(),
    );
  }

  @override
  void close() {
    _closed = true;
    _worker?.kill(priority: Isolate.immediate);
    _port?.close();
    unawaited(_messages?.cancel());
  }
}

Future<void> _youtubeWorker(List<dynamic> args) async {
  final source = _YoutubeNetworkSource(), reply = args[1] as SendPort;
  final acknowledgements = ReceivePort();
  final ack = StreamIterator<dynamic>(acknowledgements);
  try {
    final audio = await source.open(args[0] as String);
    reply.send({
      'type': 'ready',
      'title': audio.title,
      'duration': audio.duration.inMilliseconds,
      'size': audio.size,
      'ack': acknowledgements.sendPort,
    });
    if (!await ack.moveNext()) return;
    await for (final chunk in audio.bytes) {
      reply.send({'bytes': chunk});
      if (!await ack.moveNext()) return;
    }
    reply.send({'type': 'done'});
  } catch (_) {
    reply.send({'type': 'error'});
  } finally {
    source.close();
    await ack.cancel();
    acknowledgements.close();
  }
}

class _YoutubeNetworkSource implements YoutubeSource {
  final client = YoutubeExplode();
  @override
  Future<YoutubeAudio> open(String id) async {
    final video = await client.videos.get(id);
    if (video.isLive || video.duration == null) {
      throw const FormatException(
        'Choose a finished video instead of a live stream.',
      );
    }
    if (video.duration! > const Duration(minutes: 10)) {
      throw const FormatException('Choose a video up to 10 minutes long.');
    }
    // Explicit clients avoid a desktop JavaScript process on iOS. Streams
    // requiring unavailable signature challenges fail with the upload fallback.
    final manifest = await client.videos.streams.getManifest(
      id,
      ytClients: [YoutubeApiClient.androidSdkless],
    );
    final tracks =
        manifest.audioOnly.where((s) => s.container.name == 'mp4').toList()
          ..sort(
            (a, b) =>
                b.bitrate.bitsPerSecond.compareTo(a.bitrate.bitsPerSecond),
          );
    if (tracks.isEmpty) {
      throw const FormatException(
        'YouTube did not offer a compatible audio track. Upload the audio file instead.',
      );
    }
    final track = tracks.first;
    return YoutubeAudio(
      video.title,
      video.duration!,
      track.size.totalBytes,
      client.videos.streams.get(track),
    );
  }

  @override
  void close() => client.close();
}

class ImportCancelled implements Exception {}

class YoutubeImportResult {
  final String title, path;
  final bool excerpt;
  YoutubeImportResult(this.title, this.path, this.excerpt);
}

typedef AudioConverter = Future<void> Function(String source, String output);

class YoutubeImporter {
  final YoutubeSource Function() sourceFactory;
  final Duration lookupTimeout;
  final Duration downloadTimeout;
  YoutubeSource? _source;
  bool _cancelled = false, busy = false;
  YoutubeImporter({
    YoutubeSource Function()? sourceFactory,
    this.lookupTimeout = const Duration(seconds: 60),
    this.downloadTimeout = const Duration(seconds: 30),
  }) : sourceFactory = sourceFactory ?? DirectYoutubeSource.new;

  void cancel() {
    _cancelled = true;
    _source?.close();
  }

  void _check() {
    if (_cancelled) throw ImportCancelled();
  }

  Future<YoutubeImportResult> import(
    String url,
    Directory root,
    AudioConverter convert,
    void Function(String, double?) progress,
  ) async {
    if (busy) throw StateError('An import is already in progress.');
    final id = youtubeVideoId(url);
    busy = true;
    _cancelled = false;
    Directory? temporary;
    bool success = false;
    try {
      _source = sourceFactory();
      progress('Finding the audio…', null);
      final audio = await _source!.open(id).timeout(lookupTimeout);
      _check();
      const limit = 100 * 1024 * 1024;
      if (audio.duration > const Duration(minutes: 10) ||
          audio.size <= 0 ||
          audio.size > limit) {
        throw const FormatException(
          'Choose a video up to 10 minutes with audio smaller than 100 MB.',
        );
      }
      await root.create(recursive: true);
      temporary = await root.createTemp('youtube-');
      final compressed = File('${temporary.path}/source.m4a');
      final output = '${temporary.path}/audio.wav';
      final sink = compressed.openWrite();
      int received = 0;
      try {
        progress('Downloading audio…', 0);
        await for (final chunk in audio.bytes.timeout(
          downloadTimeout,
          onTimeout: (events) {
            // Unblock the worker's pending read before await-for cancels its
            // async generator; otherwise stream cancellation can wait forever.
            _source?.close();
            events.addError(
              TimeoutException('YouTube audio download stalled.'),
            );
            events.close();
          },
        )) {
          _check();
          received += chunk.length;
          if (received > limit || received > audio.size) {
            throw const FormatException(
              'The audio download exceeded its expected size.',
            );
          }
          sink.add(chunk);
          progress('Downloading audio…', received / audio.size);
        }
      } finally {
        await sink.flush();
        await sink.close();
      }
      _check();
      if (received != audio.size) {
        throw const FormatException(
          'The audio download was interrupted. Try again.',
        );
      }
      progress('Preparing the first three minutes…', null);
      await convert(compressed.path, output);
      _check();
      if (!await File(output).exists() || await File(output).length() <= 44) {
        throw const FormatException('The video did not produce usable audio.');
      }
      await compressed.delete();
      success = true;
      return YoutubeImportResult(
        audio.title,
        output,
        audio.duration > const Duration(minutes: 3),
      );
    } catch (error) {
      if (_cancelled) throw ImportCancelled();
      if (error is FormatException || error is FileSystemException) rethrow;
      throw StateError(
        'YouTube could not provide this audio. It may be unavailable or blocking downloads. Try another video or upload a recording.',
      );
    } finally {
      _source?.close();
      _source = null;
      busy = false;
      if (!success && temporary != null && await temporary.exists()) {
        await temporary.delete(recursive: true);
      }
    }
  }
}
