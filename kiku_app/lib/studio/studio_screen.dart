import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../api/errors.dart';
import '../services.dart';
import '../shell/shell.dart';
import '../songs/song_tile.dart' show shareFile;
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ai_sheet.dart';
import 'project.dart';
import 'studio_controller.dart';

const _rowHeight = 76.0, _rulerHeight = 28.0, _headerWidth = 124.0;

Color _hex(String value) {
  final hex = value.replaceFirst('#', '');
  return Color(int.tryParse(hex.length == 6 ? 'ff$hex' : hex, radix: 16) ?? 0xffa28d19);
}

class StudioScreen extends StatefulWidget {
  const StudioScreen({super.key});
  @override
  State<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends State<StudioScreen> {
  final _recorder = AudioRecorder();
  bool _recording = false;
  DateTime? _recordStarted;
  Timer? _tick;

  @override
  void dispose() {
    _tick?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  StudioController get _studio => Kiku.of(context).studio;

  Future<void> _import() async {
    final studio = _studio;
    final file = await FilePicker.pickFile(type: FileType.audio);
    final path = file?.path;
    if (file == null || path == null) return;
    await studio.openFile(path, name: p.basenameWithoutExtension(file.name));
  }

  Future<void> _record() async {
    final studio = _studio;
    if (_recording) {
      final path = await _recorder.stop();
      _tick?.cancel();
      _recordStarted = null;
      if (mounted) setState(() => _recording = false);
      if (path != null) await studio.openFile(path, name: 'Recording');
      return;
    }
    if (!await _recorder.hasPermission()) {
      if (mounted) showNote(context, 'Allow microphone access in Settings to record.');
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = p.join(dir.path, 'take-${DateTime.now().millisecondsSinceEpoch}.wav');
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 44100, numChannels: 1), path: path);
    _recordStarted = DateTime.now();
    _tick = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (mounted) setState(() {});
      if (_recordStarted != null && DateTime.now().difference(_recordStarted!).inMinutes >= 10) _record();
    });
    setState(() => _recording = true);
  }

  Future<void> _renameProject() async {
    final studio = _studio;
    final controller = TextEditingController(text: studio.name);
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Project name'),
        content: TextField(controller: controller, autofocus: true, maxLength: 50, onSubmitted: (v) => Navigator.pop(context, v)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (value != null) studio.rename(value);
  }

  Future<void> _menu(String choice) async {
    final studio = _studio;
    try {
      switch (choice) {
        case 'new':
          if (studio.dirty && !studio.isEmpty) {
            final ok = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Start a new project?'),
                content: const Text('Changes since the last save are lost.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep working')),
                  FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('New project')),
                ],
              ),
            );
            if (ok != true) return;
          }
          studio.reset();
        case 'open':
          if (mounted) ShellScope.of(context)(Place.library);
        case 'import':
          await _import();
        case 'save':
          await studio.save();
          if (mounted && studio.saveState == 'saved') showNote(context, 'Saved to your library.');
        case 'export':
          final file = await studio.exportMix();
          if (mounted) await shareFile(context, file.path, text: studio.name);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  void _ai(AiAction action) => showAiSheet(context, action);

  @override
  Widget build(BuildContext context) {
    final studio = _studio;
    final colors = KikuColors.of(context);
    return ListenableBuilder(
      listenable: studio,
      builder: (context, _) => Scaffold(
        appBar: PlaceBar(
          title: InkWell(
            onTap: _renameProject,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: Text(studio.name, overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: 4),
                  Icon(Icons.edit_outlined, size: 16, color: colors.muted),
                ],
              ),
            ),
          ),
          actions: [
            IconButton(tooltip: 'Undo', onPressed: studio.canUndo ? studio.undo : null, icon: const Icon(Icons.undo_rounded)),
            IconButton(tooltip: 'Redo', onPressed: studio.canRedo ? studio.redo : null, icon: const Icon(Icons.redo_rounded)),
            IconButton(
              tooltip: studio.saveState == 'saved' ? 'Saved' : 'Save to library',
              onPressed: studio.isEmpty || studio.saveState == 'saving' ? null : () => _menu('save'),
              icon: studio.saveState == 'saving'
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(studio.saveState == 'saved' ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined),
            ),
            PopupMenuButton<String>(
              tooltip: 'Project',
              onSelected: _menu,
              itemBuilder: (context) => [
                const PopupMenuItem(value: 'new', child: Text('New project')),
                const PopupMenuItem(value: 'open', child: Text('Open a saved project')),
                const PopupMenuItem(value: 'import', child: Text('Import audio')),
                PopupMenuItem(value: 'export', enabled: !studio.isEmpty, child: const Text('Export mix (WAV)')),
              ],
            ),
          ],
        ),
        body: Column(
          children: [
            if (studio.busy) const LinearProgressIndicator(),
            if (studio.notice.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ErrorBanner(message: studio.notice, onClose: () {
                  studio.notice = '';
                  setState(() {});
                }),
              ),
            _Transport(studio: studio, recording: _recording, recordStarted: _recordStarted, onRecord: _record),
            Divider(color: colors.line),
            Expanded(
              child: studio.isEmpty
                  ? _Empty(onImport: _import, onRecord: _record, onAi: _ai, recording: _recording)
                  : _Timeline(studio: studio),
            ),
            if (studio.jobs.isNotEmpty) _Jobs(studio: studio),
            _ActionBar(studio: studio, onAi: _ai, onImport: _import),
          ],
        ),
      ),
    );
  }
}

