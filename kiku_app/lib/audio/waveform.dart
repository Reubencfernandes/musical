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

/// The loudest peak covered by a visual bar, using normalized buffer positions.
/// Sampling just one bucket skips short attacks when the timeline is zoomed out.
double peakInRange(Float32List outline, double start, double end) {
  if (outline.isEmpty || !start.isFinite || !end.isFinite || end <= start || end <= 0 || start >= 1) return 0;
  final from = (start.clamp(0.0, 1.0) * outline.length).floor();
  final to = (end.clamp(0.0, 1.0) * outline.length).ceil().clamp(from + 1, outline.length);
  var peak = 0.0;
  for (var i = from; i < to; i++) {
    if (outline[i] > peak) peak = outline[i].toDouble();
  }
  return peak.clamp(0.0, 1.0);
}
