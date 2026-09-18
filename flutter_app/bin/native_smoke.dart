import 'dart:ffi';
import 'dart:io';
import 'package:ffi/ffi.dart';
import 'package:score_studio/inference/native_api.dart';

// Runs against a real compiled library without downloading model weights.
void main(List<String> args) {
  final api = NativeApi.open(path: args.single);
  final families = api.families();
  for (final family in ['yue2', 'sheetsage2']) {
    if (!families.contains(family)) throw StateError('$family is missing');
  }
  for (int attempt = 0; attempt < 3; attempt++) {
    using((arena) {
      final registry = arena<Handle>(), model = arena<Handle>();
      try {
        api.check(api.registryCreate(nullptr, registry));
        final config = arena<ModelConfig>();
        config.ref.family = 'yue2'.toNativeUtf8(allocator: arena);
        final status = api.modelLoad(
          registry.value,
          '${Directory.systemTemp.path}/score-studio-missing-${DateTime.now().microsecondsSinceEpoch}'
              .toNativeUtf8(allocator: arena),
          config,
          nullptr,
          model,
        );
        if (status == 0 || api.lastError().toDartString().isEmpty) {
          throw StateError('Missing model did not produce an actionable error');
        }
      } finally {
        api.modelFree(model.value);
        api.registryFree(registry.value);
      }
    });
  }
  stdout.writeln(
    'PASS: ABI, both model registrations, repeated load-error recovery.',
  );
  stdout.writeln('This smoke check does not execute model inference.');
}
