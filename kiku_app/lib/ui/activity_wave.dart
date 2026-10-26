import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A quiet, looping dot-matrix wave for work in progress. It is decorative:
/// recorded audio is always drawn from the real sample peaks in the studio.
class ActivityWave extends StatefulWidget {
  const ActivityWave({super.key, this.width = 48, this.height = 28, this.color});

  final double width, height;
  final Color? color;

  @override
  State<ActivityWave> createState() => _ActivityWaveState();
}

class _ActivityWaveState extends State<ActivityWave> with SingleTickerProviderStateMixin {
  late final _phase = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!TickerMode.valuesOf(context).enabled || (MediaQuery.maybeDisableAnimationsOf(context) ?? false)) {
      _phase.stop();
      if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) _phase.value = 0;
    } else if (!_phase.isAnimating) {
      _phase.repeat();
    }
  }

  @override
  void dispose() {
    _phase.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: RepaintBoundary(
      child: SizedBox(
        width: widget.width,
        height: widget.height,
        child: CustomPaint(painter: _ActivityPainter(_phase, widget.color ?? Theme.of(context).colorScheme.primary)),
      ),
    ),
  );
}

class _ActivityPainter extends CustomPainter {
  _ActivityPainter(this.phase, this.color) : super(repaint: phase);
  final Animation<double> phase;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const columns = 13, rows = 9;
    final pitch = math.min(size.width / columns, size.height / rows);
    final dot = pitch * .64;
    final left = (size.width - pitch * (columns - 1)) / 2;
    final time = phase.value * math.pi * 2;
    final paint = Paint();
    for (var column = 0; column < columns; column++) {
      final x = column / (columns - 1);
      final envelope = math.pow(math.sin(x * math.pi), .65).toDouble();
      final rhythm = .5 + .32 * math.sin(time - x * math.pi * 2) + .18 * math.sin(time * 2 + x * math.pi * 3);
      final height = .8 + envelope * (1.1 + 2.2 * rhythm);
      for (var row = -4; row <= 4; row++) {
        final opacity = (height - row.abs() + .5).clamp(0.0, 1.0);
        if (opacity <= 0) continue;
        paint.color = color.withValues(alpha: color.a * opacity * (row < 0 ? 1 : .8));
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset(left + column * pitch, size.height / 2 + row * pitch), width: dot, height: dot),
            Radius.circular(dot * .22),
          ),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_ActivityPainter old) => old.color != color || old.phase != phase;
}
