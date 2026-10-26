import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'logo_mark.g.dart';

/// A listening K: a curved receiver and two swept sound ribbons answer a signal
/// in the aperture. Its paths are shared with the web mark and launcher icons.
class KikuMark extends StatefulWidget {
  const KikuMark({super.key, this.size = 28, this.tile = false});
  final double size;

  /// Optional warm-ink tile for contexts that need an app-icon treatment.
  final bool tile;

  @override
  State<KikuMark> createState() => _KikuMarkState();
}

class _KikuMarkState extends State<KikuMark> with TickerProviderStateMixin {
  // The receiver settles first, then the two sound ribbons open.
  late final _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 950),
  );
  // A short response followed by a quiet interval; no ticker runs while idle.
  late final _wave = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  );
  Timer? _every;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _every?.cancel();
      _every = null;
      _intro.value = 1;
      _wave.value = 0;
    } else if (!TickerMode.valuesOf(context).enabled) {
      _every?.cancel();
      _every = null;
      _intro.stop();
      _wave.stop();
      _wave.value = 0;
    } else if (_every == null) {
      _intro.forward();
      // The controller only runs while a wave passes, not between waves.
      _every = Timer.periodic(
        const Duration(seconds: 5),
        (_) => _wave.forward(from: 0),
      );
    }
  }

  @override
  void dispose() {
    _every?.cancel();
    _intro.dispose();
    _wave.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Kiku AI',
    image: true,
    child: RepaintBoundary(
      child: SizedBox.square(
        dimension: widget.size,
        child: CustomPaint(painter: _MarkPainter(widget.tile, _intro, _wave)),
      ),
    ),
  );
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.tile, this.intro, this.wave)
    : super(repaint: Listenable.merge([intro, wave]));
  final bool tile;
  final Animation<double> intro, wave;

  static final _receiver = kikuReceiverPath();
  static final _upper = kikuUpperPath();
  static final _lower = kikuLowerPath();
  static const _artboard = Rect.fromLTWH(0, 0, 100, 100);
  static final _ink = const LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFFFF864A), Color(0xFFF24D24)],
  ).createShader(_artboard);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 100, size.height / 100);
    if (tile) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(_artboard, const Radius.circular(23.5)),
        Paint()
          ..shader = const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF2A231F), Color(0xFF171615)],
          ).createShader(_artboard),
      );
    }
    final introMs = intro.value * 950;
    final response = wave.isAnimating ? math.sin(wave.value * math.pi) : 0.0;

    void ribbon(
      Path path,
      double delay,
      double angle,
      double answer, {
      bool receiver = false,
    }) {
      final t = ((introMs - delay) / (receiver ? 700 : 790)).clamp(0.0, 1.0);
      final landed = Curves.easeOutCubic.transform(t);
      canvas.save();
      canvas.translate(44, 52);
      canvas.rotate((angle * (1 - landed) + answer * response) * math.pi / 180);
      if (receiver) {
        canvas.translate(-4 * (1 - landed), 0);
        canvas.scale(1.0, .9 + .1 * landed);
      }
      canvas.translate(-44, -52);
      canvas.drawPath(
        path,
        Paint()
          ..shader = _ink
          ..color = Colors.white.withValues(alpha: t),
      );
      canvas.restore();
    }

    ribbon(_receiver, 0, 0, 0, receiver: true);
    ribbon(_upper, 90, 14, -3.5);
    ribbon(_lower, 160, -12, 3);

    final pointOpacity = ((introMs - 320) / 450).clamp(0.0, 1.0);
    final pointScale = wave.isAnimating
        ? 1 - .3 * math.sin(wave.value * math.pi * 2) * (1 - wave.value)
        : 1.0;
    canvas.drawCircle(
      kikuSignal,
      kikuSignalRadius * pointScale,
      Paint()
        ..shader = _ink
        ..color = Colors.white.withValues(alpha: pointOpacity),
    );
    if (wave.isAnimating) {
      final travel = Curves.easeInOutCubic.transform(wave.value);
      canvas.drawCircle(
        kikuSignal + Offset(34 * travel, -29 * travel),
        2.2,
        Paint()
          ..color = const Color(
            0xFFFFF0D9,
          ).withValues(alpha: math.sin(wave.value * math.pi)),
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.tile != tile;
}

/// The mark with the name beside it.
class KikuWordmark extends StatelessWidget {
  const KikuWordmark({super.key, this.size = 28});
  final double size;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      KikuMark(size: size),
      SizedBox(width: size * 0.36),
      Text(
        'Kiku',
        style: TextStyle(
          fontFamily: 'Bespoke Stencil',
          fontWeight: FontWeight.w700,
          fontSize: size * 0.82,
          letterSpacing: -0.6,
        ),
      ),
    ],
  );
}
