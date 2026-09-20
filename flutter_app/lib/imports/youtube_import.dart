import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'package:youtube_explode_dart/youtube_explode_dart.dart';
import 'audio_download.dart';

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
      _throwWorkerError(first, 'YouTube did not provide audio.');
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
          _throwWorkerError(message, 'YouTube download failed.');
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
  } catch (error) {
    reply.send({
      'type': 'error',
      'message': error is FormatException
          ? error.message
          : error is StateError
          ? error.message
          : error.toString(),
      'format': error is FormatException,
    });
  } finally {
    source.close();
    await ack.cancel();
    acknowledgements.close();
  }
}

Never _throwWorkerError(dynamic message, String fallback) {
  if (message is Map && message['type'] == 'error') {
    final detail = message['message'] as String? ?? fallback;
    if (message['format'] == true) throw FormatException(detail);
    throw StateError(detail);
  }
  throw StateError(fallback);
}

class _YoutubeNetworkSource implements YoutubeSource {
  YoutubeExplode? _client;
  HttpClient? _downloadClient;

  @override
  Future<YoutubeAudio> open(String id) async {
    // A manifest can succeed while its CDN stream stalls. Try each client
    // separately and require actual bytes before committing to its track.
    final failures = <String>[];
    for (final apiClient in [
      YoutubeApiClient.ios,
      YoutubeApiClient.androidVr,
      YoutubeApiClient.androidSdkless,
    ]) {
      final client = YoutubeExplode();
      _client = client;
      final http = HttpClient()..connectionTimeout = const Duration(seconds: 8);
      _downloadClient = http;
      StreamIterator<List<int>>? iterator;
      var phase = 'video details';
      try {
        final video = await client.videos
            .get(id)
            .timeout(const Duration(seconds: 10));
        if (video.isLive || video.duration == null) {
          throw const FormatException(
            'Choose a finished video instead of a live stream.',
          );
        }
        if (video.duration! > const Duration(minutes: 10)) {
          throw const FormatException('Choose a video up to 10 minutes long.');
        }
        phase = 'stream lookup';
        final manifest = await client.videos.streams
            .getManifest(id, ytClients: [apiClient], requireWatchPage: false)
            .timeout(const Duration(seconds: 20));
        final tracks =
            manifest.audioOnly
                .where(
                  (s) =>
                      s.container.name == 'mp4' &&
                      s.size.totalBytes > 0 &&
                      s.size.totalBytes <= 100 * 1024 * 1024,
                )
                .toList()
              ..sort(
                (a, b) =>
                    a.bitrate.bitsPerSecond.compareTo(b.bitrate.bitsPerSecond),
              );
        if (tracks.isEmpty) {
          throw StateError('No compatible MP4 audio track was offered.');
        }
        final track = tracks.first;
        phase = 'audio download';
        final chunks = StreamIterator(
          downloadAudioRanges(
            http,
            track.url,
            track.size.totalBytes,
            // Mobile stream URLs may allow only one request per manifest.
            // Stream that response with backpressure instead of reopening it.
            chunkSize: track.size.totalBytes,
            userAgent:
                apiClient.payload['context']['client']['userAgent']
                    as String? ??
                'Mozilla/5.0',
          ),
        );
        iterator = chunks;
        if (!await chunks.moveNext().timeout(const Duration(seconds: 8))) {
          throw StateError('YouTube returned an empty audio stream.');
        }
        Stream<List<int>> bytes() async* {
          try {
            yield chunks.current;
            while (await chunks.moveNext()) {
              yield chunks.current;
            }
          } finally {
            client.close();
            http.close(force: true);
            await chunks.cancel();
          }
        }

        return YoutubeAudio(
          video.title,
          video.duration!,
          track.size.totalBytes,
          bytes(),
        );
      } on FormatException {
        client.close();
        http.close(force: true);
        rethrow;
      } catch (error) {
        failures.add(
          '${apiClient.payload['context']['client']['clientName']} ($phase): $error',
        );
        client.close();
        http.close(force: true);
        // The whole network worker is terminated by close(); never wait on a
        // stalled upstream async generator before trying the next client.
        if (iterator != null) unawaited(iterator.cancel());
      }
    }
    // For many videos YouTube serves only the opening seconds of a stream
    // unless the request carries a browser attestation token, which this app
    // cannot produce. Enforcement is per video, so another link may work but
    // retrying the same one will not.
    final blocked = failures.any(
      (f) => f.contains('403') || f.contains('not a bot'),
    );
    throw StateError(
      '${blocked ? 'YouTube blocks app downloads for this video (it does this for many, but not all, videos). Try another video, or save the audio to Files and use Upload.' : 'YouTube audio was unavailable. Upload a recording or try another video.'} '
      'Details: ${failures.join('; ')}',
    );
  }

  @override
  void close() {
    _client?.close();
    _downloadClient?.close(force: true);
  }
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
  Completer<YoutubeAudio>? _cancelLookup;
  YoutubeImporter({
    YoutubeSource Function()? sourceFactory,
    this.lookupTimeout = const Duration(seconds: 90),
    this.downloadTimeout = const Duration(seconds: 30),
  }) : sourceFactory = sourceFactory ?? DirectYoutubeSource.new;

  void cancel() {
    _cancelled = true;
    _source?.close();
    final lookup = _cancelLookup;
    if (lookup != null && !lookup.isCompleted) {
      lookup.completeError(ImportCancelled());
    }
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
      final cancellation = Completer<YoutubeAudio>();
      _cancelLookup = cancellation;
      final audio = await Future.any([
        _source!.open(id),
        cancellation.future,
      ]).timeout(lookupTimeout);
      _cancelLookup = null;
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
      final sink = await compressed.open(mode: FileMode.write);
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
          // Await disk writes to keep worker acknowledgements bounded.
          await sink.writeFrom(chunk);
          progress('Downloading audio…', received / audio.size);
        }
      } finally {
        await sink.close();
      }
      _check();
      if (received != audio.size) {
        throw const FormatException(
          'The audio download was interrupted. Try again.',
        );
      }
      progress('Preparing the first three minutes…', null);
      try {
        await convert(compressed.path, output);
      } catch (error) {
        if (error is FormatException || error is FileSystemException) rethrow;
        throw FormatException(
          'Audio downloaded, but conversion failed: $error',
        );
      }
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
      if (error is TimeoutException) {
        throw StateError(
          'YouTube timed out while finding or downloading audio. '
          'Check your connection and try again, or upload a recording.',
        );
      }
      if (error is StateError) rethrow;
      throw StateError(
        'YouTube could not provide this audio. It may be unavailable or blocking downloads. Try another video or upload a recording.',
      );
    } finally {
      _source?.close();
      _source = null;
      _cancelLookup = null;
      busy = false;
      if (!success && temporary != null && await temporary.exists()) {
        await temporary.delete(recursive: true);
      }
    }
  }
}