class _Transport extends StatelessWidget {
  const _Transport({required this.studio, required this.recording, required this.recordStarted, required this.onRecord});
  final StudioController studio;
  final bool recording;
  final DateTime? recordStarted;
  final VoidCallback onRecord;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    final recorded = recordStarted == null ? 0.0 : DateTime.now().difference(recordStarted!).inMilliseconds / 1000;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 2, 12, 2),
      child: Row(
        children: [
          IconButton(tooltip: 'Back to start', onPressed: studio.isEmpty ? null : studio.stop, icon: const Icon(Icons.skip_previous_rounded)),
          IconButton.filled(
            tooltip: studio.playing ? 'Pause' : 'Play',
            onPressed: studio.isEmpty ? null : () => studio.playing ? studio.pause() : studio.play(),
            icon: Icon(studio.playing ? Icons.pause_rounded : Icons.play_arrow_rounded),
          ),
          IconButton(
            tooltip: recording ? 'Stop recording' : 'Record',
            onPressed: onRecord,
            icon: Icon(recording ? Icons.stop_circle_rounded : Icons.fiber_manual_record_rounded, color: const Color(0xFFE5484D)),
          ),
          const SizedBox(width: 8),
          ValueListenableBuilder<double>(
            valueListenable: studio.position,
            builder: (context, value, _) => Text(
              recording ? 'REC ${formatTime(recorded)}' : formatTime(value),
              style: TextStyle(
                fontFeatures: const [FontFeature.tabularFigures()],
                fontSize: 15,
                color: recording ? const Color(0xFFE5484D) : null,
              ),
            ),
          ),
          const Spacer(),
          if (!studio.isEmpty)
            Text(
              '${studio.project.bpm.toStringAsFixed(studio.project.bpm % 1 == 0 ? 0 : 1)} BPM${studio.project.key.isNotEmpty ? ' · ${studio.project.key}' : ''}',
              style: TextStyle(fontSize: 12, color: colors.muted),
            ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.onImport, required this.onRecord, required this.onAi, required this.recording});
  final VoidCallback onImport, onRecord;
  final void Function(AiAction) onAi;
  final bool recording;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 30, 24, 24),
      children: [
        Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: colors.accentSoft, borderRadius: BorderRadius.circular(18)),
          child: const Icon(Icons.graphic_eq_rounded, color: accent, size: 28),
        ),
        const SizedBox(height: 18),
        Text('Start with a sound', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'Record or import a take, then restyle it, rewrite part of it, cover it with YuE2, split it into stems, or build a band around it.',
          style: TextStyle(color: colors.muted, height: 1.55),
        ),
        const SizedBox(height: 22),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            FilledButton.icon(onPressed: onImport, icon: const Icon(Icons.folder_open_rounded), label: const Text('Import audio')),
            OutlinedButton.icon(
              onPressed: onRecord,
              icon: Icon(recording ? Icons.stop_rounded : Icons.mic_rounded),
              label: Text(recording ? 'Stop recording' : 'Record'),
            ),
            OutlinedButton.icon(onPressed: () => onAi(AiAction.part), icon: const Icon(Icons.piano_rounded), label: const Text('Add an instrument')),
            OutlinedButton.icon(onPressed: () => onAi(AiAction.song), icon: const Icon(Icons.auto_awesome_rounded), label: const Text('Generate music')),
          ],
        ),
        const SizedBox(height: 16),
        Text('WAV, FLAC, MP3, M4A, OGG · up to 4 minutes per AI action', style: TextStyle(fontSize: 12, color: colors.faint)),
      ],
    );
  }
}

