import 'package:flutter/material.dart';

import 'auth/sign_in_screen.dart';
import 'config.dart';
import 'services.dart';
import 'shell/shell.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final services = Services(await Settings.load());
  await services.auth.load();
  runApp(KikuApp(services: services));
}

class KikuApp extends StatelessWidget {
  const KikuApp({super.key, required this.services});
  final Services services;

  @override
  Widget build(BuildContext context) => Kiku(
    services: services,
    child: ListenableBuilder(
      listenable: Listenable.merge([services.settings, services.auth]),
      builder: (context, _) => MaterialApp(
        title: 'Kiku AI',
        debugShowCheckedModeBanner: false,
        themeMode: services.settings.themeMode,
        theme: kikuTheme(Brightness.light),
        darkTheme: kikuTheme(Brightness.dark),
        home: services.auth.user == null ? const SignInScreen() : const Shell(),
      ),
    ),
  );
}
