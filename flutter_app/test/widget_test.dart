import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/main.dart';
import 'package:score_studio/studio_screen.dart';

void main() {
  testWidgets('Home follows the device theme and fits a small screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await tester.pumpWidget(const ScoreStudioApp());
    expect(find.text('Score Studio'), findsOneWidget);
    expect(find.text('Create music'), findsOneWidget);
    expect(find.text('Transcribe'), findsOneWidget);
    expect(
      Theme.of(tester.element(find.byType(Scaffold))).brightness,
      Brightness.dark,
    );
    expect(tester.takeException(), isNull);
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    await tester.pumpAndSettle();
    expect(
      Theme.of(tester.element(find.byType(Scaffold))).brightness,
      Brightness.light,
    );
  });
  test('Errors show a plain sentence and keep diagnostics separate', () {
    const raw =
        'Bad state: YouTube blocks app downloads for this video. '
        'Details: IOS (stream lookup): returned 403';
    expect(errorSummary(raw), 'YouTube blocks app downloads for this video.');
    expect(errorDetails(raw), 'IOS (stream lookup): returned 403');
    expect(
      errorSummary('Choose a recording first.'),
      'Choose a recording first.',
    );
    expect(errorDetails('Choose a recording first.'), '');
  });
}