class _Timeline extends StatefulWidget {
  const _Timeline({required this.studio});
  final StudioController studio;
  @override
  State<_Timeline> createState() => _TimelineState();
}

class _TimelineState extends State<_Timeline> {
  final _lanes = ScrollController(), _ruler = ScrollController();
  double? _zoom;
  double? _rangeStart;
  String? _rangeTrack;

  @override
  void initState() {
    super.initState();
    _lanes.addListener(() {
      if (_ruler.hasClients && _ruler.offset != _lanes.offset) _ruler.jumpTo(_lanes.offset.clamp(0.0, _ruler.position.maxScrollExtent));
    });
  }

  @override
  void dispose() {
    _lanes.dispose();
    _ruler.dispose();
    super.dispose();
  }

  (int, double) _hit(Offset local, double pps) => ((local.dy / _rowHeight).floor(), math.max(0.0, local.dx / pps));

  void _tap(Offset local, double pps) {
    final studio = widget.studio;
    final (row, time) = _hit(local, pps);
    if (row < 0 || row >= studio.project.tracks.length) return;
    final track = studio.project.tracks[row];
    final clip = studio.project.clips.where((c) => c.trackId == track.id && c.start <= time && c.end >= time).lastOrNull;
    if (clip != null) {
      studio.selectClip(studio.selection.clips.contains(clip.id) ? null : clip.id);
    } else {
      studio.selectClip(null);
      studio.seek(time);
    }
  }

  void _trackMenu(Track track) => showModalBottomSheet<void>(
    context: context,
    builder: (_) => _TrackSheet(studio: widget.studio, trackId: track.id),
  );

