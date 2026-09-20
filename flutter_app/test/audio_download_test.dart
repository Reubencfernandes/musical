import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/imports/audio_download.dart';

void main() {
  Future<void> withServer(
    Future<void> Function(HttpRequest) respond,
    Future<void> Function(HttpClient, Uri) run,
  ) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final client = HttpClient();
    final subscription = server.listen(
      (request) => unawaited(respond(request)),
    );
    try {
      await run(client, Uri.parse('http://127.0.0.1:${server.port}/audio'));
    } finally {
      client.close(force: true);
      await subscription.cancel();
      await server.close(force: true);
    }
  }

  test(
    'Range download preserves every byte and uses bounded requests',
    () async {
      final data = List.generate(1031, (i) => i % 256);
      final ranges = <String>[];
      await withServer(
        (request) async {
          expect(request.headers.value('user-agent'), 'test-client');
          final range = request.headers.value('range')!;
          ranges.add(range);
          final match = RegExp(r'bytes=(\d+)-(\d+)').firstMatch(range)!;
          final start = int.parse(match[1]!), end = int.parse(match[2]!);
          request.response.statusCode = 206;
          request.response.headers.set(
            'content-range',
            'bytes $start-$end/${data.length}',
          );
          request.response.add(data.sublist(start, end + 1));
          await request.response.close();
        },
        (client, url) async {
          final bytes = await downloadAudioRanges(
            client,
            url,
            data.length,
            userAgent: 'test-client',
            chunkSize: 256,
          ).expand((e) => e).toList();
          expect(bytes, data);
          expect(ranges, [
            'bytes=0-255',
            'bytes=256-511',
            'bytes=512-767',
            'bytes=768-1023',
            'bytes=1024-1030',
          ]);
        },
      );
    },
  );

  test(
    'A server ignoring the initial range can return the whole file',
    () async {
      await withServer(
        (request) async {
          request.response.add([1, 2, 3, 4]);
          await request.response.close();
        },
        (client, url) async {
          expect(
            await downloadAudioRanges(
              client,
              url,
              4,
              userAgent: 'test',
              chunkSize: 2,
            ).expand((e) => e).toList(),
            [1, 2, 3, 4],
          );
        },
      );
    },
  );

  for (final scenario in [
    'wrong range',
    'truncated',
    'oversized',
    'forbidden',
  ]) {
    test('Rejects $scenario responses', () async {
      await withServer(
        (request) async {
          request.response.statusCode = scenario == 'forbidden' ? 403 : 206;
          request.response.headers.set(
            'content-range',
            scenario == 'wrong range' ? 'bytes 1-4/4' : 'bytes 0-3/4',
          );
          request.response.add(scenario == 'truncated' ? [1] : [1, 2, 3, 4, 5]);
          await request.response.close();
        },
        (client, url) async {
          await expectLater(
            downloadAudioRanges(
              client,
              url,
              4,
              userAgent: 'test',
            ).drain<void>(),
            throwsA(
              scenario == 'forbidden'
                  ? isA<HttpException>()
                  : isA<FormatException>(),
            ),
          );
        },
      );
    });
  }
}
