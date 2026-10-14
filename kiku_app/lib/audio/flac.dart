import 'dart:typed_data';

import 'pcm.dart';

/// FLAC in pure Dart: YuE2 returns FLAC, and songs are kept as FLAC in the
/// user's library because the app has no MP3 encoder. Browsers play FLAC, so
/// the web app opens them too.

bool isFlac(Uint8List bytes) => _flacStart(bytes) >= 0;

/// Where the "fLaC" marker starts, after an ID3v2 tag if there is one.
int _flacStart(Uint8List bytes) {
  int at = 0;
  if (bytes.length >= 10 && bytes[0] == 0x49 && bytes[1] == 0x44 && bytes[2] == 0x33) {
    final size = (bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f);
    at = 10 + size + ((bytes[5] & 0x10) != 0 ? 10 : 0);
  }
  return bytes.length >= at + 4 &&
          bytes[at] == 0x66 &&
          bytes[at + 1] == 0x4c &&
          bytes[at + 2] == 0x61 &&
          bytes[at + 3] == 0x43
      ? at
      : -1;
}

class _Reader {
  _Reader(this.bytes, this.pos);
  final Uint8List bytes;
  int pos, bit = 0;

  int read(int count) {
    int value = 0;
    while (count > 0) {
      if (pos >= bytes.length) throw const FormatException('This FLAC file is cut short.');
      final available = 8 - bit, take = count < available ? count : available;
      value = (value << take) | ((bytes[pos] >> (available - take)) & ((1 << take) - 1));
      count -= take;
      bit += take;
      if (bit == 8) {
        bit = 0;
        pos++;
      }
    }
    return value;
  }

  int signed(int count) {
    if (count == 0) return 0;
    final value = read(count);
    return (value & (1 << (count - 1))) != 0 ? value - (1 << count) : value;
  }

  /// Zeros before the next one bit.
  int unary() {
    int count = 0;
    for (;;) {
      if (pos >= bytes.length) throw const FormatException('This FLAC file is cut short.');
      int byte = (bytes[pos] << bit) & 0xff;
      if (byte == 0) {
        count += 8 - bit;
        bit = 0;
        pos++;
        continue;
      }
      int zeros = 0;
      while ((byte & 0x80) == 0) {
        zeros++;
        byte <<= 1;
      }
      count += zeros;
      bit += zeros + 1;
      if (bit == 8) {
        bit = 0;
        pos++;
      }
      return count;
    }
  }

  void align() {
    if (bit != 0) {
      bit = 0;
      pos++;
    }
  }
}

const _rates = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const _sizes = [0, 8, 12, 0, 16, 20, 24, 32];

/// Decodes a FLAC file into 16-bit audio. More than two channels are folded into stereo.
Pcm decodeFlac(Uint8List bytes) {
  final start = _flacStart(bytes);
  if (start < 0) throw const FormatException('This is not a FLAC file.');
  final d = ByteData.sublistView(bytes);
  int at = start + 4, rate = 0, channels = 0, depth = 0;
  for (bool last = false; !last;) {
    if (at + 4 > bytes.length) throw const FormatException('This FLAC file is cut short.');
    last = (bytes[at] & 0x80) != 0;
    final type = bytes[at] & 0x7f, length = bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3];
    if (type == 0 && at + 4 + 18 <= bytes.length) {
      final info = at + 4;
      rate = d.getUint32(info + 10) >> 12;
      channels = ((bytes[info + 12] >> 1) & 7) + 1;
      depth = ((bytes[info + 12] & 1) << 4 | bytes[info + 13] >> 4) + 1;
    }
    at += 4 + length;
  }
  if (rate == 0 || channels == 0) throw const FormatException('This FLAC file has no stream information.');
  final chunks = <Int16List>[];
  final reader = _Reader(bytes, at);
  while (reader.pos + 2 <= bytes.length) {
    reader.align();
    if (reader.pos + 2 > bytes.length || bytes[reader.pos] != 0xff || (bytes[reader.pos + 1] & 0xfe) != 0xf8) break;
    chunks.add(_frame(reader, rate, channels, depth));
  }
  final outChannels = channels == 1 ? 1 : 2;
  final total = chunks.fold<int>(0, (sum, c) => sum + c.length);
  final samples = Int16List(total);
  int offset = 0;
  for (final chunk in chunks) {
    samples.setAll(offset, chunk);
    offset += chunk.length;
  }
  return Pcm(samples, outChannels, rate);
}

