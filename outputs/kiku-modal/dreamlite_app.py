"""Private DreamLite-base album artwork for Kiku's non-commercial deployment."""
import io
import json
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
app = modal.App("kiku-dreamlite")
models = modal.Volume.from_name("kiku-dreamlite-models", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(str(HERE / "dreamlite-requirements.txt"))
    .env({"HF_HOME": "/data/hf-cache", "TOKENIZERS_PARALLELISM": "false"})
    .add_local_file(HERE / "dreamlite-model.json", "/opt/dreamlite-model.json")
)


@app.function(image=image, volumes={"/data": models}, timeout=1800, cpu=2, memory=8192)
def prepare_models():
    from huggingface_hub import snapshot_download
    manifest = json.loads(Path("/opt/dreamlite-model.json").read_text())
    snapshot_download(manifest["repo"], revision=manifest["revision"], local_dir="/data/dreamlite")
    models.commit()
    return manifest


@app.cls(image=image, gpu="L40S", cpu=4, memory=16384, volumes={"/data": models},
         enable_memory_snapshot=True, min_containers=0, max_containers=1,
         scaledown_window=120, startup_timeout=600, timeout=600)
@modal.concurrent(max_inputs=8)
class Artwork:
    @modal.enter(snap=True)
    def prepare_snapshot(self):
        started = time.perf_counter()
        import torch
        from diffusers import DreamLitePipeline
        from transformers import Qwen3VLForConditionalGeneration
        from PIL import Image
        from fastapi import FastAPI
        self.snapshot_seconds = time.perf_counter() - started

    @modal.enter(snap=False)
    def load(self):
        import torch
        from diffusers import DreamLitePipeline
        from threading import Lock
        from uuid import uuid4
        self.pipe = DreamLitePipeline.from_pretrained(
            "/data/dreamlite", dtype=torch.bfloat16, local_files_only=True,
        ).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        self.lock = Lock()
        self.worker_id = uuid4().hex

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        import secrets
        import torch
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import Response
        api = FastAPI()

        @api.get("/health")
        def health():
            return {"ready": True, "model": "DreamLite-base", "gpu": torch.cuda.get_device_name(),
                    "worker_id": self.worker_id, "cpu_snapshot_enabled": True,
                    "snapshot_preparation_seconds": self.snapshot_seconds,
                    "model_revision": json.loads(Path("/opt/dreamlite-model.json").read_text())["revision"]}

        @api.post("/generate")
        async def generate(request: Request):
            if int(request.headers.get("content-length", "0")) > 16000:
                raise HTTPException(413, "Prompt too large")
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 16000:
                    raise HTTPException(413, "Prompt too large")
            try:
                prompt = json.loads(body).get("prompt", "")
            except (ValueError, AttributeError):
                raise HTTPException(400, "Invalid prompt")
            if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2200:
                raise HTTPException(400, "Invalid prompt")
            seed = secrets.randbelow(2**31)
            # Keep health and client connections responsive while GPU work is serialized.
            from starlette.concurrency import run_in_threadpool

            def render():
                with self.lock, torch.inference_mode():
                    started = time.perf_counter()
                    artwork = self.pipe(prompt=prompt.strip(), negative_prompt="text, letters, watermark, logo, blurry, low quality",
                                        width=1024, height=1024, num_inference_steps=28,
                                        guidance_scale=3.5, generator=torch.Generator("cpu").manual_seed(seed)).images[0]
                    output = io.BytesIO()
                    artwork.convert("RGB").resize((512, 512)).save(output, format="WEBP", quality=88)
                    print(f"DreamLite generated 512px cover in {time.perf_counter()-started:.2f}s; GPU={torch.cuda.get_device_name()}", flush=True)
                    return output.getvalue()

            data = await run_in_threadpool(render)
            return Response(data, media_type="image/webp", headers={"X-Cover-Seed": str(seed), "Cache-Control": "no-store"})

        return api


@app.local_entrypoint()
def prepare():
    print(json.dumps(prepare_models.remote()))
