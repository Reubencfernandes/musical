import 'dart:typed_data';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

/// Lays engraved staff systems (one SVG each) out on A4 pages. Systems are
/// never split, so a page break always falls between lines of music.
Future<Uint8List> buildScorePdf(String title, List<String> systems) {
  if (systems.isEmpty) throw StateError('This score has no music to print.');
  // The built-in PDF fonts cover Latin-1 only; anything else would not draw.
  final printable = title
      .replaceAll(RegExp(r'[^\x20-\x7E\xA0-\xFF]'), '')
      .trim();
  final heading = printable.isEmpty ? 'Score' : printable;
  final document = pw.Document(title: heading, creator: 'Score Studio');
  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(36, 40, 36, 36),
      header: (context) => context.pageNumber == 1
          ? pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 14),
              child: pw.Text(
                heading,
                style: pw.TextStyle(
                  fontSize: 18,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            )
          : pw.SizedBox(),
      footer: (context) => pw.Align(
        alignment: pw.Alignment.centerRight,
        child: pw.Text(
          '${context.pageNumber} / ${context.pagesCount}',
          style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700),
        ),
      ),
      build: (_) => [
        for (final system in systems.map(_latin))
          pw.Padding(
            padding: const pw.EdgeInsets.only(bottom: 8),
            child: pw.SvgImage(svg: system, fit: pw.BoxFit.contain),
          ),
      ],
    ),
  );
  return document.save();
}

/// Chord names use music glyphs ("A♯") that the built-in fonts cannot encode.
String _latin(String svg) => svg
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .replaceAll('♮', '')
    .replaceAll(RegExp(r'[^\x00-\xFF]'), '');
