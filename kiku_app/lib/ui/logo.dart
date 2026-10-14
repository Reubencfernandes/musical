import 'package:flutter/material.dart';

import 'logo_dots.g.dart';

/// The Kiku AI mark: a chrysanthemum of dots (kiku, 菊) that swirls like sound
/// (kiku, 聞く, to listen) on an orange tile. branding/generate.py draws the
/// same mark for every icon; small sizes use its simpler two-ring version.
class KikuMark extends StatelessWidget {
  const KikuMark({super.key, this.size = 28, this.tile = true});
  final double size;

  /// Without the tile, just the dots in the theme's accent colour.
  final bool tile;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Kiku AI',
    image: true,
    child: SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _MarkPainter(size <= 32 ? kikuSmallDots : kikuLargeDots, tile, Theme.of(context).colorScheme.primary)),
    ),
  );
}

class _MarkPainter extends CustomPainter {
  const _MarkPainter(this.dots, this.tile, this.color);
  final List<List<double>> dots;
  final bool tile;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width;
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
    final paint = Paint()..color = tile ? const Color(0xFFFFF5EC) : color;
    for (final d in dots) {
      canvas.drawCircle(Offset(s / 2 + d[0] * s, s / 2 + d[1] * s), d[2] * s, paint);
    }
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.tile != tile || old.color != color || old.dots != dots;
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