/// One frame, as interleaved 16-bit samples (mono, or stereo for two or more channels).
Int16List _frame(_Reader r, int streamRate, int streamChannels, int streamDepth) {
  r.read(16); // sync and blocking strategy
  final sizeCode = r.read(4), rateCode = r.read(4), channelCode = r.read(4), depthCode = r.read(3);
  r.read(1);
  // The frame or sample number, UTF-8 style.
  final first = r.read(8);
  int more = 0;
  for (int mask = 0x80; mask > 0 && (first & mask) != 0; mask >>= 1) {
    more++;
  }
  for (int i = 1; i < more; i++) {
    r.read(8);
  }
  final int blockSize;
  if (sizeCode == 1) {
    blockSize = 192;
  } else if (sizeCode >= 2 && sizeCode <= 5) {
    blockSize = 576 << (sizeCode - 2);
  } else if (sizeCode == 6) {
    blockSize = r.read(8) + 1;
  } else if (sizeCode == 7) {
    blockSize = r.read(16) + 1;
  } else if (sizeCode >= 8) {
    blockSize = 256 << (sizeCode - 8);
  } else {
    throw const FormatException('This FLAC file uses a reserved block size.');
  }
  if (rateCode == 12) {
    r.read(8);
  } else if (rateCode == 13 || rateCode == 14) {
    r.read(16);
  }
  final depth = depthCode == 0 ? streamDepth : _sizes[depthCode];
  if (depth == 0) throw const FormatException('This FLAC file uses a reserved sample size.');
  r.read(8); // CRC-8
  final channels = channelCode < 8 ? channelCode + 1 : 2;
  final decoded = List<Int32List>.generate(channels, (c) {
    final side = (channelCode == 8 && c == 1) || (channelCode == 9 && c == 0) || (channelCode == 10 && c == 1);
    return _subframe(r, blockSize, depth + (side ? 1 : 0));
  });
  r.align();
  r.read(16); // CRC-16
  if (channelCode == 8) {
    for (int i = 0; i < blockSize; i++) {
      decoded[1][i] = decoded[0][i] - decoded[1][i];
    }
  } else if (channelCode == 9) {
    for (int i = 0; i < blockSize; i++) {
      decoded[0][i] += decoded[1][i];
    }
  } else if (channelCode == 10) {
    for (int i = 0; i < blockSize; i++) {
      final side = decoded[1][i], mid = (decoded[0][i] << 1) | (side & 1);
      decoded[0][i] = (mid + side) >> 1;
      decoded[1][i] = (mid - side) >> 1;
    }
  }
  int scale(int v) => depth > 16 ? v >> (depth - 16) : v << (16 - depth);
  if (channels == 1) {
    final out = Int16List(blockSize);
    for (int i = 0; i < blockSize; i++) {
      out[i] = scale(decoded[0][i]).clamp(-32768, 32767);
    }
    return out;
  }
  final out = Int16List(blockSize * 2);
  for (int i = 0; i < blockSize; i++) {
    if (channels == 2) {
      out[i * 2] = scale(decoded[0][i]).clamp(-32768, 32767);
      out[i * 2 + 1] = scale(decoded[1][i]).clamp(-32768, 32767);
    } else {
      int left = 0, right = 0;
      for (int c = 0; c < channels; c++) {
        if (c.isEven) {
          left += decoded[c][i];
        } else {
          right += decoded[c][i];
        }
      }
      out[i * 2] = scale(left ~/ ((channels + 1) ~/ 2)).clamp(-32768, 32767);
      out[i * 2 + 1] = scale(right ~/ (channels ~/ 2)).clamp(-32768, 32767);
    }
  }
  return out;
}

