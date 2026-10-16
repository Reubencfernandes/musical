"""The YuE2 Kiku adapter on a private, scale-to-zero L40S worker."""
import json
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "kiku-engine-space"
app = modal.App("kiku-yue2")
models = modal.Volume.from_name("kiku-yue2-models", create_if_missing=True)
results = modal.Volume.from_name("kiku-yue2-results", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "rubberband-cli", "libsndfile1", "gcc", "libglib2.0-0", "libnss3", "libatk1.0-0", "libatk-bridge2.0-0", "libcups2", "libdrm2", "libxkbcommon0", "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2", "libgbm1", "libasound2")
    .pip_install_from_requirements(str(ENGINE / "requirements.txt"))
    .run_commands("python -m playwright install --only-shell chromium")
    .env({"KIKU_RUNTIME": "modal", "KIKU_OUTPUT_ROOT": "/results", "HF_HOME": "/data/hf-cache",
          "TORCH_HOME": "/data/torch", "TOKENIZERS_PARALLELISM": "false", "GRADIO_ANALYTICS_ENABLED": "false"})
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
        self.engine.yue2()
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
                    "metrics": {"gpu": torch.cuda.get_device_name(), "model": "YuE2", "backend": "torch",
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
            return {"ready": True, "model": "YuE2", "gpu": torch.cuda.get_device_name(), "backend": "torch",
                    "worker_id": self.worker_id, "model_initialization_seconds": self.load_seconds,
                    "cpu_snapshot_enabled": True, "snapshot_preparation_seconds": self.snapshot_seconds,
                    "model_revisions": json.loads(Path("/opt/model-revisions.json").read_text())}

        return gr.mount_gradio_app(api, self.engine.demo.queue(max_size=8), path="/",
                                  allowed_paths=["/results"], blocked_paths=["/data", "/opt/kiku", "/root"],
                                  max_file_size="100mb", ssr_mode=False)


@app.local_entrypoint()
def prepare():
    print(json.dumps(prepare_models.remote(), indent=2))
