# On-device music studio: feasibility notes

## Requested experience

Keep the Score Studio name, orange/black/white themes, and fixed-grid musician animation. Generate 1–3 minute songs and transcribe audio on the phone; export audio for use in another video editor. Aim for broad device support without paid GPU hosting. Initial validation device: iPhone 15 Pro; development Mac: M2, 8 GB RAM.

Show real stage progress immediately. Play completed audio portions while further generation continues where the runtime supports valid incremental decoding.

## Verified starting points

- [YuE2 GGUF](https://huggingface.co/audio-cpp/Yue2-3B-GGUF) provides quantized main weights and a separate VAE decoder.
- [SheetSage2 GGUF](https://huggingface.co/audio-cpp/SheetSage2-GGUF) is a community conversion using the MERT backbone.
- [audio.cpp YuE2 documentation](https://github.com/0xShug0/audio.cpp/blob/dev/docs/models/yue2.md) describes native generation, score conditioning, and memory arenas. Its documented CLI path is not proof of iOS compatibility or native audio streaming.

GGUF availability does not establish phone memory fit, operator/backend support, speed, or thermal sustainability. Desktop CUDA benchmarks must not be presented as phone measurements. Universal low-end phone support is an unvalidated goal.

## Proposed runtime boundary (not implemented)

Flutter handles interaction and animation; a native worker handles inference off the UI thread. Use a bounded event channel for stage progress, partial notation, validated playable PCM chunks when available, completion, cancellation, and errors. Progress/token events are not playable audio.

Keep one heavy inference stage resident at a time on constrained devices. Transcribe and release SheetSage2 before loading YuE2 when a workflow requires both. Playback can run alongside generation; loading both models concurrently is not a memory optimization.

Incremental audio needs runtime verification: semantic token generation, acoustic synthesis, and VAE decoding may have dependencies that prevent immediate waveform output. If chunk decoding is supported, preserve model context and validate boundaries and timing before playback. Do not concatenate unrelated generations and claim seamless streaming. Keep completed chunks on disk and a bounded playback buffer in memory.

## First engineering gate

Build the native runtime on the Mac, verify Metal/CPU support for each model, then run on the actual iPhone. Measure peak process memory, model load time, first playable audio, total generation time, thermal state, output quality, and cancellation recovery. Test short clips before 1–3 minute songs. Validate airplane-mode operation after model download.

Only publish supported-device claims after measurements. If a device cannot meet memory or speed requirements, explain that limitation; do not silently upload audio to a server. Mobile GGUF inference, streaming output, and a multitrack Flutter editor remain future work.
