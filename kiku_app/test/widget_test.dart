import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiku_ai/score/sheet_view.dart';
import 'package:kiku_ai/ui/logo.dart';
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
