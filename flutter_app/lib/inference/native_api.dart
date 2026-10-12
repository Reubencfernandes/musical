import 'dart:ffi';
import 'dart:io';
import 'package:ffi/ffi.dart';

typedef Handle = Pointer<Void>;

final class ModelConfig extends Struct {
  external Pointer<Utf8> family;
  external Pointer<Utf8> config;
  external Pointer<Utf8> weights;
  external Pointer<Utf8> spec;
}

final class BackendConfig extends Struct {
  external Pointer<Utf8> backend;
  @Int32()
  external int device;
  @Int32()
  external int threads;
}

/// Bindings to audio.cpp C ABI 0.2. All calls stay on the worker isolate.
/// Borrowed strings/audio/artifacts must be copied before freeing the result.
class NativeApi {
  final DynamicLibrary library;
  NativeApi(this.library) {
    final version = library.lookupFunction<Uint32 Function(), int Function()>(
      'audiocpp_abi_version',
    )();
    if (version >> 16 != 0 || (version & 0xff00) < 0x0200) {
      throw StateError(
        'This audio runtime is incompatible. Rebuild with the pinned audio.cpp version.',
      );
    }
  }

  static NativeApi open({String? path}) {
    const configured = String.fromEnvironment('AUDIOCPP_LIBRARY');
    final name =
        path ??
        (configured.isNotEmpty
            ? configured
            : Platform.isIOS || Platform.isMacOS
            ? 'Audiocpp.framework/Audiocpp'
            : Platform.isWindows
            ? 'audiocpp.dll'
            : 'libaudiocpp.so');
    try {
      return NativeApi(DynamicLibrary.open(name));
    } catch (error) {
      throw StateError(
        'The native audio runtime could not load. Build and bundle it using native/README.md. Details: $error',
      );
    }
  }

  late final lastError = library
      .lookupFunction<Pointer<Utf8> Function(), Pointer<Utf8> Function()>(
        'audiocpp_last_error',
      );
  void check(int status) {
    if (status != 0) {
      throw StateError(
        'Audio runtime ($status): ${lastError().toDartString()}',
      );
    }
  }

  late final registryCreate = library
      .lookupFunction<
        Int32 Function(Pointer<Utf8>, Pointer<Handle>),
        int Function(Pointer<Utf8>, Pointer<Handle>)
      >('audiocpp_registry_create');
  late final registryFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_registry_free',
      );
  late final registryFamilyCount = library
      .lookupFunction<Size Function(Handle), int Function(Handle)>(
        'audiocpp_registry_family_count',
      );
  late final registryFamily = library
      .lookupFunction<
        Int32 Function(Handle, Size, Pointer<Pointer<Utf8>>),
        int Function(Handle, int, Pointer<Pointer<Utf8>>)
      >('audiocpp_registry_family');

  List<String> families() => using((arena) {
    final registry = arena<Handle>(), name = arena<Pointer<Utf8>>();
    try {
      check(registryCreate(nullptr, registry));
      return List.generate(registryFamilyCount(registry.value), (index) {
        check(registryFamily(registry.value, index, name));
        return name.value.toDartString();
      });
    } finally {
      if (registry.value != nullptr) registryFree(registry.value);
    }
  });
  late final modelLoad = library
      .lookupFunction<
        Int32 Function(
          Handle,
          Pointer<Utf8>,
          Pointer<ModelConfig>,
          Handle,
          Pointer<Handle>,
        ),
        int Function(
          Handle,
          Pointer<Utf8>,
          Pointer<ModelConfig>,
          Handle,
          Pointer<Handle>,
        )
      >('audiocpp_model_load');
  late final modelFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_model_free',
      );
  late final supports = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Utf8>, Pointer<Utf8>),
        int Function(Handle, Pointer<Utf8>, Pointer<Utf8>)
      >('audiocpp_model_supports');
  late final optionsCreate = library
      .lookupFunction<Handle Function(), Handle Function()>(
        'audiocpp_options_create',
      );
  late final optionsSet = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Utf8>, Pointer<Utf8>),
        int Function(Handle, Pointer<Utf8>, Pointer<Utf8>)
      >('audiocpp_options_set');
  late final optionsFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_options_free',
      );
  late final sessionCreate = library
      .lookupFunction<
        Int32 Function(
          Handle,
          Pointer<Utf8>,
          Pointer<Utf8>,
          Pointer<BackendConfig>,
          Handle,
          Pointer<Handle>,
        ),
        int Function(
          Handle,
          Pointer<Utf8>,
          Pointer<Utf8>,
          Pointer<BackendConfig>,
          Handle,
          Pointer<Handle>,
        )
      >('audiocpp_session_create');
  late final sessionRun = library
      .lookupFunction<
        Int32 Function(Handle, Handle, Pointer<Handle>),
        int Function(Handle, Handle, Pointer<Handle>)
      >('audiocpp_session_run');
  late final sessionFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_session_free',
      );
  late final requestCreate = library
      .lookupFunction<Handle Function(), Handle Function()>(
        'audiocpp_request_create',
      );
  late final requestFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_request_free',
      );
  late final setText = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Utf8>, Pointer<Utf8>),
        int Function(Handle, Pointer<Utf8>, Pointer<Utf8>)
      >('audiocpp_request_set_text');
  late final setOption = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Utf8>, Pointer<Utf8>),
        int Function(Handle, Pointer<Utf8>, Pointer<Utf8>)
      >('audiocpp_request_set_option');
  late final setAudio = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Float>, Size, Int32, Int32),
        int Function(Handle, Pointer<Float>, int, int, int)
      >('audiocpp_request_set_audio');
  late final resultFree = library
      .lookupFunction<Void Function(Handle), void Function(Handle)>(
        'audiocpp_result_free',
      );
  late final resultAudio = library
      .lookupFunction<
        Int32 Function(
          Handle,
          Pointer<Pointer<Float>>,
          Pointer<Size>,
          Pointer<Int32>,
          Pointer<Int32>,
        ),
        int Function(
          Handle,
          Pointer<Pointer<Float>>,
          Pointer<Size>,
          Pointer<Int32>,
          Pointer<Int32>,
        )
      >('audiocpp_result_audio');
  late final resultText = library
      .lookupFunction<
        Int32 Function(Handle, Pointer<Pointer<Utf8>>, Pointer<Pointer<Utf8>>),
        int Function(Handle, Pointer<Pointer<Utf8>>, Pointer<Pointer<Utf8>>)
      >('audiocpp_result_text');
  late final artifactCount = library
      .lookupFunction<Size Function(Handle), int Function(Handle)>(
        'audiocpp_result_artifact_count',
      );
  late final artifact = library
      .lookupFunction<
        Int32 Function(
          Handle,
          Size,
          Pointer<Int32>,
          Pointer<Pointer<Utf8>>,
          Pointer<Handle>,
          Pointer<Size>,
        ),
        int Function(
          Handle,
          int,
          Pointer<Int32>,
          Pointer<Pointer<Utf8>>,
          Pointer<Handle>,
          Pointer<Size>,
        )
      >('audiocpp_result_artifact');
}