  @override
  Widget build(BuildContext context) {
    final studio = widget.studio, project = studio.project;
    final colors = KikuColors.of(context);
    return LayoutBuilder(builder: (context, size) {
      final view = math.max(100.0, size.maxWidth - _headerWidth);
      final fit = view / math.max(30.0, project.end + 8);
      final pps = (_zoom ?? fit).clamp(4.0, 400.0);
      final width = math.max(view, (project.end + 30) * pps);
      final height = project.tracks.length * _rowHeight;
      final durations = {for (final e in studio.buffers.entries) e.key: e.value.duration};
      return Column(
        children: [
          SizedBox(
            height: _rulerHeight,
            child: Row(
              children: [
                SizedBox(
                  width: _headerWidth,
                  child: Row(
                    children: [
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        tooltip: 'Zoom out',
                        iconSize: 18,
                        onPressed: () => setState(() => _zoom = pps / 1.5),
                        icon: const Icon(Icons.zoom_out_rounded),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        tooltip: 'Zoom in',
                        iconSize: 18,
                        onPressed: () => setState(() => _zoom = pps * 1.5),
                        icon: const Icon(Icons.zoom_in_rounded),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    controller: _ruler,
                    scrollDirection: Axis.horizontal,
                    physics: const NeverScrollableScrollPhysics(),
                    child: GestureDetector(
                      onTapUp: (d) => studio.seek(d.localPosition.dx / pps),
                      child: CustomPaint(
                        size: Size(width, _rulerHeight),
                        painter: _RulerPainter(pps: pps, bpm: project.bpm, color: colors.muted, line: colors.line, position: studio.position),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: _headerWidth,
                    child: Column(
                      children: [
                        for (final track in project.tracks)
                          _TrackHeader(track: track, project: project, onTap: () => _trackMenu(track), studio: studio),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      controller: _lanes,
                      scrollDirection: Axis.horizontal,
                      child: GestureDetector(
                        onTapUp: (d) => _tap(d.localPosition, pps),
                        onLongPressStart: (d) {
                          final (row, time) = _hit(d.localPosition, pps);
                          if (row < 0 || row >= project.tracks.length) return;
                          _rangeStart = time;
                          _rangeTrack = project.tracks[row].id;
                          studio.selectRange(_rangeTrack!, time, time);
                        },
                        onLongPressMoveUpdate: (d) {
                          if (_rangeStart == null || _rangeTrack == null) return;
                          studio.selectRange(_rangeTrack!, _rangeStart!, math.max(0.0, d.localPosition.dx / pps));
                        },
                        onLongPressEnd: (_) {
                          _rangeStart = null;
                          _rangeTrack = null;
                        },
                        child: SizedBox(
                          width: width,
                          height: height,
                          child: Stack(
                            children: [
                              Positioned.fill(
                                child: CustomPaint(
                                  painter: _LanesPainter(
                                    project: project,
                                    peaks: studio.peaks,
                                    durations: durations,
                                    selection: studio.selection,
                                    pps: pps,
                                    raise: colors.raise,
                                    line: colors.line,
                                    text: Theme.of(context).colorScheme.onSurface,
                                  ),
                                ),
                              ),
                              Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: _PlayheadPainter(studio.position, pps)))),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    });
  }
}

class _TrackHeader extends StatelessWidget {
  const _TrackHeader({required this.track, required this.project, required this.onTap, required this.studio});
  final Track track;
  final Project project;
  final VoidCallback onTap;
  final StudioController studio;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    final heard = audible(project, track);
    Widget toggle(String label, bool on, VoidCallback pressed, String tip) => Tooltip(
      message: tip,
      child: InkWell(
        onTap: pressed,
        borderRadius: BorderRadius.circular(5),
        child: Container(
          width: 26,
          height: 22,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: on ? (label == 'S' ? const Color(0xFFE5B53D) : accent) : colors.raise,
            borderRadius: BorderRadius.circular(5),
            border: Border.all(color: colors.line),
          ),
          child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: on ? Colors.black : colors.muted)),
        ),
      ),
    );
    return InkWell(
      onTap: onTap,
      child: Container(
        height: _rowHeight,
        padding: const EdgeInsets.fromLTRB(0, 6, 8, 6),
        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: colors.line), right: BorderSide(color: colors.line))),
        child: Row(
          children: [
            Container(width: 4, color: _hex(track.color).withValues(alpha: heard ? 1 : .35)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(track.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: heard ? null : colors.faint)),
                  if (track.take != null)
                    Text(track.take!.selected ? '${track.take!.label} · in use' : '${track.take!.label} · set aside',
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, color: track.take!.selected ? accent : colors.muted)),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      toggle('M', track.mute, () => studio.setTrack(track.id, (t) => t.copyWith(mute: !t.mute)), 'Mute'),
                      const SizedBox(width: 5),
                      toggle('S', track.solo, () => studio.setTrack(track.id, (t) => t.copyWith(solo: !t.solo)), 'Solo'),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrackSheet extends StatelessWidget {
  const _TrackSheet({required this.studio, required this.trackId});
  final StudioController studio;
  final String trackId;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: studio,
    builder: (context, _) {
      final track = studio.project.track(trackId);
      if (track == null) return const SizedBox(height: 80);
      final take = track.take;
      return Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(track.name, style: Theme.of(context).textTheme.titleLarge),
            if (take != null) ...[
              const SizedBox(height: 10),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('Use this ${take.label.toLowerCase()}'),
                subtitle: Text(take.selected ? 'It plays in place of the original.' : 'The original plays.'),
                value: take.selected,
                onChanged: (on) => studio.useTake(take.id, on),
              ),
              for (final w in take.warnings) Text(w, style: const TextStyle(fontSize: 12, color: accent)),
            ],
            const SizedBox(height: 10),
            Text('Volume ${(track.volume * 100).round()}%'),
            Slider(value: track.volume.clamp(0.0, 1.5), max: 1.5, onChanged: (v) => studio.setTrack(trackId, (t) => t.copyWith(volume: v))),
            Text('Pan ${track.pan == 0 ? 'centre' : track.pan < 0 ? '${(-track.pan * 100).round()}% left' : '${(track.pan * 100).round()}% right'}'),
            Slider(value: track.pan, min: -1, max: 1, onChanged: (v) => studio.setTrack(trackId, (t) => t.copyWith(pan: (v * 20).round() / 20))),
            const SizedBox(height: 8),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: () async {
                    final controller = TextEditingController(text: track.name);
                    final name = await showDialog<String>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Track name'),
                        content: TextField(controller: controller, autofocus: true, maxLength: 40, onSubmitted: (v) => Navigator.pop(context, v)),
                        actions: [FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Save'))],
                      ),
                    );
                    controller.dispose();
                    if (name != null && name.trim().isNotEmpty) studio.setTrack(trackId, (t) => t.copyWith(name: name.trim()));
                  },
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Rename'),
                ),
                const SizedBox(width: 10),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    studio.deleteTrack(trackId);
                  },
                  icon: const Icon(Icons.delete_outline_rounded, size: 18),
                  label: const Text('Delete track'),
                ),
              ],
            ),
          ],
        ),
      );
    },
  );
}

