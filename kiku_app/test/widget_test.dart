import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiku_ai/score/sheet_view.dart';
import 'package:kiku_ai/ui/logo.dart';
import 'package:kiku_ai/ui/activity_wave.dart';
import 'package:kiku_ai/ui/musician.dart';
import 'package:kiku_ai/ui/theme.dart';
import 'package:kiku_ai/ui/widgets.dart';

Widget _app(Widget child, {Brightness brightness = Brightness.dark}) =>
    MaterialApp(theme: kikuTheme(brightness), home: Scaffold(body: Center(child: child)));

void main() {
  testWidgets('draws the Kiku mark and wordmark in both themes', (tester) async {
    for (final brightness in Brightness.values) {
      await tester.pumpWidget(_app(const Column(mainAxisSize: MainAxisSize.min, children: [KikuMark(size: 16), KikuMark(size: 96), KikuWordmark()]), brightness: brightness));
      expect(find.text('Kiku'), findsOneWidget);
      expect(find.bySemanticsLabel('Kiku AI'), findsNWidgets(3));
    }
  });

  testWidgets('the mark drops in, waves every few seconds, and keeps still when asked', (tester) async {
    await tester.pumpWidget(_app(const KikuMark(size: 64)));
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.hasRunningAnimations, isTrue);
    await tester.pump(const Duration(seconds: 1));
    expect(tester.hasRunningAnimations, isFalse, reason: 'nothing runs between waves');
    await tester.pump(const Duration(milliseconds: 3800));
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.hasRunningAnimations, isTrue, reason: 'a wave five seconds in');
    await tester.pump(const Duration(seconds: 2));

    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tester.pumpWidget(_app(const KikuMark(key: ValueKey('still'), size: 64)));
    await tester.pump(const Duration(seconds: 6));
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('song art and banners render', (tester) async {
    var closed = false;
    await tester.pumpWidget(_app(Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SongArt(id: 'mbx2-1234abcd'),
        ErrorBanner(message: 'Something went wrong', onClose: () => closed = true),
        const Meter(value: .4),
      ],
    )));
    expect(find.text('Something went wrong'), findsOneWidget);
    await tester.tap(find.byTooltip('Dismiss'));
    expect(closed, isTrue);
  });

  testWidgets('processing motion pauses off screen and respects reduced motion', (tester) async {
    Widget preview({bool visible = true, bool reduced = false}) => _app(
      MediaQuery(
        data: MediaQueryData(disableAnimations: reduced),
        child: TickerMode(
          enabled: visible,
          child: const Column(mainAxisSize: MainAxisSize.min, children: [ActivityWave(), Musician(size: 160)]),
        ),
      ),
    );
    await tester.pumpWidget(preview());
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.hasRunningAnimations, isTrue);
    await tester.pumpWidget(preview(visible: false));
    await tester.pump(const Duration(seconds: 2));
    expect(tester.hasRunningAnimations, isFalse);
    await tester.pumpWidget(preview());
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.hasRunningAnimations, isTrue);
    await tester.pumpWidget(preview(reduced: true));
    await tester.pump(const Duration(seconds: 3));
    expect(tester.hasRunningAnimations, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows the score as ABC where no web view is available', (tester) async {
    if (canDrawScores) return; // Runs on the desktop test host, where web views are unavailable.
    await tester.pumpWidget(_app(const SizedBox(width: 400, height: 600, child: SheetView(abc: 'X:1\nK:C\nCDEF|', bar: -1))));
    expect(find.textContaining('X:1'), findsOneWidget);
  });

  test('progress estimates never go backwards past the engine’s own fraction', () {
    final began = DateTime.now().subtract(const Duration(seconds: 30));
    expect(shownProgress(began: began), lessThanOrEqualTo(.05));
    expect(shownProgress(began: began, running: began, fraction: .8), closeTo(.8, 1e-9));
    expect(shownProgress(began: began, running: began), inInclusiveRange(0, .97));
  });
}
