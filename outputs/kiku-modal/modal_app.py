"""Kiku's existing ACE-Step 1.5 engine on a private, scale-to-zero Modal worker."""
import json
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "kiku-acestep15-space"
APP_NAME = "kiku-acestep15"
app = modal.App(APP_NAME)
models = modal.Volume.from_name("kiku-acestep15-models", create_if_missing=True)
results = modal.Volume.from_name("kiku-acestep15-results", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "rubberband-cli", "libsndfile1", "gcc")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .env({
        "KIKU_RUNTIME": "modal",
        "KIKU_OUTPUT_ROOT": "/results",
        "HF_HOME": "/data/hf-cache",
        "TOKENIZERS_PARALLELISM": "false",
        "GRADIO_ANALYTICS_ENABLED": "false",
    })
    .add_local_dir(
        ENGINE, "/opt/kiku",
        ignore=["**/__pycache__/**", "**/*.pyc", "data/**", "checkpoints/**", ".env*"],
    )
    .add_local_file(HERE / "model-revisions.json", "/opt/model-revisions.json")
)


@app.function(image=image, volumes={"/data": models}, timeout=1800, cpu=2, memory=8192)
def prepare_models():
    """Download pinned weights once on a CPU worker, outside startup measurements."""
    from huggingface_hub import snapshot_download

    manifest = json.loads(Path("/opt/model-revisions.json").read_text())
    for entry in manifest:
        snapshot_download(
            entry["repo"], revision=entry["revision"],
            local_dir=entry["destination"], allow_patterns=entry.get("allow_patterns"),
        )
        models.commit()
    return manifest


@app.cls(
    image=image,
    gpu="L40S",
    cpu=4,
    memory=32768,
    volumes={"/data": models, "/results": results},
    enable_memory_snapshot=True,
    min_containers=0,
    max_containers=1,
    scaledown_window=120,
    startup_timeout=900,
    timeout=1200,
)
@modal.concurrent(max_inputs=32)
class Engine:
    @modal.enter(snap=True)
    def prepare_snapshot(self):
        """Capture imports and CPU decoding state without initializing CUDA."""
        import sys

        started = time.perf_counter()
        sys.path.insert(0, "/opt/kiku")
        import gradio
        import audio_tools
        from fastapi import FastAPI
        from acestep.handler import AceStepHandler
        from acestep import inference
        from acestep.llm_inference import LLMHandler

        self.prepared_lm = LLMHandler(persistent_storage_path="/data")
        self.prepared_lm.prepare_tokenizer("/data/checkpoints", "acestep-5Hz-lm-1.7B")
        self.snapshot_preparation_seconds = time.perf_counter() - started
        print(f"Kiku CPU snapshot preparation: {self.snapshot_preparation_seconds:.3f}s", flush=True)

    @modal.enter(snap=False)
    def load(self):
        from uuid import uuid4

        started = time.perf_counter()
        import native_gpu
        native_gpu.prepared_lm = self.prepared_lm
        import app as kiku_engine

        if kiku_engine.lm is not self.prepared_lm:
            raise RuntimeError("The engine did not reuse snapshot decoding state")
        if not kiku_engine.lm.llm_initialized:
            raise RuntimeError("ACE-Step's planning model failed to initialize")
        self.engine = kiku_engine
        self.engine.spaces.after_call = results.commit
        self.worker_id = uuid4().hex
        self.load_seconds = time.perf_counter() - started
        print(f"Kiku initialization after CPU snapshot restore: {self.load_seconds:.3f}s", flush=True)

    @modal.method()
    def benchmark(self, prompt: str, duration: float = 30, seed: int = 42):
        """Generate through the exact Kiku instrumental adapter and return a WAV."""
        import torch
        import soundfile as sf

        with self.engine.spaces.lock:
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            status, path = self.engine.instrumental(prompt, "", duration, 8, 7, seed)
            torch.cuda.synchronize()
            seconds = time.perf_counter() - started
            info = sf.info(path)
            return {
                "audio": Path(path).read_bytes(),
                "metrics": {
                    "status": status,
                    "generation_seconds": seconds,
                    "model_initialization_seconds": self.load_seconds,
                    "cpu_snapshot_enabled": True,
                    "snapshot_preparation_seconds": self.snapshot_preparation_seconds,
                    "worker_id": self.worker_id,
                    "gpu": torch.cuda.get_device_name(),
                    "peak_allocated_gib": torch.cuda.max_memory_allocated() / 1024**3,
                    "audio_seconds": info.duration,
                    "sample_rate": info.samplerate,
                    "channels": info.channels,
                    "seed": seed,
                    "prompt": prompt,
                    "steps": 8,
                    "planner_backend": "pt",
                    "compile_model": False,
                    "model_revisions": json.loads(Path("/opt/model-revisions.json").read_text()),
                },
            }

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        import gradio as gr
        from fastapi import FastAPI
        # Keep file tickets usable after this worker scales to zero.
        gr.set_static_paths(paths=["/results"])

        api = FastAPI()

        @api.get("/health")
        def health():
            return {
                "ready": True, "model": "ACE-Step 1.5", "gpu": "L40S",
                "worker_id": self.worker_id, "model_initialization_seconds": self.load_seconds,
                "cpu_snapshot_enabled": True,
                "snapshot_preparation_seconds": self.snapshot_preparation_seconds,
            }

        return gr.mount_gradio_app(
            api, self.engine.demo.queue(max_size=8), path="/",
            allowed_paths=["/results"], blocked_paths=["/data", "/opt/kiku", "/root"],
            max_file_size="100mb", ssr_mode=False,
        )


@app.local_entrypoint()
def prepare():
    print(json.dumps(prepare_models.remote(), indent=2))
