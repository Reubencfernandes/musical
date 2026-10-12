# Kiku music generation on Modal

Deployment of Kiku's existing ACE-Step 1.5 backend. The deployment
uses the same vendored model runtime and task adapters as `../kiku-acestep15-space`.
The web app routes ACE-Step 1.5 tasks through its authenticated `/api/modal/jobs`
route and downloads results through user-bound `/api/modal/file` tickets. Set
`MODAL_ENGINE_ORIGIN`, `MODAL_PROXY_KEY`, and `MODAL_PROXY_SECRET` on the frontend
server. YuE2 uses its own private `kiku-yue2` L40S worker, configured with
`MODAL_YUE2_ORIGIN` and the same server-only proxy credentials. Both Simple and
Custom on Generate allow choosing ACE-Step 1.5 or YuE2. Simple mode uses the
ACE-Step planner to write style and lyrics, then the chosen model makes the audio.
Standalone transcription, lyrics and stems still use Hugging Face.

The YuE2 worker reuses `../kiku-engine-space`'s song, instrumental, score planning,
cover and accompaniment adapters. It uses the native PyTorch backend, pinned
YuE2/VAE weights from `yue2-model-revisions.json`, separate persistent Volumes,
CPU import snapshots, zero minimum workers, one maximum worker and 120 idle
seconds before scale-down. YuE2 and its VAE are fetched on CPU before serving;
Whisper, SheetSage2 and Demucs are cached for recording-conditioned jobs.

```powershell
python -m modal run --env main outputs/kiku-modal/yue2_app.py::prepare
python -m modal deploy --env main outputs/kiku-modal/yue2_app.py
```

Private endpoint: `https://konkanillm--kiku-yue2-engine-web.modal.run`.
Model-bound encrypted download tickets ensure YuE2 results are fetched from
the YuE2 worker and only for the signed-in user who generated them.
Both workers serve committed `/results` originals directly, avoiding Gradio's
temporary file copies so tickets remain usable after a worker scales down.

The Modal app is `kiku-acestep15` in the `main` environment. One L40S GPU worker
loads Turbo, Base, their shared VAE/text encoder, and the 1.7B planner. It handles
one inference at a time, stays warm for up to 120 idle seconds, and scales to zero.
Model weights and generated files have separate persistent Volumes. Existing
outputs expire after 24 hours when another job triggers cleanup.

The deployment uses eight Turbo steps, SDPA attention, no compilation, and the
PyTorch planning backend. CPU memory snapshots capture Python imports, the
planner tokenizer, and its precomputed constrained decoding tables. CUDA model
loading and Gradio interface construction run after restore. Worker IDs are
also generated after restore so different workers remain distinguishable.

Snapshots are enabled with `enable_memory_snapshot=True` and separate
`@modal.enter(snap=True)` / `@modal.enter(snap=False)` hooks, following
[Modal's memory snapshot guide](https://modal.com/docs/guide/memory-snapshots).
The first request for a new deployment or worker type still performs snapshot
creation. Later compatible workers reuse it. No minimum worker count or longer
warm window has been added; the existing 120-second idle window is unchanged.

## Deploy and cache weights

Use Modal SDK 1.6.1 or a compatible newer version and an authenticated Modal profile.
From the repository root:

```powershell
python -m modal deploy outputs/kiku-modal/modal_app.py --env main
python -m modal run --env main outputs/kiku-modal/modal_app.py::prepare
python outputs/kiku-modal/benchmark.py --duration 30
```

On this Codex Desktop host, the working SDK is in the bundled Python interpreter:

```powershell
$taskPython = 'C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:PYTHONUTF8 = '1'
& $taskPython -m modal deploy outputs/kiku-modal/modal_app.py --env main
& $taskPython -m modal run --env main outputs/kiku-modal/modal_app.py::prepare
& $taskPython outputs/kiku-modal/benchmark.py --duration 30
```

The older `modal.exe` on this host is version 1.3.0.post1; prefer the module
invocation above. Preparation downloads the exact model revisions recorded in
`model-revisions.json` on a CPU worker, then commits them to the models Volume.
An initial download is installation work, distinct from a normal cold start.

## API and authentication

The deployment's private web URL is
`https://konkanillm--kiku-acestep15-engine-web.modal.run`.
Its dashboard is https://modal.com/apps/konkanillm/main/deployed/kiku-acestep15.
It serves the existing
Gradio endpoints, including `/song`, `/instrumental`, `/remix`, `/repaint`,
`/extend`, `/part`, `/accompany`, `/enhance`, and `/sample`. `/health` reports
the worker ID and model initialization time.

Modal proxy authentication is required. For a local smoke check, run
`python outputs/kiku-modal/verify_web.py`. This creates a temporary proxy token,
checks health and endpoint contracts, generates two clips over HTTP, then deletes
its own token in a `finally` block. Credential values are never printed or saved.
Production callers should use a Modal proxy token stored in their server's secret
configuration; never send it to browser code. The SDK 1.6.1 `modal curl` API-token
flow did not authenticate this Gradio Web Function in the verification run.
Use `--label snapshot-web --check-planner` to save separate results and exercise
the planner's `/sample` endpoint with its restored tokenizer and decoding tables.

Native CUDA requests use `native_gpu.py`, which preserves the decorated functions'
signatures, serializes access to shared model state, and commits successful
outputs. The existing Space still imports its regular `spaces` module unless
`KIKU_RUNTIME=modal` is explicitly set.

## Benchmark interpretation

`benchmark.py` calls the deployed Modal worker twice and saves WAVs and JSON
measurements under `benchmark-results`. It records generation time, model
initialization time, caller wall time, actual audio duration, peak GPU allocation,
and a worker ID to establish whether a repeated call used the same worker.
The first measurement is only a cold-start measurement if the worker has already
scaled to zero; use a fresh label for later runs.

With snapshots, `model_initialization_seconds` measures initialization after
restore, including CUDA model loading and UI construction. It excludes Modal's
snapshot restore and worker allocation; caller wall time includes those costs.
`snapshot_preparation_seconds` is the original CPU preparation duration stored
in the snapshot, not time spent preparing each restored worker. Preserve the
snapshot creation run under a distinct label when comparing cold starts.

`benchmark_zerogpu.py` submits the same prompt, length, eight-step configuration,
and seed twice to the existing HF Space. It uses the locally saved HF token and
saves the live Space revision. This timing includes the Gradio queue, GPU lease,
inference, and downloading the WAV; client setup is recorded separately.

Modal's direct-method caller time and Gradio's HTTP caller time use different
transports. Treat this as a small practical comparison, not a hardware benchmark.
A running ZeroGPU Space may already have its model initialized, whereas the
first Modal request after scale-to-zero must initialize it. Two samples do not
establish typical or worst-case queue latency.
