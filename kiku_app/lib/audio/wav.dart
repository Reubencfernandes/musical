import 'dart:convert';
import 'dart:typed_data';

import 'pcm.dart';

/// Whether these bytes are a RIFF/WAVE file.
bool isWav(Uint8List bytes) =>
    bytes.length >= 12 &&
    ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
    ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WAVE';

/// Reads a WAV file: integer PCM of 8 to 32 bits or 32/64-bit float, any
/// channel count (more than two are folded into a stereo pair).
Pcm decodeWav(Uint8List bytes) {
  if (!isWav(bytes)) throw const FormatException('This is not a WAV file.');
  final data = ByteData.sublistView(bytes);
  String tag(int at) => ascii.decode(bytes.sublist(at, at + 4), allowInvalid: true);
  int format = 0, channels = 0, rate = 0, bits = 0;
  int? start, length;
  for (int at = 12; at + 8 <= bytes.length;) {
    final size = data.getUint32(at + 4, Endian.little), body = at + 8;
    final name = tag(at);
    if (name == 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      format = data.getUint16(body, Endian.little);
      channels = data.getUint16(body + 2, Endian.little);
      rate = data.getUint32(body + 4, Endian.little);
      bits = data.getUint16(body + 14, Endian.little);
      // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID.
      if (format == 0xFFFE && size >= 26 && body + 26 <= bytes.length) {
        format = data.getUint16(body + 24, Endian.little);
      }
    } else if (name == 'data') {
      start = body;
      // Streams written while recording can leave the size at 0 or too large.
      length = (size == 0 || body + size > bytes.length) ? bytes.length - body : size;
      break;
    }
    at = body + size + (size & 1);
  }
  final stride = bits ~/ 8;
  if (start == null ||
      length == null ||
      channels < 1 ||
      rate < 1000 ||
      rate > 384000 ||
      !((format == 1 && bits >= 8 && bits <= 32 && bits % 8 == 0) || (format == 3 && (bits == 32 || bits == 64)))) {
    throw const FormatException('Use a PCM or floating-point WAV file.');
  }
  final frames = length ~/ (stride * channels);
  final out = channels == 1 ? Int16List(frames) : Int16List(frames * 2);
  double read(int offset) {
    switch (format == 3 ? bits + 100 : bits) {
      case 8:
        return (data.getUint8(offset) - 128) / 128;
      case 16:
        return data.getInt16(offset, Endian.little) / 32768;
      case 24:
        final value = data.getUint8(offset) | data.getUint8(offset + 1) << 8 | data.getInt8(offset + 2) << 16;
        return value / 8388608;
      case 32:
        return data.getInt32(offset, Endian.little) / 2147483648;
      case 132:
        return data.getFloat32(offset, Endian.little);
      default:
        return data.getFloat64(offset, Endian.little);
    }
  }

  for (int i = 0; i < frames; i++) {
    final base = start + i * stride * channels;
    if (channels == 1) {
      out[i] = _sample(read(base));
    } else if (channels == 2) {
      out[i * 2] = _sample(read(base));
      out[i * 2 + 1] = _sample(read(base + stride));
    } else {
      // Fold extra channels into left and right alternately.
      double left = 0, right = 0;
      for (int c = 0; c < channels; c++) {
        final value = read(base + c * stride);
        if (c.isEven) {
          left += value;
        } else {
          right += value;
        }
      }
      out[i * 2] = _sample(left / ((channels + 1) ~/ 2));
      out[i * 2 + 1] = _sample(right / (channels ~/ 2));
    }
  }
  return Pcm(out, channels == 1 ? 1 : 2, rate);
}

int _sample(double value) => value.isFinite ? toSample(value) : 0;

/// Writes 16-bit PCM WAV.
Uint8List encodeWav(Pcm pcm) {
  final size = pcm.samples.length * 2;
  final bytes = Uint8List(44 + size), d = ByteData.sublistView(bytes);
  bytes.setAll(0, ascii.encode('RIFF'));
  d.setUint32(4, 36 + size, Endian.little);
  bytes.setAll(8, ascii.encode('WAVEfmt '));
  d.setUint32(16, 16, Endian.little);
  d.setUint16(20, 1, Endian.little);
  d.setUint16(22, pcm.channels, Endian.little);
  d.setUint32(24, pcm.rate, Endian.little);
  d.setUint32(28, pcm.rate * pcm.channels * 2, Endian.little);
  d.setUint16(32, pcm.channels * 2, Endian.little);
  d.setUint16(34, 16, Endian.little);
  bytes.setAll(36, ascii.encode('data'));
  d.setUint32(40, size, Endian.little);
  final view = ByteData.sublistView(bytes, 44);
  for (int i = 0; i < pcm.samples.length; i++) {
    view.setInt16(i * 2, pcm.samples[i], Endian.little);
  }
  return bytes;
}

/// Seconds of audio in a WAV file, from its header; null when unreadable.
double? wavSeconds(Uint8List head, int fileLength) {
  if (head.length < 44 || !isWav(head)) return null;
  final d = ByteData.sublistView(head);
  final rate = d.getUint32(24, Endian.little), channels = d.getUint16(22, Endian.little);
  final bits = d.getUint16(34, Endian.little);
  if (rate == 0 || channels == 0 || bits == 0) return null;
  return (fileLength - 44) / (rate * channels * bits / 8);
}
