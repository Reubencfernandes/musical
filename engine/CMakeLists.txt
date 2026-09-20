cmake_minimum_required(VERSION 3.24)
project(KikuStudioEngine LANGUAGES C CXX)

# Builds the audio.cpp HTTP server that the desktop app runs on loopback.
# Only the two model families Kiku Studio uses are compiled in.
set(AUDIOCPP_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/external/audio.cpp" CACHE PATH "Pinned audio.cpp checkout")
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "" FORCE)
set(AUDIOCPP_MODEL_SET custom CACHE STRING "" FORCE)
set(AUDIOCPP_MODELS "yue2;sheetsage2" CACHE STRING "" FORCE)
set(ENGINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_NATIVE_CPU OFF CACHE BOOL "" FORCE)
if(APPLE)
  # Apple clang ships no OpenMP; Metal is the GPU backend.
  set(ENGINE_ENABLE_OPENMP OFF CACHE BOOL "" FORCE)
  set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
  set(ENGINE_ENABLE_CUDA OFF CACHE BOOL "" FORCE)
  set(ENGINE_ENABLE_METAL ON CACHE BOOL "" FORCE)
  set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)
endif()
# Elsewhere pick the GPU backend at configure time, e.g.
#   -DENGINE_ENABLE_CUDA=ON      NVIDIA
#   -DENGINE_ENABLE_VULKAN=ON    AMD / Intel / anything with a Vulkan driver
# With neither, the engine runs on the CPU.

find_package(Python3 REQUIRED COMPONENTS Interpreter)
execute_process(
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/patch_runtime.py" "${AUDIOCPP_SOURCE_DIR}"
  COMMAND_ERROR_IS_FATAL ANY)
add_subdirectory("${AUDIOCPP_SOURCE_DIR}" audiocpp-build)