Int32List _subframe(_Reader r, int count, int depth) {
  r.read(1);
  final type = r.read(6);
  int wasted = 0;
  if (r.read(1) == 1) wasted = r.unary() + 1;
  final bits = depth - wasted;
  final s = Int32List(count);
  if (type == 0) {
    final value = r.signed(bits);
    for (int i = 0; i < count; i++) {
      s[i] = value;
    }
  } else if (type == 1) {
    for (int i = 0; i < count; i++) {
      s[i] = r.signed(bits);
    }
  } else if (type >= 8 && type <= 12) {
    final order = type & 7;
    for (int i = 0; i < order; i++) {
      s[i] = r.signed(bits);
    }
    _residual(r, s, order);
    for (int i = order; i < count; i++) {
      switch (order) {
        case 1:
          s[i] += s[i - 1];
        case 2:
          s[i] += 2 * s[i - 1] - s[i - 2];
        case 3:
          s[i] += 3 * s[i - 1] - 3 * s[i - 2] + s[i - 3];
        case 4:
          s[i] += 4 * s[i - 1] - 6 * s[i - 2] + 4 * s[i - 3] - s[i - 4];
      }
    }
  } else if (type >= 32) {
    final order = (type & 31) + 1;
    for (int i = 0; i < order; i++) {
      s[i] = r.signed(bits);
    }
    final precision = r.read(4) + 1;
    if (precision == 16) throw const FormatException('This FLAC file has an invalid predictor.');
    final shift = r.signed(5);
    final coefs = List<int>.generate(order, (_) => r.signed(precision));
    _residual(r, s, order);
    for (int i = order; i < count; i++) {
      int sum = 0;
      for (int j = 0; j < order; j++) {
        sum += coefs[j] * s[i - 1 - j];
      }
      s[i] += shift >= 0 ? sum >> shift : sum << -shift;
    }
  } else {
    throw const FormatException('This FLAC file uses a reserved subframe type.');
  }
  if (wasted > 0) {
    for (int i = 0; i < count; i++) {
      s[i] <<= wasted;
    }
  }
  return s;
}

/// Reads the Rice-coded residual into [s] after its warm-up samples.
void _residual(_Reader r, Int32List s, int order) {
  final method = r.read(2);
  if (method > 1) throw const FormatException('This FLAC file uses a reserved residual coding.');
  final paramBits = method == 0 ? 4 : 5, escape = method == 0 ? 15 : 31;
  final partitionOrder = r.read(4), partitions = 1 << partitionOrder;
  final size = s.length >> partitionOrder;
  int i = order;
  for (int p = 0; p < partitions; p++) {
    final count = p == 0 ? size - order : size;
    final param = r.read(paramBits);
    if (param == escape) {
      final width = r.read(5);
      for (int k = 0; k < count; k++) {
        s[i++] = r.signed(width);
      }
    } else {
      for (int k = 0; k < count; k++) {
        final u = (r.unary() << param) | r.read(param);
        s[i++] = (u >> 1) ^ -(u & 1);
      }
    }
  }
}

// ----------------------------------------------------------------- encoder

class _Writer {
  Uint8List _bytes = Uint8List(1 << 16);
  int length = 0, _acc = 0, _bits = 0;

  void _push(int byte) {
    if (length == _bytes.length) {
      final grown = Uint8List(_bytes.length * 2)..setAll(0, _bytes);
      _bytes = grown;
    }
    _bytes[length++] = byte;
  }

  /// Writes the low [count] bits of [value], most significant first (count <= 32).
  void write(int value, int count) {
    for (int left = count; left > 0;) {
      final take = left > 8 ? 8 : left;
      left -= take;
      _acc = (_acc << take) | ((value >> left) & ((1 << take) - 1));
      _bits += take;
      if (_bits >= 8) {
        _bits -= 8;
        _push((_acc >> _bits) & 0xff);
        _acc &= (1 << _bits) - 1;
      }
    }
  }

