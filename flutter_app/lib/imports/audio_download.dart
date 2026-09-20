import 'dart:io';
import 'dart:math';

/// Bounded CDN requests avoid the upstream downloader's swallowed stream errors
/// and unbounded buffering. The caller owns and closes [client] on cancellation.
Stream<List<int>> downloadAudioRanges(
  HttpClient client,
  Uri url,
  int size, {
  required String userAgent,
  int chunkSize = 256 * 1024,
}) async* {
  if (size <= 0 || chunkSize <= 0) throw ArgumentError('Invalid audio size');
  int offset = 0;
  while (offset < size) {
    final end = min(offset + chunkSize, size) - 1;
    final request = await client
        .getUrl(url)
        .timeout(const Duration(seconds: 10));
    request.headers.set(HttpHeaders.userAgentHeader, userAgent);
    request.headers.set(HttpHeaders.rangeHeader, 'bytes=$offset-$end');
    final response = await request.close().timeout(const Duration(seconds: 10));
    int expected;
    if (response.statusCode == HttpStatus.partialContent) {
      final range = response.headers.value(HttpHeaders.contentRangeHeader);
      if (range != 'bytes $offset-$end/$size') {
        throw const FormatException('YouTube returned an invalid audio range.');
      }
      expected = end - offset + 1;
    } else if (response.statusCode == HttpStatus.ok && offset == 0) {
      // A server may ignore Range on the initial request and send the full file.
      expected = size;
    } else {
      throw HttpException(
        'YouTube audio request failed (HTTP ${response.statusCode}).',
      );
    }
    int received = 0;
    await for (final bytes in response.timeout(const Duration(seconds: 15))) {
      received += bytes.length;
      if (received > expected) {
        throw const FormatException(
          'YouTube returned more audio than requested.',
        );
      }
      yield bytes;
    }
    if (received != expected) {
      throw const FormatException('YouTube audio was interrupted. Try again.');
    }
    offset += received;
  }
}
