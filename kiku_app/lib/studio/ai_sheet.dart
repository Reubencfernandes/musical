import 'package:flutter/material.dart';

import '../api/engine.dart';
import '../api/errors.dart';
import '../services.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

enum AiAction {
  restyle('Restyle', 'Keep the selection’s structure and change its sound.', 'restyle'),
  rewrite('Rewrite', 'Write the selected stretch again, in context.', 'rewrite'),
  extend('Extend', 'Continue the selected clip past its end.', 'extend'),
  cover('Cover', 'YuE2 reads the tune and performs it in a new style.', 'cover'),
  part('Add instrument', 'One instrument at a time, written to the project’s beat and chords.', 'part'),
  instrumental('Instrumental', 'A backing track or instrumental at the playhead.', 'instrumental'),
  song('Song', 'A song with (synthetic) vocals at the playhead.', 'song');

  const AiAction(this.label, this.blurb, this.task);
  final String label, blurb, task;
}

/// The instruments the studio adds one at a time; each maps to a Demucs stem,
/// so the result really is that instrument alone.
const instruments = {
  'drums': 'Drums',
  'bass': 'Bass',
  'keys': 'Keys',
  'guitar': 'Guitar',
  'strings': 'Strings',
  'synth': 'Synth',
  'band': 'Full band',
};

Future<void> showAiSheet(BuildContext context, AiAction action) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => _AiSheet(action: action),
);

class _AiSheet extends StatefulWidget {
  const _AiSheet({required this.action});
  final AiAction action;
  @override
  State<_AiSheet> createState() => _AiSheetState();
}

class _AiSheetState extends State<_AiSheet> {
  final _style = TextEditingController(), _lyrics = TextEditingController();
  late Model _model = supports[widget.action.task]!.first;
  double _change = 0.5, _variance = 0.5, _seconds = 20, _duration = 60, _strength = 0.45;
  bool _sing = true, _keepHarmony = true, _follow = true;
  String _instrument = 'drums';
  String _error = '';

  @override
  void dispose() {
    _style.dispose();
    _lyrics.dispose();
    super.dispose();
  }

  void _run() {
    final studio = Kiku.of(context).studio;
    final style = _style.text.trim(), lyrics = _lyrics.text.trim();
    try {
      switch (widget.action) {
        case AiAction.restyle:
          if (style.isEmpty) throw const KikuException('Describe the style to move towards.');
          studio.restyle(style: style, change: _change, lyrics: lyrics, model: _model);
        case AiAction.rewrite:
          studio.rewrite(style: style, variance: _variance, lyrics: lyrics, model: _model);
        case AiAction.extend:
          studio.extend(style: style, seconds: _seconds, lyrics: lyrics, model: _model);
        case AiAction.cover:
          studio.cover(style: style, lyrics: lyrics, sing: _sing, keepHarmony: _keepHarmony);
        case AiAction.part:
          studio.part(
            instrument: _instrument,
            label: instruments[_instrument]!,
            style: style,
            follow: _follow && !studio.isEmpty,
            duration: _duration,
            strength: _strength,
            model: _model,
          );
        case AiAction.instrumental:
          studio.generate(song: false, style: style, lyrics: '', duration: _duration, model: _model);
        case AiAction.song:
          studio.generate(song: true, style: style, lyrics: lyrics, duration: _duration, model: _model);
      }
      Navigator.pop(context);
    } catch (e) {
      setState(() => _error = describe(e));
    }
  }

