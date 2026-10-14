import 'dart:async';

import 'package:flutter/material.dart';

import '../api/engine.dart';
import '../api/errors.dart';
import '../services.dart';
import '../shell/shell.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'song_tile.dart';
import 'songs_controller.dart';

const _tags = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Instrumental'];
const _lengths = {0: 'Auto', 30: '30 s', 60: '1 min', 120: '2 min', 180: '3 min'};

class GenerateScreen extends StatefulWidget {
  const GenerateScreen({super.key});
  @override
  State<GenerateScreen> createState() => _GenerateScreenState();
}

class _GenerateScreenState extends State<GenerateScreen> {
  final _idea = TextEditingController(), _caption = TextEditingController(), _lyrics = TextEditingController();
  final _filter = TextEditingController();
  bool _simple = true, _instrumental = false, _enhancing = false;
  Model _model = Model.ace15;
  int _length = 0;
  Map<String, dynamic>? _meta;
  String _error = '';
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    // Progress rows estimate between engine updates, so redraw them while songs are being made.
    _ticker = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (mounted && Kiku.of(context).songs.making.isNotEmpty) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    for (final c in [_idea, _caption, _lyrics, _filter]) {
      c.dispose();
    }
    super.dispose();
  }

  void _tag(String name) {
    final text = _lyrics.text, selection = _lyrics.selection;
    final at = selection.isValid ? selection.start : text.length;
    final before = text.substring(0, at);
    final insert = '${before.isNotEmpty && !before.endsWith('\n') ? '\n' : ''}${before.isNotEmpty ? '\n' : ''}[$name]\n';
    _lyrics.value = TextEditingValue(
      text: before + insert + text.substring(at),
      selection: TextSelection.collapsed(offset: at + insert.length),
    );
  }

  Future<void> _enhance() async {
    if (_caption.text.trim().isEmpty || _enhancing) return;
    setState(() {
      _enhancing = true;
      _error = '';
    });
    try {
      final result = await Kiku.of(context).engine.run('enhance', {'caption': _caption.text, 'lyrics': _instrumental ? '' : _lyrics.text},
          cancel: CancelToken(), status: (_) {});
      final caption = (result['caption'] ?? '').toString();
      setState(() {
        _caption.text = caption.length > 2000 ? caption.substring(0, 2000) : caption;
        _meta = (result['meta'] as Map?)?.cast<String, dynamic>();
      });
    } catch (e) {
      if (mounted) setState(() => _error = describe(e));
    } finally {
      if (mounted) setState(() => _enhancing = false);
    }
  }

  void _create() {
    setState(() => _error = '');
    final songs = Kiku.of(context).songs;
    if (_simple) {
      if (_idea.text.trim().isEmpty) return setState(() => _error = 'Describe the song you want to make.');
      songs.create(SongRequest.simple(idea: _idea.text.trim(), instrumental: _instrumental, model: _model));
    } else {
      if (_caption.text.trim().isEmpty) return setState(() => _error = 'Describe the style: genre, mood, instruments, texture.');
      if (!_instrumental && _lyrics.text.trim().isEmpty) return setState(() => _error = 'Add lyrics, or switch on Instrumental.');
      songs.create(SongRequest.custom(
        caption: _caption.text.trim(),
        lyrics: _lyrics.text.trim(),
        instrumental: _instrumental,
        model: _model,
        duration: _length == 0 ? null : _length,
        meta: _meta,
      ));
    }
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final colors = KikuColors.of(context);
    final form = Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<bool>(
            segments: const [ButtonSegment(value: true, label: Text('Simple')), ButtonSegment(value: false, label: Text('Custom'))],
            selected: {_simple},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => _simple = s.first),
          ),
          const SizedBox(height: 16),
          if (_simple) ...[
            TextField(
              controller: _idea,
              minLines: 4,
              maxLines: 6,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'Describe the song',
                alignLabelWithHint: true,
                hintText: 'A warm acoustic love song about the first snow, soft female vocal…',
              ),
            ),
            Text('Kiku writes the style and lyrics from your idea, then performs it with ${_model.label}.',
                style: TextStyle(fontSize: 12, color: colors.muted, height: 1.5)),
          ] else ...[
            TextField(
              controller: _caption,
              minLines: 3,
              maxLines: 6,
              maxLength: 2000,
              // Edits make Enhance available and drop the plan made for the old text.
              onChanged: (_) => setState(() => _meta = null),
              decoration: const InputDecoration(
                labelText: 'Style',
                alignLabelWithHint: true,
                hintText: 'Genre, mood, instruments, texture, era: e.g. dreamy indie pop, shimmering guitars, soft female vocal',
              ),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _enhancing || _caption.text.trim().isEmpty ? null : _enhance,
                icon: _enhancing
                    ? const SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.auto_fix_high_rounded, size: 16),
                label: Text(_enhancing ? 'Enhancing…' : 'Enhance'),
              ),
            ),
            if (_meta != null && (_meta!['bpm'] != null || _meta!['keyscale'] != null))
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Planned: ${[if (_meta!['bpm'] != null) '${_meta!['bpm']} BPM', if (_meta!['keyscale'] != null) _meta!['keyscale']].join(' · ')}',
                  style: TextStyle(fontSize: 12, color: colors.muted),
                ),
              ),
            if (!_instrumental) ...[
              const SizedBox(height: 14),
              TextField(
                controller: _lyrics,
                minLines: 7,
                maxLines: 14,
                maxLength: 4000,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 13, height: 1.6),
                decoration: const InputDecoration(
                  labelText: 'Lyrics',
                  alignLabelWithHint: true,
                  hintText: '[Verse]\nYour first lines here\n\n[Chorus]\nThe part everyone sings',
                ),
              ),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [for (final t in _tags) ActionChip(label: Text('[$t]'), onPressed: () => _tag(t))],
              ),
              const SizedBox(height: 6),
              Text('Keep lines to about 6–10 syllables and leave a blank line between sections.',
                  style: TextStyle(fontSize: 12, color: colors.muted)),
            ],
          ],
          const SizedBox(height: 16),
          DropdownButtonFormField<Model>(
            initialValue: _model,
            decoration: const InputDecoration(labelText: 'Model'),
            items: const [
              DropdownMenuItem(value: Model.ace15, child: Text('ACE-Step 1.5 · fast, follows the style')),
              DropdownMenuItem(value: Model.yue2, child: Text('YuE2 · strong vocals and melody')),
            ],
            onChanged: (m) => setState(() => _model = m ?? Model.ace15),
          ),
          if (!_simple) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              key: ValueKey(_model == Model.yue2 && !_instrumental),
              initialValue: _model == Model.yue2 && !_instrumental ? 0 : _length,
              decoration: const InputDecoration(labelText: 'Length'),
              items: [for (final e in _lengths.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
              onChanged: _model == Model.yue2 && !_instrumental ? null : (v) => setState(() => _length = v ?? 0),
            ),
          ],
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Instrumental'),
            value: _instrumental,
            onChanged: (v) => setState(() => _instrumental = v),
          ),
          if (_error.isNotEmpty) ErrorBanner(message: _error, onClose: () => setState(() => _error = '')),
          FilledButton.icon(onPressed: _create, icon: const Icon(Icons.graphic_eq_rounded), label: const Text('Create')),
        ],
      ),
    );
    final list = ListenableBuilder(
      listenable: Listenable.merge([services.songs, _filter]),
      builder: (context, _) {
        final songs = services.songs;
        final query = _filter.text.trim().toLowerCase();
        final shown = songs.songs.where((s) => query.isEmpty || '${s.song.title} ${s.song.caption}'.toLowerCase().contains(query)).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('Your songs', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(width: 16),
                Expanded(
                  child: TextField(
                    controller: _filter,
                    decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search_rounded, size: 18), hintText: 'Search'),
                  ),
                ),
              ],
            ),
            if (!(services.auth.user?.storage ?? false))
              const ErrorBanner(message: 'Keep your songs: sign in again and allow Kiku AI to save them to a private dataset in your Hugging Face account.'),
            if (songs.error.isNotEmpty) ErrorBanner(message: songs.error, onClose: () {
              songs.error = '';
              setState(() {});
            }),
            const SizedBox(height: 6),
            for (final m in songs.making) MakingTile(making: m),
            for (final s in shown) SongTile(item: s),
            if (songs.loading && songs.songs.isEmpty)
              const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
            if (!songs.loading && songs.songs.isEmpty && songs.making.isEmpty)
              const EmptyNote(icon: Icons.graphic_eq_rounded, text: 'Your songs will appear here. Describe one to begin.'),
          ],
        );
      },
    );
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    return Scaffold(
      appBar: PlaceBar(
        title: const Text('Generate'),
        actions: [IconButton(tooltip: 'Refresh', onPressed: () => services.songs.reload(force: true), icon: const Icon(Icons.refresh_rounded))],
      ),
      body: wide
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 440, child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 12, 32), children: [form])),
                Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 20, 32), children: [list])),
              ],
            )
          : RefreshIndicator(
              onRefresh: () => services.songs.reload(force: true),
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [form, const SizedBox(height: 24), list]),
            ),
    );
  }
}