class _RulerPainter extends CustomPainter {
  _RulerPainter({required this.pps, required this.bpm, required this.color, required this.line, required this.position}) : super(repaint: position);
  final double pps, bpm;
  final Color color, line;
  final ValueNotifier<double> position;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = line;
    // Label every so many seconds, keeping labels at least 60 px apart.
    final step = [1, 2, 5, 10, 15, 30, 60, 120].firstWhere((s) => s * pps >= 60, orElse: () => 300);
    for (double t = 0; t * pps < size.width; t += step) {
      final x = t * pps;
      canvas.drawLine(Offset(x, size.height - 8), Offset(x, size.height), paint);
      final label = TextPainter(
        text: TextSpan(text: formatClock(t), style: TextStyle(color: color, fontSize: 10)),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(canvas, Offset(x + 3, 4));
    }
    canvas.drawLine(Offset(0, size.height - .5), Offset(size.width, size.height - .5), paint);
    final x = position.value * pps;
    final head = Path()
      ..moveTo(x - 5, size.height - 9)
      ..lineTo(x + 5, size.height - 9)
      ..lineTo(x, size.height)
      ..close();
    canvas.drawPath(head, Paint()..color = accent);
  }

  @override
  bool shouldRepaint(_RulerPainter old) => old.pps != pps || old.bpm != bpm || old.color != color;
}

class _LanesPainter extends CustomPainter {
  _LanesPainter({
    required this.project,
    required this.peaks,
    required this.durations,
    required this.selection,
    required this.pps,
    required this.raise,
    required this.line,
    required this.text,
  });
  final Project project;
  final Map<String, Float32List> peaks;
  final Map<String, double> durations;
  final Selection selection;
  final double pps;
  final Color raise, line, text;

