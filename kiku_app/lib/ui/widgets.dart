import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/errors.dart';
import 'theme.dart';

/// A song's artwork: its DreamLite cover when it has one, otherwise the same
/// gradient the web app draws from the song's id.
class SongArt extends StatelessWidget {
  const SongArt({super.key, required this.id, this.size = 56, this.cover, this.child});
  final String id;
  final double size;
  final Uint8List? cover;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    int h = 0;
    for (final c in id.codeUnits) {
      h = (h * 31 + c) & 0xffffffff;
    }
    final a = h % 360, b = (a + 40 + (h >> 9) % 80) % 360;
    final x = 20 + (h >> 4) % 60, y = 20 + (h >> 12) % 60;
    final radius = BorderRadius.circular(size * 0.2);
    return ClipRRect(
      borderRadius: radius,
      child: SizedBox.square(
        dimension: size,
        child: Stack(
          fit: StackFit.expand,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [HSLColor.fromAHSL(1, a.toDouble(), .7, .42).toColor(), HSLColor.fromAHSL(1, ((a + 300) % 360).toDouble(), .55, .18).toColor()],
                ),
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(x / 50 - 1, y / 50 - 1),
                  radius: .8,
                  colors: [HSLColor.fromAHSL(1, b.toDouble(), .85, .66).toColor(), Colors.transparent],
                ),
              ),
            ),
            if (cover != null) Image.memory(cover!, fit: BoxFit.cover, gaplessPlayback: true, errorBuilder: (_, _, _) => const SizedBox()),
            ?child,
          ],
        ),
      ),
    );
  }
}

/// A thin progress meter like the web app's song and job lanes.
class Meter extends StatelessWidget {
  const Meter({super.key, required this.value});
  final double value;
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(2),
    child: LinearProgressIndicator(value: value.clamp(0.0, 1.0), minHeight: 3),
  );
}

/// How far a job looks done, by the web app's rule: the engine's fraction when
/// it reports one, otherwise an estimate from the queue's ETA or elapsed time.
double shownProgress({required DateTime began, DateTime? running, double? fraction, DateTime? etaAt}) {
  final now = DateTime.now();
  if (running == null) return (now.difference(began).inMilliseconds / 1000 / 1200).clamp(0.0, 0.05);
  final elapsed = now.difference(running).inMilliseconds / 1000;
  final guess = etaAt != null
      ? elapsed / (elapsed + (etaAt.difference(now).inMilliseconds / 1000).clamp(1.0, double.infinity))
      : 1 - math.exp(-elapsed / 75);
  final known = fraction ?? 0.0;
  return (known > guess * 0.97 ? known : guess * 0.97).clamp(0.0, 0.97);
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message, this.onClose});
  final String message;
  final VoidCallback? onClose;
  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 10),
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(
        color: Color.alphaBlend(accent.withValues(alpha: .08), colors.panel),
        border: Border.all(color: accent.withValues(alpha: .35)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Padding(padding: const EdgeInsets.only(top: 2), child: Text(message, style: const TextStyle(fontSize: 13, height: 1.5)))),
          if (onClose != null) IconButton(visualDensity: VisualDensity.compact, onPressed: onClose, icon: const Icon(Icons.close, size: 18), tooltip: 'Dismiss'),
        ],
      ),
    );
  }
}

/// A rounded card section with an optional title.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(18)});
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: padding, child: child));
}

class EmptyNote extends StatelessWidget {
  const EmptyNote({super.key, required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: colors.muted),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: colors.muted, height: 1.5))),
        ],
      ),
    );
  }
}

/// Shows an error as a snack bar, in words people can act on.
void showError(BuildContext context, Object error) {
  if (error is Cancelled) return;
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(describe(error))));
}

void showNote(BuildContext context, String text) =>
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 3)));

/// A two-step delete: the first tap asks, the second deletes.
Future<bool> confirmDelete(BuildContext context, String what) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete $what?'),
        content: const Text('It is removed from your library on Hugging Face.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep it')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    ) ??
    false;
