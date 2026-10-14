import 'dart:math' as math;
import 'dart:typed_data';

/// Every buffer in a project runs at this rate, so clips mix sample for sample.
const int projectRate = 44100;

/// Audio held as 16-bit samples, interleaved when stereo.
///
/// Buffers never change once made: an edit makes a new one, as in the web
/// studio, so a project can point several clips at the same buffer.
class Pcm {
  Pcm(this.samples, this.channels, this.rate)
    : assert(channels == 1 || channels == 2),
      assert(samples.length % channels == 0);

  /// Silence of the given length.
  factory Pcm.silent(double seconds, {int channels = 2, int rate = projectRate}) =>
      Pcm(Int16List((seconds * rate).round() * channels), channels, rate);

  final Int16List samples;
  final int channels;
  final int rate;

  int get frames => samples.length ~/ channels;
  double get duration => frames / rate;

  /// The sample at a frame on a channel, as -1..1. Mono answers for both channels.
  double at(int frame, int channel) =>
      samples[frame * channels + (channels == 2 ? channel : 0)] / 32768;

  /// The stretch from [start] to [end] seconds, clamped to the buffer.
  Pcm slice(double start, double end) {
    final from = (start * rate).round().clamp(0, frames);
    final to = (end * rate).round().clamp(from, frames);
    return Pcm(
      Int16List.fromList(samples.sublist(from * channels, to * channels)),
      channels,
      rate,
    );
  }

  /// This audio at another rate, by linear interpolation.
  Pcm resampled(int to) {
    if (to == rate || frames == 0) return this;
    final count = math.max(1, (frames * to / rate).round());
    final out = Int16List(count * channels), step = rate / to;
    for (int i = 0; i < count; i++) {
      final position = i * step, index = position.floor(), t = position - index;
      final next = math.min(index + 1, frames - 1), base = math.min(index, frames - 1);
      for (int c = 0; c < channels; c++) {
        final a = samples[base * channels + c], b = samples[next * channels + c];
        out[i * channels + c] = (a + (b - a) * t).round();
      }
    }
    return Pcm(out, channels, to);
  }

  /// This audio at the project rate.
  Pcm toProject() => resampled(projectRate);

  /// One channel, the average of both when stereo.
  Pcm mono() {
    if (channels == 1) return this;
    final out = Int16List(frames);
    for (int i = 0; i < out.length; i++) {
      out[i] = (samples[i * 2] + samples[i * 2 + 1]) >> 1;
    }
    return Pcm(out, 1, rate);
  }

  /// Two channels, copying mono into both.
  Pcm stereo() {
    if (channels == 2) return this;
    final out = Int16List(frames * 2);
    for (int i = 0; i < frames; i++) {
      out[i * 2] = out[i * 2 + 1] = samples[i];
    }
    return Pcm(out, 2, rate);
  }

  /// [head] followed by [tail] from [at] seconds, crossfading over [fade] seconds.
  static Pcm splice(Pcm head, double at, Pcm tail, double fade) {
    assert(head.rate == tail.rate);
    final a = head.stereo(), b = tail.stereo(), rate = head.rate;
    final join = (at * rate).round().clamp(0, a.frames);
    final overlap = math.min((fade * rate).round(), math.min(a.frames - join, b.frames));
    final total = join + b.frames;
    final out = Int16List(total * 2);
    out.setRange(0, join * 2, a.samples);
    for (int i = 0; i < b.frames; i++) {
      for (int c = 0; c < 2; c++) {
        final incoming = b.samples[i * 2 + c];
        if (i < overlap) {
          final t = (i + 0.5) / overlap;
          final outgoing = a.samples[(join + i) * 2 + c];
          out[(join + i) * 2 + c] = (outgoing * math.cos(t * math.pi / 2) + incoming * math.sin(t * math.pi / 2))
              .round()
              .clamp(-32768, 32767);
        } else {
          out[(join + i) * 2 + c] = incoming;
        }
      }
    }
    return Pcm(out, 2, rate);
  }
}

/// Converts a float -1..1 to a 16-bit sample.
int toSample(double value) => (value * 32767).round().clamp(-32768, 32767);
