# Generation latency and song artwork

The web app calls Kiku-Engine on Hugging Face first for YuE2-Turbo audio, with its existing
private GPU fallback when ZeroGPU is unavailable. The source already enables vLLM and keeps
models resident on the GPU. Guidance defaults to 1; increasing it leaves the fast vLLM path.
The first request also initializes the model/runtime. These changes do not claim a measured
improvement to the audio model's inference time.

The avoidable delay was sequential artwork: it started only after the song had been generated,
downloaded, decoded and encoded as MP3. Artwork now starts alongside audio once lyrics/style
are known. Audio becomes playable independently, including when artwork fails. For an uploaded
song cover with unknown words, artwork starts when the transcribed lyrics arrive in the result.

## Relevant images

Qwen3-4B, the existing song writer, turns the idea, lyrics, style, setting and emotional arc
into a short visual scene with a subject, lighting and palette. Simple mode writes it in its
existing pass and returns it in `meta.artwork`. Custom songs and older songs use the engine's
new `/artwork` endpoint while audio runs. This interprets song information; it does not listen
to or retranscribe generated audio. An unavailable writer falls back to title/style artwork.
Raw lyrics and the original idea are not forwarded to the image Space.

Z-Image Turbo renders 768 × 768 directly, matching stored library artwork. This is 43.75% fewer
pixels than 1024 × 1024; it is not a promise of 43.75% faster inference. The model retains its
recommended nine scheduler steps (eight forward passes) and zero guidance. Existing 768px WebP
outputs skip a second browser resize/encode. Artwork ready before audio is included in the
initial library save, avoiding a separate artwork upload.

## Loading feedback

Generating rows reserve the finished song's artwork and metadata space with neutral shimmer
skeletons, a known title, elapsed time and the service's actual status. They no longer present
an invented progress percentage. Pending artwork remains a skeleton after audio is playable,
including in the player and song page, until the image has loaded. Failed jobs stop shimmering;
failed images keep the existing gradient. Reduced motion disables the shimmer and image fade.

## Further audio speed improvements

- Keep guidance at 1 to retain the existing vLLM path. Shorter lyrics generate shorter songs.
- Measure cold start, queue, model planning, audio synthesis, export and download separately
  before changing resource allocations. A faster UI does not prove faster inference.
- A warm dedicated Hugging Face GPU can avoid shared ZeroGPU queueing and runtime cold starts,
  but adds hosting cost. This work changes no hosting plan or billing configuration.
- Hugging Face supports ahead-of-time compilation for compatible models, not `torch.compile`
  on ZeroGPU. Compiled artifacts need hardware/version validation and live benchmarks before
  enabling them; none were added here.

## Playback before a song finishes

Gradio supports streamed audio, but the pinned YuE2 pipeline currently returns a complete
song after symbolic/semantic generation, acoustic synthesis and VAE decoding. Its synthesis
code has internal chunks, but collects the results before returning them; these are not a
playable stream exposed to the app. The app also downloads and encodes the final file before
making it playable.

Progressive previews would require a chunk-producing inference path, overlapping synthesis
and decoding where supported, safe chunk boundaries, and a buffered browser player. Streaming
only the VAE's final decode stage would not remove the earlier full-song stages. Covers also
read the source and align the completed performance to it, so early playback would be a preview
rather than the final aligned output. Shared GPU queueing and cold starts still happen before
any preview can start. No real-time playback changes were made in this work.

References: [pinned YuE2 pipeline](https://github.com/NoizAI/YuE2-Turbo/blob/7c88813bfff9db9127f11c35b9e1b72983ded200/src/yue2/pipeline.py),
[pinned acoustic synthesis](https://github.com/NoizAI/YuE2-Turbo/blob/7c88813bfff9db9127f11c35b9e1b72983ded200/src/yue2/nar.py),
[Gradio streaming outputs](https://gradio.app/guides/streaming-outputs).

Primary references: [ZeroGPU model loading, queues and compilation](https://huggingface.co/docs/hub/spaces-zerogpu),
[Z-Image Turbo inference settings](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo),
[Hugging Face's AoTI guide](https://huggingface.co/blog/zerogpu-aoti).

## Deploy and verify

Deploy `outputs/kiku-engine-space` first for the writer changes and `/artwork`, then
`outputs/kiku-art-space` for 768px rendering, and `outputs/kiku-ai` for the new flow and UI.
The client can still use an older engine via its title/style fallback, but a coordinated
deployment enables the full feature. Deployment restarts may interrupt active jobs.

Local checks: `npm run typecheck` and `npm run build` in `outputs/kiku-ai`, plus
`python outputs/kiku-engine-space/test_writer.py`. With the local dev server on port 3010,
run `node ../../work/verify-generation-flow.cjs` from `outputs/kiku-ai`, with `PLAYWRIGHT_MODULE`
set to an installed Playwright when it is not on Node's path. The browser test mocks
all external generation and storage requests; it verifies concurrency, skeleton sizing,
mobile/reduced-motion behavior, image failure, cancellation and restoration without GPU use.
Live latency and visual relevance still need a deployed GPU run.