  @override
  void paint(Canvas canvas, Size size) {
    final linePaint = Paint()..color = line;
    // Bar lines on the project's tempo.
    final bar = 240 / project.bpm;
    if (bar * pps >= 12) {
      final grid = Paint()..color = line.withValues(alpha: .45);
      for (double t = 0; t * pps < size.width; t += bar) {
        canvas.drawLine(Offset(t * pps, 0), Offset(t * pps, size.height), grid);
      }
    }
    for (int i = 0; i < project.tracks.length; i++) {
      final track = project.tracks[i], top = i * _rowHeight;
      final heard = audible(project, track);
      final color = _hex(track.color);
      canvas.drawLine(Offset(0, top + _rowHeight - .5), Offset(size.width, top + _rowHeight - .5), linePaint);
      for (final clip in project.clips.where((c) => c.trackId == track.id)) {
        final rect = Rect.fromLTWH(clip.start * pps, top + 7, math.max(2.0, clip.duration * pps), _rowHeight - 14);
        final dim = clip.muted ? .22 : heard ? 1.0 : .45;
        final selected = selection.clips.contains(clip.id);
        final shape = RRect.fromRectAndRadius(rect, const Radius.circular(8));
        canvas.drawRRect(shape, Paint()..color = color.withValues(alpha: .38 * dim + .08));
        if (selected) canvas.drawRRect(shape, Paint()..color = accent..style = PaintingStyle.stroke..strokeWidth = 2);
        canvas.save();
        canvas.clipRRect(shape);
        final outline = peaks[clip.buffer], length = durations[clip.buffer];
        if (outline != null && length != null && length > 0) {
          final wave = Paint()
            ..color = Color.lerp(color, Colors.white, .55)!.withValues(alpha: .9 * dim)
            ..strokeWidth = 1.4;
          final mid = rect.center.dy, half = rect.height / 2 - 10;
          for (double x = math.max(rect.left, 0.0); x < rect.right; x += 2) {
            final t = clip.offset + (x - rect.left) / pps;
            final bucket = (t / length * outline.length).floor().clamp(0, outline.length - 1);
            final amp = math.max(.02, outline[bucket].toDouble()) * half;
            canvas.drawLine(Offset(x, mid - amp + 6), Offset(x, mid + amp + 6), wave);
          }
        }
        final label = TextPainter(
          text: TextSpan(text: clip.name, style: TextStyle(color: text.withValues(alpha: .85 * dim + .1), fontSize: 10.5, fontWeight: FontWeight.w600)),
          textDirection: TextDirection.ltr,
          maxLines: 1,
          ellipsis: '…',
        )..layout(maxWidth: math.max(0.0, rect.width - 12));
        label.paint(canvas, Offset(rect.left + 6, rect.top + 3));
        canvas.restore();
      }
    }
    final range = selection.range;
    if (range != null) {
      for (final id in range.tracks) {
        final row = project.tracks.indexWhere((t) => t.id == id);
        if (row < 0) continue;
        final rect = Rect.fromLTRB(range.start * pps, row * _rowHeight + 3, range.end * pps, (row + 1) * _rowHeight - 3);
        canvas.drawRect(rect, Paint()..color = accent.withValues(alpha: .16));
        canvas.drawRect(rect, Paint()..color = accent..style = PaintingStyle.stroke..strokeWidth = 1.5);
      }
    }
  }

  @override
  bool shouldRepaint(_LanesPainter old) =>
      old.project != project || old.selection != selection || old.pps != pps || old.raise != raise || old.peaks.length != peaks.length;
}

class _PlayheadPainter extends CustomPainter {
  _PlayheadPainter(this.position, this.pps) : super(repaint: position);
  final ValueNotifier<double> position;
  final double pps;

  @override
  void paint(Canvas canvas, Size size) {
    final x = position.value * pps;
    canvas.drawLine(Offset(x, 0), Offset(x, size.height), Paint()..color = accent..strokeWidth = 1.6);
  }

  @override
  bool shouldRepaint(_PlayheadPainter old) => old.pps != pps;
}

