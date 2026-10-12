import 'package:flutter/material.dart';
import 'studio_web.dart' if (dart.library.io) 'studio_screen.dart';

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
    home: const StudioScreen(),
  );
}
