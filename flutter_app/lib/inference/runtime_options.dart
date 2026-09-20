/// Metadata arenas for the pinned audio.cpp runtime. Tensor data and backend
/// workspaces are allocated separately: these are not total memory budgets.
/// Upstream defaults reserve multiple GiB even for no_alloc GGML contexts.
Map<String, String> runtimeOptions(String family) => switch (family) {
  'sheetsage2' => const {
    'sheetsage2.weight_context_mb': '16',
    // The patched encoder uses this directly. Keep room for the decoder's
    // two 524288-node graphs plus its 131072-node cross-attention graph.
    'sheetsage2.decoder_graph_arena_mb': '128',
  },
  'yue2' => const {
    'yue2.model_gguf': 'yue2-3b-q4_0.gguf',
    'yue2.vae_gguf': 'yue2-vae-f16.gguf',
    'yue2.model_weight_context_mb': '16',
    'yue2.vae_weight_context_mb': '16',
    'yue2.ar_prefill_graph_arena_mb': '128',
    'yue2.ar_decode_graph_arena_mb': '128',
    'yue2.nar_graph_arena_mb': '128',
    'yue2.vae_graph_arena_mb': '128',
  },
  _ => throw ArgumentError.value(family, 'family', 'Unsupported music model'),
};
