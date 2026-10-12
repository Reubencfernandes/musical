import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class Musician extends StatefulWidget {
  const Musician({super.key});
  @override
  State<Musician> createState() => _MusicianState();
}

class _MusicianState extends State<Musician>
    with SingleTickerProviderStateMixin {
  late final AnimationController animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 5700),
  );
  late final String performer = [
    'saxophone',
    'guitar',
    'piano',
    'drums',
  ][Random().nextInt(4)];
  List<List<num>> dots = [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final raw =
        jsonDecode(
              await rootBundle.loadString('assets/performers/$performer.json'),
            )
            as List;
    if (mounted) {
      setState(() => dots = raw.map((dot) => List<num>.from(dot)).toList());
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      animation.stop();
    } else {
      animation.repeat();
    }
  }

  @override
  void dispose() {
    animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'A musician playing $performer',
    child: RepaintBoundary(
      child: SizedBox.square(
        dimension: 280,
        child: CustomPaint(painter: _Dots(dots, animation)),
      ),
    ),
  );
}

class _Dots extends CustomPainter {
  final List<List<num>> dots;
  final Animation<double> animation;
  _Dots(this.dots, this.animation) : super(repaint: animation);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xFFFF5526),
        position = animation.value * 16;
    final index = position.floor(), t = position - index;
    for (final dot in dots) {
      double at(int i) => dot[2 + (i % 16)].toDouble() / 255;
      final p0 = at(index - 1),
          p1 = at(index),
          p2 = at(index + 1),
          p3 = at(index + 2);
      final value =
          (.5 *
                  (2 * p1 +
                      (-p0 + p2) * t +
                      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
              .clamp(0.0, 1.0);
      if (value > .01) {
        canvas.drawCircle(
          Offset(dot[0] * size.width / 512, dot[1] * size.height / 512),
          3.3 * size.width / 512 * sqrt(value),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_Dots old) => old.dots != dots;
}
