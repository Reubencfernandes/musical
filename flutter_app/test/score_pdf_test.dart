import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:score_studio/score/score_pdf.dart';

void main() {
  final system = File('test/fixtures/system.svg').readAsStringSync();

  test('Engraved systems become a multi-page PDF', () async {
    final bytes = await buildScorePdf(
      'My recording · 0:42',
      List.filled(14, system),
    );
    expect(ascii.decode(bytes.sublist(0, 5)), '%PDF-');
    final pages = RegExp(r'/Type\s*/Page[^s]').allMatches(latin1.decode(bytes));
    expect(pages.length, greaterThan(1));
    final out = Platform.environment['SCORE_PDF_OUT'];
    if (out != null) File(out).writeAsBytesSync(bytes);
  });

  test(
    'Titles the PDF fonts cannot draw fall back instead of failing',
    () async {
      final bytes = await buildScorePdf('凛として時雨', [system]);
      expect(ascii.decode(bytes.sublist(0, 5)), '%PDF-');
    },
  );

  test('Chord names with music glyphs still print', () async {
    final sharp = system.replaceFirst('>C7<', '>A♯m7♭5<');
    final bytes = await buildScorePdf('Song', [sharp]);
    expect(ascii.decode(bytes.sublist(0, 5)), '%PDF-');
  });

  test('An empty score is reported, not printed', () {
    expect(() => buildScorePdf('x', []), throwsStateError);
  });
}
