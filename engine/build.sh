#!/usr/bin/env bash
# Builds engine/bin/audiocpp_server for this machine. Extra arguments go to
# CMake, e.g.  ./build.sh -DENGINE_ENABLE_CUDA=ON
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
revision=542bb4ea2a18273e96b3237e5f1f6941df148d9f
source="$root/external/audio.cpp"
if [[ ! -d "$source/.git" ]]; then
  mkdir -p "$root/external"
  git clone --filter=blob:none --no-checkout https://github.com/0xShug0/audio.cpp "$source"
  git -C "$source" fetch --depth 1 origin "$revision"
  git -C "$source" checkout --detach "$revision"
fi
cmake -S "$root" -B "$root/build" -DCMAKE_BUILD_TYPE=Release "$@"
# Two jobs keep compilation within reach of an 8 GB machine.
cmake --build "$root/build" --config Release --target audiocpp_server --parallel "${JOBS:-2}"
mkdir -p "$root/bin"
binary="$(find "$root/build" -type f -name 'audiocpp_server*' -perm -u+x | head -1)"
cp "$binary" "$root/bin/"
echo "Engine ready: $root/bin/$(basename "$binary")"
