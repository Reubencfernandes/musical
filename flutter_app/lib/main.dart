import 'package:flutter/material.dart';

void main() => runApp(const ScoreStudioApp());

class ScoreStudioApp extends StatelessWidget {
  const ScoreStudioApp({super.key});

  ThemeData theme(Brightness brightness) => ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: ColorScheme.fromSeed(
      seedColor: const Color(0xFFFF5526),
      brightness: brightness,
      primary: const Color(0xFFFF5526),
    ),
    scaffoldBackgroundColor: brightness == Brightness.dark
        ? const Color(0xFF111111)
        : Colors.white,
  );

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Score Studio',
    debugShowCheckedModeBanner: false,
    themeMode: ThemeMode.system,
    theme: theme(Brightness.light),
    darkTheme: theme(Brightness.dark),
    home: const ScoreStudioHome(),
  );
}

class ScoreStudioHome extends StatelessWidget {
  const ScoreStudioHome({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.music_note_rounded,
                  size: 56,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: 32),
                Text(
                  'Your music.\nWritten down.',
                  style: Theme.of(context).textTheme.displayMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.5,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'A new home for your sheet music.',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 40),
                Text(
                  'SCORE STUDIO',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
                    letterSpacing: 3,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