  void zeros(int count) {
    while (count > 0) {
      final take = count > 24 ? 24 : count;
      write(0, take);
      count -= take;
    }
  }

  void align() {
    if (_bits > 0) write(0, 8 - _bits);
  }

  Uint8List view(int from) => Uint8List.sublistView(_bytes, from, length);
  Uint8List take() => Uint8List.fromList(Uint8List.sublistView(_bytes, 0, length));
}

final _crc8 = List<int>.generate(256, (i) {
  int c = i;
  for (int k = 0; k < 8; k++) {
    c = (c & 0x80) != 0 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
});
final _crc16 = List<int>.generate(256, (i) {
  int c = i << 8;
  for (int k = 0; k < 8; k++) {
    c = (c & 0x8000) != 0 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
});

int _crc8Of(Uint8List bytes) {
  int c = 0;
  for (final b in bytes) {
    c = _crc8[c ^ b];
  }
  return c;
}

int _crc16Of(Uint8List bytes) {
  int c = 0;
  for (final b in bytes) {
    c = ((c << 8) & 0xffff) ^ _crc16[(c >> 8) ^ b];
  }
  return c;
}

const _block = 4096;

/// Encodes 16-bit audio as FLAC with fixed predictors, choosing mid/side for
/// stereo blocks when it is smaller. Roughly halves the size of a WAV.
Uint8List encodeFlac(Pcm pcm) {
  final w = _Writer();
  final frames = pcm.frames, channels = pcm.channels;
  final blockMax = frames < _block ? (frames == 0 ? 16 : frames) : _block;
  w.write(0x664c6143, 32); // fLaC
  // STREAMINFO, the only and so the last metadata block.
  w.write(0x80, 8);
  w.write(34, 24);
  w.write(blockMax < 16 ? 16 : blockMax, 16);
  w.write(blockMax < 16 ? 16 : blockMax, 16);
  w.write(0, 24);
  w.write(0, 24);
  w.write(pcm.rate, 20);
  w.write(channels - 1, 3);
  w.write(15, 5);
  w.write((frames >> 32) & 0xf, 4);
  w.write(frames & 0xffffffff, 32);
  for (int i = 0; i < 4; i++) {
    w.write(0, 32); // MD5 left unset, which the format allows
  }
  final rateCode = const {8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11}[pcm.rate] ?? 0;
  final left = Int32List(_block), right = Int32List(_block), mid = Int32List(_block), side = Int32List(_block);
  int index = 0;
  for (int first = 0; first < frames; first += _block, index++) {
    final n = frames - first < _block ? frames - first : _block;
    for (int i = 0; i < n; i++) {
      final base = (first + i) * channels;
      left[i] = pcm.samples[base];
      if (channels == 2) {
        right[i] = pcm.samples[base + 1];
        mid[i] = (left[i] + right[i]) >> 1;
        side[i] = left[i] - right[i];
      }
    }
    final start = w.length;
    w.write(0xfff8, 16);
    w.write(n == _block ? 12 : 7, 4);
    w.write(rateCode, 4);
    int assignment = channels - 1;
    List<(Int32List, int)> subframes;
    if (channels == 2) {
      final l = _cost(left, n, 16), r = _cost(right, n, 16), m = _cost(mid, n, 16), s = _cost(side, n, 17);
      final options = {1: l + r, 8: l + s, 9: r + s, 10: m + s};
      assignment = options.entries.reduce((a, b) => b.value < a.value ? b : a).key;
      subframes = switch (assignment) {
        8 => [(left, 16), (side, 17)],
        9 => [(side, 17), (right, 16)],
        10 => [(mid, 16), (side, 17)],
        _ => [(left, 16), (right, 16)],
      };
    } else {
      subframes = [(left, 16)];
    }
    w.write(assignment, 4);
    w.write(4, 3); // 16 bits per sample
    w.write(0, 1);
    _utf8(w, index);
    if (n != _block) w.write(n - 1, 16);
    w.write(_crc8Of(w.view(start)), 8);
    for (final (samples, depth) in subframes) {
      _encodeSubframe(w, samples, n, depth);
    }
    w.align();
    w.write(_crc16Of(w.view(start)), 16);
  }
  return w.take();
}

void _utf8(_Writer w, int value) {
  if (value < 0x80) {
    w.write(value, 8);
    return;
  }
  int bytes = 2;
  while (value >= (1 << (5 * bytes + 1))) {
    bytes++;
  }
  w.write(((0xff00 >> bytes) & 0xff) | (value >> (6 * (bytes - 1))), 8);
  for (int i = bytes - 2; i >= 0; i--) {
    w.write(0x80 | ((value >> (6 * i)) & 0x3f), 8);
  }
}

int _residualAt(Int32List s, int i, int order) => switch (order) {
  0 => s[i],
  1 => s[i] - s[i - 1],
  2 => s[i] - 2 * s[i - 1] + s[i - 2],
  3 => s[i] - 3 * s[i - 1] + 3 * s[i - 2] - s[i - 3],
  _ => s[i] - 4 * s[i - 1] + 6 * s[i - 2] - 4 * s[i - 3] + s[i - 4],
};

/// The best fixed order and its estimated size in bits.
(int, int) _bestOrder(Int32List s, int n) {
  int best = 0, bestSum = -1;
  for (int order = 0; order <= 4 && order < n; order++) {
    int sum = 0;
    for (int i = order; i < n; i++) {
      sum += _residualAt(s, i, order).abs();
    }
    if (bestSum < 0 || sum < bestSum) {
      best = order;
      bestSum = sum;
    }
  }
  final mean = n > best ? bestSum / (n - best) : 0;
  final k = _riceParam(mean);
  return (best, (n - best) * (k + 1) + (bestSum >> k) * 2);
}

int _cost(Int32List s, int n, int depth) => _bestOrder(s, n).$2 + 4 * depth;

int _riceParam(num mean) {
  int k = 0;
  while (k < 14 && (1 << (k + 1)) <= mean) {
    k++;
  }
  return k;
}

void _encodeSubframe(_Writer w, Int32List s, int n, int depth) {
  bool constant = true;
  for (int i = 1; i < n && constant; i++) {
    constant = s[i] == s[0];
  }
  if (constant) {
    w.write(0, 1);
    w.write(0, 6);
    w.write(0, 1);
    w.write(s[0], depth);
    return;
  }
  final (order, estimate) = _bestOrder(s, n);
  if (estimate >= n * depth) {
    w.write(0, 1);
    w.write(1, 6);
    w.write(0, 1);
    for (int i = 0; i < n; i++) {
      w.write(s[i], depth);
    }
    return;
  }
  w.write(0, 1);
  w.write(8 | order, 6);
  w.write(0, 1);
  for (int i = 0; i < order; i++) {
    w.write(s[i], depth);
  }
  // Rice coding, method 0 (4-bit parameters), with as many partitions as divide the block.
  int partitionOrder = 0;
  while (partitionOrder < 4 && n % (1 << (partitionOrder + 1)) == 0 && (n >> (partitionOrder + 1)) > order) {
    partitionOrder++;
  }
  w.write(0, 2);
  w.write(partitionOrder, 4);
  final size = n >> partitionOrder;
  int i = order;
  for (int p = 0; p < (1 << partitionOrder); p++) {
    final count = p == 0 ? size - order : size;
    int sum = 0;
    for (int k = 0; k < count; k++) {
      sum += _residualAt(s, i + k, order).abs();
    }
    final param = _riceParam(count > 0 ? sum / count : 0);
    w.write(param, 4);
    for (int k = 0; k < count; k++, i++) {
      final r = _residualAt(s, i, order);
      final u = r >= 0 ? r << 1 : (-r << 1) - 1;
      w.zeros(u >> param);
      w.write(1, 1);
      if (param > 0) w.write(u & ((1 << param) - 1), param);
    }
  }
}
