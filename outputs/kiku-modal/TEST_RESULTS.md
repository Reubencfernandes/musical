# Modal deployment trial — 11 October 2026

ACE-Step 1.5 is deployed as `kiku-acestep15` in the `konkanillm` workspace's
`main` environment. Deployment ID: `ap-1HGYBEATc574wNCSoacecb`.

- [Modal dashboard](https://modal.com/apps/konkanillm/main/deployed/kiku-acestep15)
- Private API: `https://konkanillm--kiku-acestep15-engine-web.modal.run`
- GPU: NVIDIA L40S, one worker maximum, no always-running worker, 120-second idle window.
- Turbo and Base share their VAE and text encoder; the 1.7B planner uses PyTorch.
- Source is Kiku's existing vendored ACE-Step runtime and adapter. Weight revisions
  are recorded in `model-revisions.json`.

## Observed performance

Each request generated a 30-second instrumental with the same prompt, seed 42,
and eight Turbo steps. WAVs are stereo, 48 kHz, and exactly 30 seconds long.
The live ZeroGPU Space was already running before the test; its full app/model
startup was not measured. Modal began with zero GPU workers, and weights had
already been downloaded and committed by a CPU worker.

| Request | Caller wall time | Generation measurement |
| --- | ---: | ---: |
| Modal first request, direct method, cold worker | 72.94 s | 5.81 s, measured including output commit |
| Modal second request, direct method, same worker | 5.69 s | 2.04 s, measured including output commit |
| Modal warm Gradio HTTP request 1 | 9.21 s | Adapter reported 1 s, rounded |
| Modal warm Gradio HTTP request 2 | 7.91 s | Adapter reported 1 s, rounded |
| ZeroGPU Gradio HTTP request 1 | 8.94 s | Adapter reported 2 s, rounded |
| ZeroGPU Gradio HTTP request 2 | 5.26 s | Adapter reported 1 s, rounded |

Modal model initialization took 56.38 seconds, including imports, loading Turbo,
Base, shared components, the planner, and building the Gradio interface. Peak
PyTorch GPU allocation was 15.11 GiB during the direct-method tests. Both direct
requests and the HTTP health checks recorded the same worker ID, confirming reuse.

The direct-method measurement includes remote call transport and returned WAV
bytes. The HTTP measurements include queueing, processing, and WAV download;
Gradio client setup is excluded. HF client setup took another 3.90 seconds.
The cold first-call total also includes allocation/startup and first-generation
warmup. This is one cold sample, not a measured typical cold-start latency.

**This baseline did not show a speed advantage over ZeroGPU.** Warm inference is
similar, and the fresh Modal worker has appreciable initialization overhead.
Compilation, Flash Attention, a different planner backend, lazy model loading,
or memory snapshots were not enabled or evaluated in this initial trial. This result
does not establish performance on different GPUs, longer songs, or a busy
ZeroGPU shared queue.

## Verification

- Modal accepted the image and resource definitions and deployed the app successfully.
- Pinned weights were downloaded on CPU into the models Volume.
- Four Modal generations and two ZeroGPU generations returned valid WAVs.
- Direct Modal outputs passed duration, stereo/channel, PCM, and non-silence checks.
- The native CUDA decorator passed a concurrent-call check: only one inference
  executes at a time and successful outputs trigger persistence.
- `/health` returned ready with the measured worker ID.
- All nine existing Gradio endpoint names were present in the private API config.
- The Gradio `/instrumental` path completed through HTTP, including output download.
- Anonymous HTTP requests were rejected with 401.
- Temporary proxy credentials used for HTTP verification were deleted afterward.

Instrumental generation was executed; the other endpoint names were verified,
but their complete musical workflows were not exercised. YuE2 and SheetSage2
have not been deployed to Modal. Kiku's production web app still uses HF.

Raw measurements and WAVs are in `benchmark-results/`. `cold.json` and
`cold-warm-1.json` retain detailed model settings and revisions. The HF Space
revision tested was `a97e29a6a70718a4f09ce6030877baebeb1a4514`; its published
adapter confirmed the same checkpoint names, disabled compilation/Flash
Attention, PyTorch planner, and eight-step instrumental settings.

## CPU snapshot deployment

The deployment now captures Python imports, the 1.7B planner tokenizer, and its
precomputed constrained decoding processor in a CPU memory snapshot. CUDA model
loading and UI construction run after restore. The PyTorch planner, L40S GPU,
eight-step instrumental adapter, pinned weights, and scaling settings are the
same: minimum zero workers, maximum one, and the existing 120-second idle window.

| Direct method request | Caller wall time | Generation and output commit | Initialization after restore |
| --- | ---: | ---: | ---: |
| First snapshot creation | 102.07 s | 13.47 s | 12.84 s |
| Same worker, repeated call | 10.82 s | 5.04 s | — |
| New worker, saved snapshot restored | 38.89 s | 7.80 s | 17.71 s |
| Restored worker, repeated call | 8.06 s | 4.03 s | — |

The initial CPU preparation took 36.65 seconds and is stored in the snapshot.
It included 18.17 seconds of tokenizer loading and 2.05 seconds of decoding table
construction. This preparation did not repeat on the new worker. Modal's logs
confirmed snapshot creation on `ta-01M4MNNDN3PKDATE5YMW40E4ZR`, then restoration
without creation on `ta-01M4MNT132ZDQZK3R2NAJJEPGR`. The first worker was stopped
gracefully after its two completed calls, and the container listing was empty
before the restore benchmark. No deployment settings were changed for this test.

The worker ID changed from `1795f257f9164d0bab57fedf6591e2be` to
`6e15e5d955104bf3891222f51948c089`, while the two calls within each worker shared
their ID. Logs also confirmed reuse of the prepared tokenizer and decoding tables.
All four direct outputs passed stereo PCM, duration, and non-silence checks.

The measured restored cold request was **46.7% shorter** than the original
72.94-second cold request. This is one restored cold sample compared with one
baseline cold sample; allocation, storage, output commit, and transport vary.
Warm caller time did not improve in these samples. Snapshots address repeated
startup work. The first snapshot creation call was slower than the baseline.
Modal may create another snapshot for a different worker type or after deployment
changes, as described in its [snapshot documentation](https://modal.com/docs/guide/memory-snapshots).

The new `model_initialization_seconds` value counts work after restore; it
excludes CPU preparation and Modal restore/allocation, which the caller wall
time includes. Raw results are `snapshot-capture*.json`, `snapshot-restore*.json`,
and matching WAVs. `snapshot-capture.log` and `snapshot-restore.log` retain the
snapshot lifecycle evidence.

The restored worker also passed private HTTP verification: `/health` was ready,
all nine Gradio endpoint names remained present, and two `/instrumental` calls
returned valid 30-second stereo WAVs in 10.40 and 9.35 seconds including download.
The `/sample` planner endpoint returned a caption, instrumental lyrics, and parsed
metadata in 3.82 seconds using the restored tokenizer and decoding processor.
Anonymous access remained rejected with 401. The temporary proxy credential was
deleted after verification. These measurements are saved as `snapshot-web*.json`
and WAVs, including `snapshot-web-planner.json`.
