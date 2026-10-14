import 'dart:math' as math;
import 'dart:typed_data';

import 'pcm.dart';

/// A buffer's loudness outline: the largest absolute sample in each of
/// [buckets] equal slices, as 0..1, for drawing waveforms.
Float32List peaks(Pcm pcm, {int buckets = 1200}) {
  final count = math.max(1, math.min(buckets, pcm.frames));
  final out = Float32List(count);
  final per = pcm.frames / count;
  for (int b = 0; b < count; b++) {
    final from = (b * per).floor(), to = math.min(pcm.frames, ((b + 1) * per).ceil());
    int top = 0;
    for (int f = from; f < to; f++) {
      for (int c = 0; c < pcm.channels; c++) {
        final v = pcm.samples[f * pcm.channels + c].abs();
        if (v > top) top = v;
      }
    }
    out[b] = top / 32768;
  }
  return out;
}