  Widget _slider(String label, double value, double min, double max, ValueChanged<double> changed, {int? divisions, String Function(double)? show}) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label · ${show != null ? show(value) : '${(value * 100).round()}%'}', style: const TextStyle(fontSize: 13)),
          Slider(value: value, min: min, max: max, divisions: divisions, onChanged: (v) => setState(() => changed(v))),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final action = widget.action;
    final colors = KikuColors.of(context);
    final studio = Kiku.of(context).studio;
    final models = supports[action.task]!;
    final lyricsLabel = switch (action) {
      AiAction.song => 'Lyrics',
      AiAction.cover => 'Lyrics (leave empty to keep the song’s own words)',
      _ => 'Lyrics (optional)',
    };
    final showLyrics = action != AiAction.part && action != AiAction.instrumental && !(action == AiAction.cover && !_sing);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(action.label, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(action.blurb, style: TextStyle(color: colors.muted, fontSize: 13)),
            const SizedBox(height: 16),
            if (action == AiAction.part) ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final e in instruments.entries)
                    ChoiceChip(label: Text(e.value), selected: _instrument == e.key, onSelected: (_) => setState(() => _instrument = e.key)),
                ],
              ),
              const SizedBox(height: 12),
            ],
            TextField(
              controller: _style,
              minLines: 2,
              maxLines: 4,
              maxLength: 2000,
              decoration: InputDecoration(
                labelText: action == AiAction.part ? 'Style (optional)' : 'Style',
                alignLabelWithHint: true,
                hintText: switch (action) {
                  AiAction.restyle => 'e.g. lo-fi jazz trio, brushed drums, warm upright bass',
                  AiAction.cover => 'e.g. soulful female vocal, gospel choir, Rhodes piano',
                  AiAction.part => 'e.g. tight funk groove, muted guitar',
                  _ => 'Genre, mood, instruments, texture',
                },
              ),
            ),
            if (showLyrics)
              TextField(
                controller: _lyrics,
                minLines: action == AiAction.song ? 5 : 2,
                maxLines: 10,
                maxLength: 4000,
                decoration: InputDecoration(labelText: lyricsLabel, alignLabelWithHint: true, hintText: '[verse]\n…\n\n[chorus]\n…'),
              ),
            if (action == AiAction.restyle) _slider('How much to change', _change, 0.1, 0.9, (v) => _change = v),
            if (action == AiAction.rewrite) _slider('Variation', _variance, 0.1, 1, (v) => _variance = v),
            if (action == AiAction.extend) _slider('Add', _seconds, 5, 40, (v) => _seconds = v, divisions: 35, show: (v) => '${v.round()} s'),
            if (action == AiAction.cover) ...[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Sing it'),
                subtitle: const Text('Off: an instrument plays the melody.'),
                value: _sing,
                onChanged: (v) => setState(() => _sing = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Keep the chords'),
                subtitle: const Text('Off: YuE2 may reharmonise.'),
                value: _keepHarmony,
                onChanged: (v) => setState(() => _keepHarmony = v),
              ),
            ],
            if (action == AiAction.part) ...[
              if (!studio.isEmpty)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Follow the project'),
                  subtitle: const Text('Written to the music already here.'),
                  value: _follow,
                  onChanged: (v) => setState(() => _follow = v),
                ),
              if (studio.isEmpty || !_follow) _slider('Length', _duration, 5, 240, (v) => _duration = v, divisions: 47, show: (v) => '${v.round()} s'),
              _slider('How closely to follow', _strength, 0.2, 0.8, (v) => _strength = v),
            ],
            if (action == AiAction.instrumental) _slider('Length', _duration, 10, 240, (v) => _duration = v, divisions: 46, show: (v) => '${v.round()} s'),
            if (models.length > 1) ...[
              const SizedBox(height: 6),
              const Text('Model', style: TextStyle(fontSize: 13)),
              const SizedBox(height: 6),
              SegmentedButton<Model>(
                segments: [for (final m in models) ButtonSegment(value: m, label: Text(m.label, style: const TextStyle(fontSize: 12)))],
                selected: {_model},
                showSelectedIcon: false,
                onSelectionChanged: (s) => setState(() => _model = s.first),
              ),
              const SizedBox(height: 4),
              Text(_model.blurb, style: TextStyle(fontSize: 12, color: colors.muted)),
            ] else
              Text('Runs on ${models.first.label}.', style: TextStyle(fontSize: 12, color: colors.muted)),
            if (_error.isNotEmpty) ErrorBanner(message: _error, onClose: () => setState(() => _error = '')),
            const SizedBox(height: 14),
            FilledButton.icon(onPressed: _run, icon: const Icon(Icons.auto_awesome_rounded), label: Text(action.label)),
          ],
        ),
      ),
    );
  }
}
