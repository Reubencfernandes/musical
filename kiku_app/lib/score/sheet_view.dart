import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../ui/theme.dart';

/// Whether this device can draw scores (webview_flutter runs on Android, iOS and macOS).
bool get canDrawScores => Platform.isAndroid || Platform.isIOS || Platform.isMacOS;

/// SheetSage2's score drawn as sheet music with abcjs, the same engraving the
/// web app uses, in a web view. Highlights [bar] and reports taps on bars.
class SheetView extends StatefulWidget {
  const SheetView({super.key, required this.abc, required this.bar, this.onBar, this.follow = true});
  final String abc;
  final int bar;
  final ValueChanged<int>? onBar;
  final bool follow;

  @override
  State<SheetView> createState() => _SheetViewState();
}

class _SheetViewState extends State<SheetView> {
  WebViewController? _controller;
  bool _ready = false;
  String? _loadedFor;

  Future<void> _load(Brightness brightness) async {
    if (!canDrawScores) return;
    final key = '${widget.abc.hashCode}-$brightness';
    if (_loadedFor == key) return;
    _loadedFor = key;
    _ready = false;
    final template = await rootBundle.loadString('assets/score/score.html');
    final abcjs = await rootBundle.loadString('assets/score/abcjs-basic-min.js');
    final engrave = await rootBundle.loadString('assets/score/engrave.js');
    final page = brightness == Brightness.dark ? '#0e0e10' : '#f5f4f1';
    final html = template
        .replaceFirst('__PAGE__', page)
        .replaceFirst('__ABCJS__', abcjs.replaceAll('</script', '<\\/script'))
        .replaceFirst('__ENGRAVE__', engrave.replaceAll('</script', '<\\/script'))
        .replaceFirst('__ABC__', jsonEncode(widget.abc).replaceAll('</', '<\\/'));
    final fresh = _controller == null;
    final controller = _controller ??= WebViewController();
    if (fresh) {
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      // macOS web views draw their own background; elsewhere it matches the page.
      if (!Platform.isMacOS) await controller.setBackgroundColor(Color(int.parse('ff${page.substring(1)}', radix: 16)));
      await controller.addJavaScriptChannel('Kiku', onMessageReceived: (message) {
        final data = jsonDecode(message.message);
        if (data is! Map) return;
        if (data['ready'] == true && mounted) {
          setState(() => _ready = true);
          _mark();
        }
        if (data['bar'] is num) widget.onBar?.call((data['bar'] as num).toInt());
      });
    }
    await controller.loadHtmlString(html);
    if (mounted) setState(() {});
  }

  void _mark() {
    if (_ready) _controller?.runJavaScript('kikuBar(${widget.bar}, ${widget.follow})');
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load(Theme.of(context).brightness);
  }

  @override
  void didUpdateWidget(SheetView old) {
    super.didUpdateWidget(old);
    if (old.abc != widget.abc) {
      _load(Theme.of(context).brightness);
    } else if (old.bar != widget.bar) {
      _mark();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (!canDrawScores) return _AbcText(abc: widget.abc);
    return Stack(
      children: [
        if (controller != null) WebViewWidget(controller: controller),
        if (!_ready) const Center(child: CircularProgressIndicator()),
      ],
    );
  }
}

/// The score as text, where a web view is not available.
class _AbcText extends StatelessWidget {
  const _AbcText({required this.abc});
  final String abc;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Drawing sheet music needs the iPhone, Android or Mac app. Here is the score as ABC notation; '
            'share it to open it in MuseScore or any ABC editor.',
            style: TextStyle(color: KikuColors.of(context).muted, fontSize: 13)),
        const SizedBox(height: 12),
        SelectableText(abc, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, height: 1.6)),
      ],
    ),
  );
}
