import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'logo_pixels.g.dart';

/// The Kiku AI mark: a pixel K on the orange tile. branding/generate.py draws
/// the same K for every icon. Like the web app's mark, its pixels drop in when
/// it appears and a wave runs through them every few seconds; both stay still
/// when the system asks for less motion.
class KikuMark extends StatefulWidget {
  const KikuMark({super.key, this.size = 28, this.tile = true});
  final double size;

  /// Without the tile, just the pixels in the theme's accent colour.
  final bool tile;

  @override
  State<KikuMark> createState() => _KikuMarkState();
}

class _KikuMarkState extends State<KikuMark> with TickerProviderStateMixin {
  // The last pixel starts (5 + 6) × 35 ms in and takes 550 ms.
  late final _intro = AnimationController(vsync: this, duration: const Duration(milliseconds: 950));
  // The last pixel starts 5 × 90 + 6 × 25 ms in and takes 700 ms.
  late final _wave = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300));
  Timer? _every;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _every?.cancel();
      _every = null;
      _intro.value = 1;
      _wave.value = 0;
    } else if (_every == null) {
      _intro.forward();
      // The controller only runs while a wave passes, not between waves.
      _every = Timer.periodic(const Duration(seconds: 5), (_) => _wave.forward(from: 0));
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
    child: SizedBox.square(
      dimension: widget.size,
      child: CustomPaint(painter: _MarkPainter(widget.tile, Theme.of(context).colorScheme.primary, _intro, _wave)),
    ),
  );
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.tile, this.color, this.intro, this.wave) : super(repaint: Listenable.merge([intro, wave]));
  final bool tile;
  final Color color;
  final Animation<double> intro, wave;

  // On a 100-unit tile, as in the web app's mark.
  static const _pitch = 10.0, _pixel = 9.0;
  static const _left = 50 - ((kikuCols - 1) * _pitch + _pixel) / 2;
  static const _top = 50 - ((kikuRows - 1) * _pitch + _pixel) / 2;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width, unit = s / 100;
    if (tile) {
      final rect = Offset.zero & size;
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, Radius.circular(s * 0.235)),
        Paint()
          ..shader = const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFFF8540), Color(0xFFF2541C)],
          ).createShader(rect),
      );
    }
    final ink = tile ? const Color(0xFFFFF5EC) : color;
    final introMs = intro.value * 950, waveMs = wave.isAnimating ? wave.value * 1300 : -1.0;
    for (final cell in kikuCells) {
      final x = cell[0], y = cell[1];
      // Dropping in: from above, small and clear, overshooting a little as it lands.
      final t = ((introMs - (x + y) * 35) / 550).clamp(0.0, 1.0);
      final landed = Curves.easeOutBack.transform(t);
      // The wave: shrink and fade for 300 ms, then recover over 400 ms.
      final local = waveMs - (x * 90 + y * 25);
      final dip = local < 0 ? 0.0 : local < 300 ? Curves.easeInOut.transform(local / 300) : local < 700 ? 1 - Curves.easeInOut.transform((local - 300) / 400) : 0.0;
      final scale = (0.3 + 0.7 * landed) * (1 - 0.4 * dip);
      final opacity = (t * (1 - 0.65 * dip)).clamp(0.0, 1.0);
      if (opacity <= 0) continue;
      final side = _pixel * unit * math.max(0, scale);
      final cx = (_left + x * _pitch + _pixel / 2) * unit;
      final cy = (_top + y * _pitch + _pixel / 2 - 22 * (1 - landed)) * unit;
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromCenter(center: Offset(cx, cy), width: side, height: side), Radius.circular(1.2 * unit * scale)),
        Paint()..color = ink.withValues(alpha: ink.a * opacity),
      );
    }
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.tile != tile || old.color != color;
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
        style: TextStyle(fontFamily: 'Bespoke Stencil', fontWeight: FontWeight.w700, fontSize: size * 0.82, letterSpacing: -0.6),
      ),
    ],
  );
}
