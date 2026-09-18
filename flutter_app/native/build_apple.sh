#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
target="${1:-ios}"
revision=542bb4ea2a18273e96b3237e5f1f6941df148d9f
[[ "$target" == ios || "$target" == macos ]] || { echo 'Usage: bash native/build_apple.sh ios|macos'; exit 1; }
command -v cmake >/dev/null || { echo 'Install CMake first (brew install cmake).'; exit 1; }
xcode-select -p >/dev/null
mkdir -p "$root/external"
if [[ ! -d "$root/external/audio.cpp/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/0xShug0/audio.cpp.git "$root/external/audio.cpp"
fi
git -C "$root/external/audio.cpp" fetch --depth 1 origin "$revision"
git -C "$root/external/audio.cpp" checkout --detach "$revision"
build="$root/build-$target"
if [[ "$target" == ios ]]; then
  cmake -S "$root" -B "$build" -G Xcode -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT=iphoneos -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO
else
  cmake -S "$root" -B "$build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64
fi
# Keep compilation memory modest on the 8 GB M2 development Mac.
cmake --build "$build" --config Release --target audiocpp --parallel 2
framework="$(find "$build" -type d -name Audiocpp.framework -print -quit)"
[[ -n "$framework" ]] || { echo 'Framework not produced'; exit 1; }
mkdir -p "$root/artifacts/$target"
ditto "$framework" "$root/artifacts/$target/Audiocpp.framework"
ruby "$root/link_ios.rb" "$target"
echo "Native framework bundled for $target. Run flutter run on your device."
