"""Apply small, checked fixes to the pinned runtime without discarding local work."""
from pathlib import Path
import sys


def replace_once(path, before, after):
    raw = path.read_bytes()
    newline = b"\r\n" if b"\r\n" in raw else b"\n"
    text = raw.decode().replace("\r\n", "\n")
    if after in text:
        return
    if text.count(before) != 1:
        raise RuntimeError(f"Runtime patch no longer matches {path}; review the upstream change")
    path.write_bytes(text.replace(before, after, 1).encode().replace(b"\n", newline))


def apply(root):
    metal = root / "external/ggml/src/ggml-metal"
    replace_once(metal / "ggml-metal.cpp",
        "    ggml_metal_buffer_t res = ggml_metal_buffer_init(ctx_dev, size, shared);\n",
        "    ggml_metal_buffer_t res = ggml_metal_buffer_init(ctx_dev, size, shared);\n"
        "    // Score Studio: propagate allocation failure instead of dereferencing NULL.\n"
        "    if (res == nullptr) {\n"
        "        return nullptr;\n"
        "    }\n")
    device = metal / "ggml-metal-device.m"
    replace_once(device,
        "ggml_metal_buffer_t ggml_metal_buffer_init(ggml_metal_device_t dev, size_t size, bool shared) {\n"
        "    ggml_metal_buffer_t res = calloc(1, sizeof(struct ggml_metal_buffer));\n",
        "ggml_metal_buffer_t ggml_metal_buffer_init(ggml_metal_device_t dev, size_t size, bool shared) {\n"
        "    ggml_metal_buffer_t res = calloc(1, sizeof(struct ggml_metal_buffer));\n"
        "    if (res == NULL) { return NULL; } // Score Studio: allocation failure\n")
    # Failed Metal allocations still own their host memory. Use the normal
    # destructor so repeated failed jobs do not accumulate multi-GB leaks.
    replace_once(device,
        '        GGML_LOG_ERROR("%s: error: failed to allocate buffer, size = %8.2f MiB\\n", __func__, size_aligned / 1024.0 / 1024.0);\n'
        '        free(res);\n',
        '        GGML_LOG_ERROR("%s: error: failed to allocate buffer, size = %8.2f MiB\\n", __func__, size_aligned / 1024.0 / 1024.0);\n'
        '        ggml_metal_buffer_free(res); // Score Studio: release owned memory\n')
    # Restrict this replacement to init: map() does not own its host allocation.
    raw = device.read_bytes()
    text = raw.decode().replace('\r\n', '\n')
    start = text.index('ggml_metal_buffer_t ggml_metal_buffer_init(')
    end = text.index('ggml_metal_buffer_t ggml_metal_buffer_map(', start)
    body = text[start:end]
    old = '        free(res);\n        return NULL;\n'
    new = '        ggml_metal_buffer_free(res); // Score Studio: release residency resources\n        return NULL;\n'
    if new not in body:
        if body.count(old) != 1:
            raise RuntimeError('Residency cleanup patch no longer matches')
        text = text[:start] + body.replace(old, new) + text[end:]
        newline = b'\r\n' if b'\r\n' in raw else b'\n'
        device.write_bytes(text.encode().replace(b'\n', newline))
    # Encoder attention is non-causal and already supported by the runtime's
    # flash module. Avoid materializing the 16-head, 7500-step score matrix on
    # Metal (the physical A17 Pro probe requested a 3652.97 MiB work buffer).
    # Long encoder graphs must yield to iOS between command buffers. The
    # desktop default submits almost the whole encoder as one GPU command.
    context = metal / 'ggml-metal-context.m'
    replace_once(context, '#import <Metal/Metal.h>\n',
        '#import <Metal/Metal.h>\n#import <TargetConditionals.h> // Score Studio\n')
    replace_once(context,
        '    const int n_main = MAX(64, 0.1*gf->n_nodes);\n',
        '    #if TARGET_OS_IPHONE\n'
        '    const int n_main = 64;\n'
        '    ggml_metal_set_n_cb(ctx, MIN(8, MAX(1, (gf->n_nodes + 127) / 128)));\n'
        '    #else\n'
        '    const int n_main = MAX(64, 0.1*gf->n_nodes);\n'
        '    #endif // Score Studio: bounded iOS GPU submissions\n')
    encoder = root / 'src/models/sheetsage/runtime.cpp'
    before = '''    k = modules::SplitRoPEModule({head_dim}).build(ctx, k, cos, sin);
    auto context = modules::ScaledDotProductAttentionModule({
        head_dim,
        modules::ScaledDotProductAttentionLowering::Explicit,
'''
    after = '''    k = modules::SplitRoPEModule({head_dim}).build(ctx, k, cos, sin);
    auto context = modules::ScaledDotProductAttentionModule({
        head_dim,
        ctx.backend_type == core::BackendType::Metal
            ? modules::ScaledDotProductAttentionLowering::Flash
            : modules::ScaledDotProductAttentionLowering::Explicit,
'''
    replace_once(encoder, before, after)
    # no_alloc contexts store tensor/graph metadata, not activations. The
    # encoder's 1M-node graph fits the configured 128 MiB metadata arena; the
    # upstream x8 multiplier needlessly reserves another 896 MiB of iOS VA.
    replace_once(encoder,
        'ggml_init_params params{options_.graph_arena_bytes * 8, nullptr, true};',
        'ggml_init_params params{options_.graph_arena_bytes, nullptr, true}; // Score Studio: metadata only')


if __name__ == "__main__":
    apply(Path(sys.argv[1]))
