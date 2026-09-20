# Engine

The desktop app runs its models through [audio.cpp](https://github.com/0xShug0/audio.cpp)
(pinned at `542bb4ea2a18273e96b3237e5f1f6941df148d9f`), built here as a small
HTTP server that listens on loopback only. Only the YuE2 and SheetSage2 model
families are compiled in.

```sh
./build.sh                          # macOS: Metal
./build.sh -DENGINE_ENABLE_CUDA=ON  # Windows/Linux with an NVIDIA GPU
./build.sh -DENGINE_ENABLE_VULKAN=ON  # AMD, Intel and other Vulkan GPUs
./build.sh                          # no GPU flag off macOS: CPU only
```

Requires CMake 3.24+, Python 3 and a C++17 compiler. The result is
`bin/audiocpp_server`, which `apps/desktop` launches. `external/`, `build/` and
`bin/` are not committed.

`patch_runtime.py` runs at configure time and applies small, checked fixes to the
pinned source: failed Metal allocations return an error instead of crashing, and
SheetSage2's encoder uses flash attention on Metal so long recordings fit in
memory. It refuses to build if upstream no longer matches.
`python3 tests/check_metal_allocation.py` exercises the allocation fix.

## Known gap: the checkout is not yet reproducible

The working `external/audio.cpp` carries four local edits that are in neither
upstream nor `patch_runtime.py` (an Xcode object-name collision workaround, a
`std::to_chars` fix for Apple libc++, and a sentencepiece CMake fix). A fresh
clone may therefore fail to build on macOS until those are folded into
`patch_runtime.py`. Do not delete or re-clone `external/` before that is done.
Only macOS/Metal has been built and run so far; CUDA, Vulkan and Windows are
untested.
