import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'score_pdf.dart';
import 'score_server.dart';

/// Engraved notation with piano playback and a note-following cursor.
class ScorePage extends StatefulWidget {
  final String abc, title;

  /// Receives the file builder once the score is on screen (device checks).
  final void Function(Future<File> Function(String kind) build)? onReady;
  const ScorePage({
    super.key,
    required this.abc,
    required this.title,
    this.onReady,
  });

  @override
  State<ScorePage> createState() => _ScorePageState();
}

class _ScorePageState extends State<ScorePage> {
  late final WebViewController controller;
  String? failure;
  bool ready = false, exporting = false;

  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF111111))
      ..setNavigationDelegate(
        NavigationDelegate(
          // The player is self-contained; it never needs to leave loopback.
          onNavigationRequest: (request) =>
              Uri.parse(request.url).host == '127.0.0.1'
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
          onPageFinished: (_) => _show(),
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? true) {
              setState(() => failure = error.description);
            }
          },
        ),
      );
    _open();
  }

  Future<void> _open() async {
    try {
      await controller.loadRequest(await ScoreServer.start());
    } catch (e) {
      if (mounted) setState(() => failure = e.toString());
    }
  }

  Future<void> _show() async {
    await controller.runJavaScript(
      'loadScore(${jsonEncode(widget.abc)}, ${jsonEncode(widget.title)})',
    );
    if (!mounted) return;
    setState(() => ready = true);
    widget.onReady?.call(_build);
  }

  /// JavaScript strings arrive bare on iOS and JSON-quoted on Android.
  Future<String> _call(String expression) async {
    final result = await controller.runJavaScriptReturningResult(expression);
    final text = result.toString();
    return text.startsWith('"') ? jsonDecode(text) as String : text;
  }

  Future<File> _build(String kind) async {
    final folder = await getTemporaryDirectory();
    final file = File('${folder.path}/score.$kind');
    switch (kind) {
      case 'pdf':
        final systems = List<String>.from(
          jsonDecode(await _call('exportSvgs()')) as List,
        );
        await file.writeAsBytes(await buildScorePdf(widget.title, systems));
      case 'mid':
        await file.writeAsBytes(base64Decode(await _call('exportMidi()')));
      default:
        await file.writeAsString(widget.abc);
    }
    return file;
  }

  Future<void> _export(String kind) async {
    final box = context.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    setState(() => exporting = true);
    try {
      final file = await _build(kind);
      await SharePlus.instance.share(
        ShareParams(files: [XFile(file.path)], sharePositionOrigin: origin),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Export failed: $e')));
      }
    } finally {
      if (mounted) setState(() => exporting = false);
    }
  }

  void _chooseExport() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (kind, icon, name, detail) in const [
            ('pdf', Icons.picture_as_pdf, 'PDF sheet music', 'Print or share'),
            (
              'mid',
              Icons.piano,
              'MIDI · editable',
              'Opens in MuseScore, GarageBand, Logic and other editors',
            ),
            ('abc', Icons.notes, 'ABC notation · editable', 'Plain-text score'),
          ])
            ListTile(
              leading: Icon(icon),
              title: Text(name),
              subtitle: Text(detail),
              onTap: () {
                Navigator.pop(sheet);
                _export(kind);
              },
            ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF111111),
    appBar: AppBar(
      title: const Text('Your score'),
      actions: [
        if (exporting)
          const Padding(
            padding: EdgeInsets.all(14),
            child: SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          )
        else
          IconButton(
            onPressed: ready ? _chooseExport : null,
            icon: const Icon(Icons.download),
            tooltip: 'Download',
          ),
      ],
    ),
    body: failure != null
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('The score could not be shown: $failure'),
            ),
          )
        : Stack(
            children: [
              WebViewWidget(controller: controller),
              if (!ready) const Center(child: CircularProgressIndicator()),
            ],
          ),
  );
}
