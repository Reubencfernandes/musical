import 'dart:convert';
import 'dart:typed_data';

class WavAudio {
  final Float32List samples;
  final int sampleRate, channels;
  WavAudio(this.samples, this.sampleRate, this.channels);

  static WavAudio decode(Uint8List bytes) {
    final data = ByteData.sublistView(bytes);
    String tag(int at) => ascii.decode(bytes.sublist(at, at + 4));
    if (bytes.length < 44 || tag(0) != 'RIFF' || tag(8) != 'WAVE') {
      throw const FormatException(
        'Select a PCM WAV file (16-bit or 32-bit float).',
      );
    }
    int format = 0, channels = 0, rate = 0, bits = 0;
    Uint8List? pcm;
    for (int at = 12; at + 8 <= bytes.length;) {
      final size = data.getUint32(at + 4, Endian.little), start = at + 8;
      if (start + size > bytes.length) {
        throw const FormatException('Truncated WAV file.');
      }
      if (tag(at) == 'fmt ' && size >= 16) {
        format = data.getUint16(start, Endian.little);
        channels = data.getUint16(start + 2, Endian.little);
        rate = data.getUint32(start + 4, Endian.little);
        bits = data.getUint16(start + 14, Endian.little);
      } else if (tag(at) == 'data') {
        pcm = Uint8List.sublistView(bytes, start, start + size);
      }
      at = start + size + (size % 2);
    }
    if (pcm == null ||
        channels < 1 ||
        channels > 2 ||
        rate < 8000 ||
        rate > 192000 ||
        !((format == 1 && bits == 16) || (format == 3 && bits == 32))) {
      throw const FormatException(
        'Use a mono/stereo 16-bit PCM or 32-bit float WAV.',
      );
    }
    final stride = bits ~/ 8;
    if (pcm.length % (stride * channels) != 0 || pcm.isEmpty) {
      throw const FormatException('Invalid WAV samples.');
    }
    final values = Float32List(pcm.length ~/ stride),
        raw = ByteData.sublistView(pcm);
    for (int i = 0; i < values.length; i++) {
      final value = format == 1
          ? raw.getInt16(i * stride, Endian.little) / 32768
          : raw.getFloat32(i * stride, Endian.little);
      if (!value.isFinite) {
        throw const FormatException('Audio contains invalid samples.');
      }
      values[i] = value;
    }
    return WavAudio(values, rate, channels);
  }
}

Uint8List wavHeader(int frames, int sampleRate, int channels) {
  final bytes = Uint8List(44),
      d = ByteData.sublistView(bytes),
      size = frames * channels * 2;
  bytes.setAll(0, ascii.encode('RIFF'));
  d.setUint32(4, 36 + size, Endian.little);
  bytes.setAll(8, ascii.encode('WAVEfmt '));
  d.setUint32(16, 16, Endian.little);
  d.setUint16(20, 1, Endian.little);
  d.setUint16(22, channels, Endian.little);
  d.setUint32(24, sampleRate, Endian.little);
  d.setUint32(28, sampleRate * channels * 2, Endian.little);
  d.setUint16(32, channels * 2, Endian.little);
  d.setUint16(34, 16, Endian.little);
  bytes.setAll(36, ascii.encode('data'));
  d.setUint32(40, size, Endian.little);
  return bytes;
}
