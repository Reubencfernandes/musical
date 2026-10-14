import 'package:flutter/material.dart';

/// Kiku AI's colours, from the web app's hub.css and globals.css: near-black
/// surfaces (or warm white), one orange accent.
class KikuColors extends ThemeExtension<KikuColors> {
  const KikuColors({
    required this.panel,
    required this.raise,
    required this.line,
    required this.muted,
    required this.faint,
    required this.accentSoft,
  });
  final Color panel, raise, line, muted, faint, accentSoft;

  static const dark = KikuColors(
    panel: Color(0xFF161619),
    raise: Color(0xFF1E1E22),
    line: Color(0xFF2A2A30),
    muted: Color(0xFF9A99A3),
    faint: Color(0xFF6C6B74),
    accentSoft: Color(0x2EFF7133),
  );
  static const light = KikuColors(
    panel: Color(0xFFFFFFFF),
    raise: Color(0xFFF5F4F1),
    line: Color(0xFFDEDCD6),
    muted: Color(0xFF716F69),
    faint: Color(0xFF9C9A93),
    accentSoft: Color(0x24FB5729),
  );

  static KikuColors of(BuildContext context) => Theme.of(context).extension<KikuColors>() ?? dark;

  @override
  KikuColors copyWith({Color? panel, Color? raise, Color? line, Color? muted, Color? faint, Color? accentSoft}) => KikuColors(
    panel: panel ?? this.panel,
    raise: raise ?? this.raise,
    line: line ?? this.line,
    muted: muted ?? this.muted,
    faint: faint ?? this.faint,
    accentSoft: accentSoft ?? this.accentSoft,
  );

  @override
  KikuColors lerp(ThemeExtension<KikuColors>? other, double t) {
    if (other is! KikuColors) return this;
    return KikuColors(
      panel: Color.lerp(panel, other.panel, t)!,
      raise: Color.lerp(raise, other.raise, t)!,
      line: Color.lerp(line, other.line, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      faint: Color.lerp(faint, other.faint, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
    );
  }
}

const accent = Color(0xFFFF7133);
const accentDeep = Color(0xFFF2541C);

ThemeData kikuTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final colors = dark ? KikuColors.dark : KikuColors.light;
  final ink = dark ? const Color(0xFFEFEEF0) : const Color(0xFF20201E);
  final background = dark ? const Color(0xFF0E0E10) : const Color(0xFFFFFFFF);
  final scheme = ColorScheme.fromSeed(seedColor: accent, brightness: brightness).copyWith(
    primary: accent,
    onPrimary: Colors.white,
    secondary: accent,
    surface: background,
    onSurface: ink,
    surfaceContainerHighest: colors.raise,
    surfaceContainerHigh: colors.raise,
    surfaceContainer: colors.panel,
    surfaceContainerLow: colors.panel,
    outline: colors.line,
    outlineVariant: colors.line,
    onSurfaceVariant: colors.muted,
    error: const Color(0xFFE5484D),
  );
  final base = ThemeData(useMaterial3: true, brightness: brightness, colorScheme: scheme, fontFamily: 'Supreme');
  TextStyle? display(TextStyle? style) => style?.copyWith(fontFamily: 'Bespoke Stencil', fontWeight: FontWeight.w700, letterSpacing: -0.5);
  return base.copyWith(
    scaffoldBackgroundColor: background,
    extensions: [colors],
    textTheme: base.textTheme.copyWith(
      displayLarge: display(base.textTheme.displayLarge),
      displayMedium: display(base.textTheme.displayMedium),
      displaySmall: display(base.textTheme.displaySmall),
      headlineLarge: display(base.textTheme.headlineLarge),
      headlineMedium: display(base.textTheme.headlineMedium),
      headlineSmall: display(base.textTheme.headlineSmall),
      titleLarge: display(base.textTheme.titleLarge),
    ),
    appBarTheme: AppBarTheme(backgroundColor: background, surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0),
    dividerTheme: DividerThemeData(color: colors.line, space: 1, thickness: 1),
    cardTheme: CardThemeData(
      color: colors.panel,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: colors.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: accent,
        foregroundColor: Colors.white,
        minimumSize: const Size(48, 46),
        padding: const EdgeInsets.symmetric(horizontal: 22),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontFamily: 'Supreme', fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        minimumSize: const Size(48, 44),
        side: BorderSide(color: colors.line),
        shape: const StadiumBorder(),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.raise,
      hintStyle: TextStyle(color: colors.faint),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: colors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: colors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: accent, width: 1.4)),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: colors.raise,
      selectedColor: colors.accentSoft,
      side: BorderSide(color: colors.line),
      shape: const StadiumBorder(),
      labelStyle: TextStyle(color: ink, fontSize: 13),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: dark ? const Color(0xFF111114) : const Color(0xFFFAF9F7),
      indicatorColor: colors.accentSoft,
      surfaceTintColor: Colors.transparent,
      height: 64,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12, color: colors.muted)),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: dark ? const Color(0xFF111114) : const Color(0xFFFAF9F7),
      indicatorColor: colors.accentSoft,
      selectedIconTheme: const IconThemeData(color: accent),
      unselectedIconTheme: IconThemeData(color: colors.muted),
      selectedLabelTextStyle: TextStyle(color: ink, fontSize: 12),
      unselectedLabelTextStyle: TextStyle(color: colors.muted, fontSize: 12),
    ),
    sliderTheme: SliderThemeData(activeTrackColor: accent, thumbColor: accent, inactiveTrackColor: colors.line, trackHeight: 3),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: colors.raise, contentTextStyle: TextStyle(color: ink)),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: colors.panel, surfaceTintColor: Colors.transparent, showDragHandle: true),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : colors.muted),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? accent : colors.raise),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: accent, linearTrackColor: colors.line),
  );
}
