import 'package:flutter/material.dart';

class StudioScreen extends StatelessWidget {
  const StudioScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Score Studio\nOn-device GGUF models run in the native app. Use the iPhone or desktop build for local generation.',
          ),
        ),
      ),
    ),
  );
}
