"""Exercise the actual patched allocator with deterministic Metal failure stubs."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'external/audio.cpp/external/ggml/src/ggml-metal/ggml-metal.cpp').read_text()
start = source.index('static ggml_backend_buffer_t ggml_backend_metal_buffer_type_alloc_buffer(')
end = source.index('\nstatic size_t ', start)
function = source[start:end]
harness = r'''
#include <cassert>
#include <cstddef>
struct device { void *context; };
struct buffer_type { struct device *device; };
struct metal_buffer { bool shared; };
using ggml_backend_buffer_type_t = buffer_type *;
using ggml_metal_device_t = void *;
using ggml_metal_buffer_t = metal_buffer *;
using ggml_backend_buffer_t = void *;
using ggml_backend_buffer_i = int;
static constexpr int ggml_backend_metal_buffer_shared_i = 1;
static constexpr int ggml_backend_metal_buffer_private_i = 2;
static bool fail = true;
static metal_buffer result;
static int observed = 0;
ggml_metal_buffer_t ggml_metal_buffer_init(void *, size_t, bool shared) {
  result.shared = shared;
  return fail ? nullptr : &result;
}
bool ggml_metal_buffer_is_shared(metal_buffer *p) { assert(p); return p->shared; }
void *ggml_backend_buffer_init(buffer_type *, int iface, metal_buffer *p, size_t) {
  observed = iface; return p;
}
'''
main = r'''
int main() {
  device dev{}; buffer_type type{&dev};
  assert(ggml_backend_metal_buffer_type_alloc_buffer(&type, 1024, true) == nullptr);
  assert(observed == 0);
  fail = false;
  assert(ggml_backend_metal_buffer_type_alloc_buffer(&type, 1024, true) == &result);
  assert(observed == 1);
  assert(ggml_backend_metal_buffer_type_alloc_buffer(&type, 1024, false) == &result);
  assert(observed == 2);
}
'''
with tempfile.TemporaryDirectory(prefix='score-metal-test-') as folder:
  file = Path(folder) / 'probe.cpp'
  binary = Path(folder) / 'probe'
  file.write_text(harness + function + main)
  subprocess.run(['xcrun', 'clang++', '-std=c++17', str(file), '-o', str(binary)], check=True)
  subprocess.run([str(binary)], check=True)
print('PASS: failed Metal allocation returns nullptr; shared/private success paths preserved')
