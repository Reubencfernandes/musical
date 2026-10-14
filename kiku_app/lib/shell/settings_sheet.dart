import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../services.dart';
import '../ui/theme.dart';

/// Account, appearance and where the app finds Kiku AI.
Future<void> showSettings(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (context) => const _SettingsSheet(),
);

class _SettingsSheet extends StatefulWidget {
  const _SettingsSheet();
  @override
  State<_SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<_SettingsSheet> {
  late final TextEditingController _app, _engine;

  @override
  void initState() {
    super.initState();
    final settings = Kiku.of(context).settings;
    _app = TextEditingController(text: settings.appOrigin);
    _engine = TextEditingController(text: settings.engineOrigin);
  }

  @override
  void dispose() {
    _app.dispose();
    _engine.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final services = Kiku.of(context);
    final colors = KikuColors.of(context);
    final user = services.auth.user;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Settings', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            if (user != null) ...[
              Row(
                children: [
                  CircleAvatar(backgroundColor: colors.accentSoft, child: Text(user.handle.substring(0, 1).toUpperCase(), style: const TextStyle(color: accent))),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.handle, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(
                          user.storage ? 'Saving to ${services.library.repo}' : 'Saving is off: sign in again and allow it',
                          style: TextStyle(fontSize: 12, color: colors.muted),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () {
                      Navigator.pop(context);
                      services.auth.signOut();
                    },
                    child: const Text('Sign out'),
                  ),
                ],
              ),
              if (!services.auth.remembered)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('This device could not store your sign-in securely, so you will sign in again next time.',
                      style: TextStyle(fontSize: 12, color: colors.muted)),
                ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => launchUrl(services.library.page, mode: LaunchMode.externalApplication),
                icon: const Icon(Icons.open_in_new_rounded, size: 16),
                label: const Text('Open your library on Hugging Face'),
              ),
              const Divider(height: 28),
            ],
            const Text('Appearance', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            ListenableBuilder(
              listenable: services.settings,
              builder: (context, _) => SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(value: ThemeMode.system, label: Text('Device'), icon: Icon(Icons.brightness_auto_rounded)),
                  ButtonSegment(value: ThemeMode.light, label: Text('Light'), icon: Icon(Icons.light_mode_rounded)),
                  ButtonSegment(value: ThemeMode.dark, label: Text('Dark'), icon: Icon(Icons.dark_mode_rounded)),
                ],
                selected: {services.settings.themeMode},
                onSelectionChanged: (s) => services.settings.setThemeMode(s.first),
              ),
            ),
            const Divider(height: 32),
            const Text('Servers', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
              'Kiku AI runs ACE-Step 1.5, YuE2 and cover art on private Modal GPUs; the engine Space runs transcription, stems and ACE-Step 1 on your Hugging Face allowance.',
              style: TextStyle(fontSize: 12, height: 1.5, color: colors.muted),
            ),
            const SizedBox(height: 12),
            TextField(controller: _app, decoration: const InputDecoration(labelText: 'Kiku AI', hintText: Defaults.appOrigin)),
            const SizedBox(height: 10),
            TextField(controller: _engine, decoration: const InputDecoration(labelText: 'Engine Space', hintText: Defaults.engineOrigin)),
            const SizedBox(height: 12),
            Row(
              children: [
                FilledButton(
                  onPressed: () async {
                    await services.settings.setOrigins(app: _app.text, engine: _engine.text);
                    if (context.mounted) Navigator.pop(context);
                  },
                  child: const Text('Save'),
                ),
                const SizedBox(width: 10),
                TextButton(
                  onPressed: () {
                    _app.text = Defaults.appOrigin;
                    _engine.text = Defaults.engineOrigin;
                  },
                  child: const Text('Use the defaults'),
                ),
              ],
            ),
            const Divider(height: 32),
            Text(
              'YuE2, SheetSage2 and DreamLite-base are CC BY-NC 4.0 (non-commercial); ACE-Step is Apache 2.0 and Demucs MIT. '
              'Supreme and Bespoke Stencil are by Indian Type Foundry via Fontshare; abcjs is MIT.',
              style: TextStyle(fontSize: 11, height: 1.5, color: colors.faint),
            ),
            TextButton(onPressed: () => showLicensePage(context: context, applicationName: 'Kiku AI'), child: const Text('Open-source licences')),
          ],
        ),
      ),
    );
  }
}
