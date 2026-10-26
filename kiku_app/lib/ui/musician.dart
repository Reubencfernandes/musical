import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// The orange dot-matrix musician from the web app's processing screen: fixed
/// dot positions whose radii change smoothly. It is always the saxophonist, as
/// on the web app.
class Musician extends StatefulWidget {
  const Musician({super.key, this.size = 260});
  final double size;
  @override
  State<Musician> createState() => _MusicianState();
}

class _MusicianState extends State<Musician> with SingleTickerProviderStateMixin {
  late final AnimationController _animation = AnimationController(vsync: this, duration: const Duration(milliseconds: 5700));
  static const _performer = 'saxophone';
  List<List<num>> _dots = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final raw = jsonDecode(await rootBundle.loadString('assets/performers/$_performer.json')) as List;
    if (mounted) setState(() => _dots = raw.map((dot) => List<num>.from(dot as List)).toList());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduced || !TickerMode.valuesOf(context).enabled) {
      _animation.stop();
      if (reduced) _animation.value = 0;
    } else if (!_animation.isAnimating) {
      _animation.repeat();
    }
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'A musician playing $_performer',
    child: RepaintBoundary(
      child: SizedBox.square(
        dimension: widget.size,
        child: CustomPaint(painter: _Dots(_dots, _animation, Theme.of(context).colorScheme.primary)),
      ),
    ),
  );
}

class _Dots extends CustomPainter {
  _Dots(this.dots, this.animation, this.color) : super(repaint: animation);
  final List<List<num>> dots;
  final Animation<double> animation;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color, position = animation.value * 16;
    final index = position.floor(), t = position - index;
    for (final dot in dots) {
      double at(int i) => dot[2 + (i % 16)].toDouble() / 255;
      final p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2);
      // Catmull-Rom between the sixteen recorded radii.
      final value = (.5 *
              (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
          .clamp(0.0, 1.0);
      if (value > .01) {
        canvas.drawCircle(Offset(dot[0] * size.width / 512, dot[1] * size.height / 512), 3.3 * size.width / 512 * sqrt(value), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_Dots old) => old.dots != dots || old.color != color;
}
