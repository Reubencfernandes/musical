import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/errors.dart';
import '../services.dart';
import '../shell/settings_sheet.dart';
import '../ui/logo.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});
  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _token = TextEditingController();
  bool _busy = false, _useToken = false;
  String _error = '';

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await action();
    } on Cancelled {
      // The user closed the sign-in sheet.
    } catch (e) {
      if (mounted) setState(() => _error = describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Kiku.of(context).auth;
    final colors = KikuColors.of(context);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(tooltip: 'Settings', icon: const Icon(Icons.tune_rounded), onPressed: () => showSettings(context)),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(28, 0, 28, 40),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const KikuMark(size: 64),
                  const SizedBox(height: 28),
                  Text('Your idea.\nA whole song.', style: text.displaySmall?.copyWith(height: 1.06)),
                  const SizedBox(height: 18),
                  Text(
                    'Write songs from a sentence, reshape your own recordings, and turn music into sheet music.',
                    style: TextStyle(fontSize: 17, height: 1.6, color: colors.muted),
                  ),
                  const SizedBox(height: 28),
                  FilledButton.icon(
                    onPressed: _busy ? null : () => _run(auth.signInWithHuggingFace),
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 56), padding: const EdgeInsets.symmetric(horizontal: 24)),
                    icon: const Text('🤗', style: TextStyle(fontSize: 18)),
                    label: const Text('Sign in with Hugging Face'),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Uses your account’s free processing allowance. New here? You can create an account when you sign in.',
                    style: TextStyle(fontSize: 13, height: 1.5, color: colors.muted),
                  ),
                  const SizedBox(height: 18),
                  TextButton(
                    onPressed: _busy ? null : () => setState(() => _useToken = !_useToken),
                    child: Text(_useToken ? 'Hide access token sign-in' : 'Use an access token instead'),
                  ),
                  if (_useToken) ...[
                    const SizedBox(height: 6),
                    TextField(
                      controller: _token,
                      obscureText: true,
                      autocorrect: false,
                      enableSuggestions: false,
                      decoration: const InputDecoration(hintText: 'hf_…', labelText: 'Hugging Face access token'),
                      onSubmitted: (_) => _run(() => auth.signInWithToken(_token.text)),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Create one at huggingface.co/settings/tokens. A token with write access lets Kiku AI keep your songs in a private dataset in your account.',
                      style: TextStyle(fontSize: 12, height: 1.5, color: colors.muted),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        FilledButton(
                          onPressed: _busy ? null : () => _run(() => auth.signInWithToken(_token.text)),
                          child: const Text('Sign in'),
                        ),
                        OutlinedButton(
                          onPressed: () => launchUrl(Uri.parse('https://huggingface.co/settings/tokens'), mode: LaunchMode.externalApplication),
                          child: const Text('Get a token'),
                        ),
                      ],
                    ),
                  ],
                  if (_busy) const Padding(padding: EdgeInsets.only(top: 18), child: LinearProgressIndicator()),
                  if (_error.isNotEmpty) ErrorBanner(message: _error, onClose: () => setState(() => _error = '')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