class _Jobs extends StatelessWidget {
  const _Jobs({required this.studio});
  final StudioController studio;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    return Container(
      constraints: const BoxConstraints(maxHeight: 180),
      decoration: BoxDecoration(color: colors.panel, border: Border(top: BorderSide(color: colors.line))),
      child: _JobTicker(
        studio: studio,
        builder: (context) => ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          children: [
            for (final job in studio.jobs)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(job.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                          const SizedBox(height: 2),
                          Text(
                            job.error ?? (job.queue != null && job.queue! > 0 ? 'In queue · ${job.queue} ahead' : job.status),
                            maxLines: job.error != null ? 4 : 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, color: job.error != null ? Theme.of(context).colorScheme.error : colors.muted),
                          ),
                          if (job.error == null) ...[
                            const SizedBox(height: 5),
                            Meter(value: shownProgress(began: job.began, running: job.running, fraction: job.progress, etaAt: job.etaAt)),
                          ],
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: job.error != null ? 'Dismiss' : 'Cancel',
                      onPressed: () => job.error != null ? studio.dismissJob(job.id) : studio.cancelJob(job.id),
                      icon: const Icon(Icons.close_rounded, size: 18),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Redraws job lanes twice a second, so their estimated progress keeps moving.
class _JobTicker extends StatefulWidget {
  const _JobTicker({required this.studio, required this.builder});
  final StudioController studio;
  final WidgetBuilder builder;
  @override
  State<_JobTicker> createState() => _JobTickerState();
}

class _JobTickerState extends State<_JobTicker> {
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context);
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.studio, required this.onAi, required this.onImport});
  final StudioController studio;
  final void Function(AiAction) onAi;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    final colors = KikuColors.of(context);
    final selected = !studio.selection.isEmpty;
    Widget chip(IconData icon, String label, VoidCallback onPressed) => Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ActionChip(avatar: Icon(icon, size: 17, color: accent), label: Text(label), onPressed: onPressed),
    );
    final actions = selected
        ? [
            chip(Icons.palette_outlined, 'Restyle', () => onAi(AiAction.restyle)),
            chip(Icons.edit_note_rounded, 'Rewrite', () => onAi(AiAction.rewrite)),
            chip(Icons.east_rounded, 'Extend', () => onAi(AiAction.extend)),
            chip(Icons.mic_external_on_outlined, 'Cover', () => onAi(AiAction.cover)),
            chip(Icons.call_split_rounded, 'Stems', () => _guard(context, studio.stems)),
            chip(Icons.lyrics_outlined, 'Lyrics', () => _guard(context, () => studio.words((text) => _showLyrics(context, text)))),
            chip(Icons.content_cut_rounded, 'Split here', studio.splitAtPlayhead),
            chip(Icons.delete_outline_rounded, 'Delete', () => studio.deleteClips(studio.selection.clips)),
          ]
        : [
            chip(Icons.piano_rounded, 'Add instrument', () => onAi(AiAction.part)),
            chip(Icons.music_note_rounded, 'Instrumental', () => onAi(AiAction.instrumental)),
            chip(Icons.queue_music_rounded, 'Song', () => onAi(AiAction.song)),
            chip(Icons.folder_open_rounded, 'Import', onImport),
            if (!studio.isEmpty) chip(Icons.content_cut_rounded, 'Split at playhead', studio.splitAtPlayhead),
          ];
    return Container(
      decoration: BoxDecoration(color: colors.panel, border: Border(top: BorderSide(color: colors.line))),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            selected
                ? 'Kiku AI works on what is selected.'
                : studio.isEmpty
                ? 'Add audio, or let Kiku AI write some.'
                : 'Tap a clip, or long-press and drag across one, to select it.',
            style: TextStyle(fontSize: 12, color: colors.muted),
          ),
          const SizedBox(height: 6),
          SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: actions)),
        ],
      ),
    );
  }
}

void _guard(BuildContext context, void Function() action) {
  try {
    action();
  } catch (e) {
    showError(context, e is KikuException ? e : KikuException(describe(e)));
  }
}

void _showLyrics(BuildContext context, String text) {
  if (!context.mounted) return;
  showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('The words'),
      content: SingleChildScrollView(child: SelectableText(text)),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    ),
  );
}
