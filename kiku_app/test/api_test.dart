import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiku_ai/api/errors.dart';
import 'package:kiku_ai/api/gradio.dart';
import 'package:kiku_ai/config.dart';
import 'package:kiku_ai/songs/songs_controller.dart';

void main() {
  test('parses server-sent events split across chunks', () async {
    final text = 'event: generating\ndata: ["Preparing your audio…", []]\n\nevent: heartbeat\r\ndata: null\r\n\r\n'
        'event: complete\ndata: ["done", 1]\n\n';
    final bytes = utf8.encode(text);
    final chunks = [for (int i = 0; i < bytes.length; i += 7) bytes.sublist(i, i + 7 > bytes.length ? bytes.length : i + 7)];
    final events = await parseSse(Stream.fromIterable(chunks)).toList();
    expect(events.map((e) => e.event), ['generating', 'heartbeat', 'complete']);
    expect(jsonDecode(events.first.data), ['Preparing your audio…', []]);
    expect(events.last.data, '["done", 1]');
  });

  test('reads Kiku server file references', () {
    final file = Download.from({'url': '/api/modal/file?ticket=abc', 'name': 'song.wav'});
    expect(file?.url, '/api/modal/file?ticket=abc');
    expect(file?.name, 'song.wav');
    expect(Download.from('nope'), isNull);
  });

  test('normalises Space ids and URLs', () {
    expect(normalizeOrigin('Reubencf/Kiku-Engine'), 'https://reubencf-kiku-engine.hf.space');
    expect(normalizeOrigin('https://reubencf-kiku-ai.hf.space/score?x=1'), 'https://reubencf-kiku-ai.hf.space');
    expect(normalizeOrigin('http://localhost:3000/'), 'http://localhost:3000');
    expect(normalizeOrigin('not a url'), isNull);
  });

  test('explains gateway, quota and rate-limit failures', () {
    expect(explain('<!DOCTYPE html><html><h1>502</h1></html>'), contains('error 502'));
    expect(explain('You have exceeded your GPU quota'), contains('allowance'));
    expect(explain('HTTP 429 Too Many Requests'), contains('busy'));
    expect(explain('plain message'), 'plain message');
  });

  test('cancel tokens fire listeners once', () async {
    final token = CancelToken();
    var calls = 0;
    token.onCancel(() => calls++);
    token
      ..cancel()
      ..cancel();
    token.onCancel(() => calls++);
    expect(calls, 2);
    expect(token.check, throwsA(isA<Cancelled>()));
    await token.pause(const Duration(hours: 1)).timeout(const Duration(seconds: 1));
  });

  test('titles songs from the idea', () {
    expect(titleFrom('a warm acoustic love song about the first snow, soft vocal'), 'A Warm Acoustic Love Song About');
    expect(titleFrom('   '), 'Untitled Song');
  });
}
