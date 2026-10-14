import 'dart:async';

/// The session has lapsed; the app shows sign-in without losing work.
class SignedOut implements Exception {
  const SignedOut([this.message = 'Sign in again to continue.']);
  final String message;
  @override
  String toString() => message;
}

/// Saving needs permission to create and write repos in the user's account.
class NeedsStorage implements Exception {
  const NeedsStorage();
  @override
  String toString() =>
      'Allow Kiku AI to save to your Hugging Face account: sign in again and approve saving, or use a token with write access.';
}

/// The user stopped the job.
class Cancelled implements Exception {
  const Cancelled();
  @override
  String toString() => 'Cancelled.';
}

/// A failure with a message fit to show.
class KikuException implements Exception {
  const KikuException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Lets a job be stopped from the UI; HTTP clients close when it fires.
class CancelToken {
  bool _cancelled = false;
  final _listeners = <void Function()>[];
  final _done = Completer<void>();

  bool get cancelled => _cancelled;

  /// Completes when the job is cancelled.
  Future<void> get whenCancelled => _done.future;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final listener in List.of(_listeners)) {
      listener();
    }
    _listeners.clear();
    _done.complete();
  }

  void onCancel(void Function() listener) {
    if (_cancelled) {
      listener();
    } else {
      _listeners.add(listener);
    }
  }

  void check() {
    if (_cancelled) throw const Cancelled();
  }

  /// Waits, returning early if cancelled.
  Future<void> pause(Duration duration) => Future.any([Future<void>.delayed(duration), whenCancelled]);
}

/// Friendly text for the failures people actually hit, as in the web app's
/// lib/jobs.ts, so the app never shows a stack or an HTML error page.
String explain(String message) {
  if (RegExp(r'<!doctype html|<html', caseSensitive: false).hasMatch(message)) {
    final code = RegExp(r'<h1>\s*(\d{3})\s*</h1>', caseSensitive: false).firstMatch(message)?.group(1);
    return "Hugging Face's servers had a hiccup${code != null ? ' (error $code)' : ''} and the job didn't go through. "
        'Your project is safe. Run it again.';
  }
  if (RegExp(r'quota|GPU.*duration|exceeded|allowance', caseSensitive: false).hasMatch(message)) {
    return 'Your Hugging Face GPU allowance is used up for now. It resets 24 hours after your first '
        'generation, or you can upgrade to PRO for a larger daily allowance.';
  }
  if (RegExp(r'gpu task aborted|timed out|timeout', caseSensitive: false).hasMatch(message)) {
    return 'The generation ran out of GPU time. Try a shorter piece.';
  }
  if (RegExp(r'no gpu|unavailable|\b503\b|starting', caseSensitive: false).hasMatch(message)) {
    return 'The engine is waking up. Wait a moment and try again.';
  }
  if (RegExp(r'\b429\b|too many requests|rate.?limit', caseSensitive: false).hasMatch(message)) {
    return 'Hugging Face is busy right now. Wait a minute and try again; your project is safe.';
  }
  return message.length > 600 ? '${message.substring(0, 600)}…' : message;
}

/// A message from any error, for showing.
String describe(Object error) {
  if (error is KikuException) return error.message;
  if (error is SignedOut) return error.message;
  if (error is FormatException) return error.message;
  final text = error.toString();
  return explain(text.startsWith('Exception: ') ? text.substring(11) : text);
}
