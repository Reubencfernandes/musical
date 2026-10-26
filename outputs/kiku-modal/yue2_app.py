"""The YuE2 Kiku adapter on a private, scale-to-zero L40S worker.

YuE2 runs as YuE2-Turbo (NoizAI's drop-in `yue2-infer` 0.1.6): the same pipeline
with its autoregressive stage on vLLM, which keeps a long-lived engine process and
so only fits here, not on ZeroGPU. Requests vLLM cannot serve (cot="off", CFG
other than 1) fall back to the original PyTorch path by themselves.
"""
import json
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "kiku-engine-space"
# github.com/NoizAI/YuE2-Turbo, pinned to the commit that was reviewed.
YUE2_TURBO = "yue2-infer[fast] @ git+https://github.com/NoizAI/YuE2-Turbo@7c88813bfff9db9127f11c35b9e1b72983ded200"
app = modal.App("kiku-yue2")
models = modal.Volume.from_name("kiku-yue2-models", create_if_missing=True)
results = modal.Volume.from_name("kiku-yue2-results", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "rubberband-cli", "libsndfile1", "gcc", "libglib2.0-0", "libnss3", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0", "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2", "libgbm1", "libasound2")
    .pip_install_from_requirements(str(ENGINE / "requirements.txt"))
    # Replaces the engine's yue2-infer 0.1.5 wheel; adds vllm 0.19.0 and triton 3.6.0.
    # vLLM needs pydantic >= 2.12 and would pull starlette 1.x; Gradio 5.50 is the
    # newest 5.x that takes that pydantic (<= 2.12.3) and it still needs starlette < 1.
    .pip_install(YUE2_TURBO, "gradio==5.50.0", "pydantic==2.12.3", "starlette<1.0")
    .run_commands("python -m playwright install --only-shell chromium")
    .env({"KIKU_RUNTIME": "modal", "KIKU_OUTPUT_ROOT": "/results", "HF_HOME": "/data/hf-cache",
          "TORCH_HOME": "/data/torch", "TOKENIZERS_PARALLELISM": "false", "GRADIO_ANALYTICS_ENABLED": "false",
          # The derived AR checkpoint and vLLM's compile cache live on the volume, so cold starts reuse them.
          "KIKU_YUE2_BACKEND": "vllm", "YUE2_CACHE": "/data/yue2-cache", "VLLM_CACHE_ROOT": "/data/vllm-cache"})
    .add_local_dir(ENGINE, "/opt/kiku", ignore=["**/__pycache__/**", "**/*.pyc", ".env*"])
    .add_local_file(HERE / "yue2-model-revisions.json", "/opt/model-revisions.json")
)


@app.function(image=image, volumes={"/data": models}, timeout=3600, cpu=2, memory=8192)
def prepare_models():
    from huggingface_hub import snapshot_download

    manifest = json.loads(Path("/opt/model-revisions.json").read_text())
    for entry in manifest:
        snapshot_download(entry["repo"], revision=entry["revision"], local_dir=entry["destination"],
                          allow_patterns=entry.get("allow_patterns"))
        models.commit()
    # Used only for recording-conditioned YuE2 jobs. Cache once on CPU too.
    snapshot_download("HeartMuLa/HeartTranscriptor-oss", revision="918f88917c17489c1f8dbae0165cd1019c4d5cd3")
    snapshot_download("m-a-p/SheetSage2", revision="eab522a8168e8b8b8c4856bf8609cd86198f01fe")
    from demucs.pretrained import get_model
    get_model("htdemucs")
    # vLLM serves the AR tensors from their own checkpoint; extract it once, on CPU.
    from yue2.fast import derive_ar_checkpoint
    derive_ar_checkpoint("/data/yue2")
    models.commit()
    return manifest


@app.cls(image=image, gpu="L40S", cpu=4, memory=32768, volumes={"/data": models, "/results": results},
         enable_memory_snapshot=True, min_containers=0, max_containers=1, scaledown_window=120,
         startup_timeout=900, timeout=1200)
@modal.concurrent(max_inputs=32)
class Engine:
    @modal.enter(snap=True)
    def prepare_snapshot(self):
        import sys
        started = time.perf_counter()
        sys.path.insert(0, "/opt/kiku")
        import torch
        import gradio
        import torchaudio_compat
        torchaudio_compat.apply()
        from yue2 import YuE2Pipeline
        import audio_tools
        self.snapshot_seconds = time.perf_counter() - started

    @modal.enter(snap=False)
    def load(self):
        from uuid import uuid4
        started = time.perf_counter()
        import app as kiku_engine
        self.engine = kiku_engine
        pipe = self.engine.yue2()
        if pipe.backend == "vllm":
            # Start the vLLM engine now rather than on the first song.
            from yue2.fast import preload_vllm
            preload_vllm(pipe)
        self.engine.spaces.after_call = results.commit
        self.worker_id = uuid4().hex
        self.load_seconds = time.perf_counter() - started

    @modal.method()
    def benchmark(self, prompt: str, lyrics: str, seed: int = 42):
        import torch
        import soundfile as sf
        with self.engine.spaces.lock:
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            status, audio, _, abc, used_seed, report = self.engine.song(prompt, lyrics, "full", seed, "")
            torch.cuda.synchronize()
            info = sf.info(audio)
            return {"audio": Path(audio).read_bytes(), "abc": abc, "report": report, "status": status,
                    "metrics": {"gpu": torch.cuda.get_device_name(), "model": "YuE2-Turbo", "backend": self.engine.yue2().backend,
                                "generation_seconds": time.perf_counter() - started,
                                "peak_allocated_gib": torch.cuda.max_memory_allocated() / 1024**3,
                                "audio_seconds": info.duration, "sample_rate": info.samplerate,
                                "channels": info.channels, "seed": used_seed, "cpu_snapshot_enabled": True}}

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        import gradio as gr
        import torch
        from fastapi import FastAPI
        # Serve committed originals instead of worker-local /tmp copies.
        gr.set_static_paths(paths=["/results"])
        api = FastAPI()

        @api.get("/health")
        def health():
            return {"ready": True, "model": "YuE2-Turbo", "gpu": torch.cuda.get_device_name(), "backend": self.engine.yue2().backend,
                    "worker_id": self.worker_id, "model_initialization_seconds": self.load_seconds,
                    "cpu_snapshot_enabled": True, "snapshot_preparation_seconds": self.snapshot_seconds,
                    "model_revisions": json.loads(Path("/opt/model-revisions.json").read_text())}

        return gr.mount_gradio_app(api, self.engine.demo.queue(max_size=8), path="/",
                                  allowed_paths=["/results"], blocked_paths=["/data", "/opt/kiku", "/root"],
                                  max_file_size="100mb", ssr_mode=False)


@app.local_entrypoint()
def prepare():
    print(json.dumps(prepare_models.remote(), indent=2))


@app.local_entrypoint()
def smoke(out: str = "yue2-smoke.wav"):
    """Sing one short song on a fresh worker; report the backend that ran and how long it took."""
    result = Engine().benchmark.remote(
        "upbeat indie pop, bright acoustic guitar, warm female vocal",
        "[verse]\nMorning light across the floor\nOpen up the kitchen door\n\n"
        "[chorus]\nSing it loud and sing it free\nThis is where I want to be\n", 42)
    Path(out).write_bytes(result["audio"])
    print(json.dumps({"status": result["status"], "metrics": result["metrics"], "report": result["report"]}, indent=2, default=str))
