"""Record the live ZeroGPU endpoint's latency for the same instrumental request."""
import json
import shutil
import sys
import time
import wave
from pathlib import Path

from pip._vendor import truststore
truststore.inject_into_ssl()

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "work" / "hf-deploy-deps"))
from gradio_client import Client
from huggingface_hub import HfApi, get_token


def main():
    output = Path(__file__).parent / "benchmark-results"
    output.mkdir(exist_ok=True)
    info = HfApi().space_info("Reubencf/Kiku-ACE-Step-15")
    started = time.perf_counter()
    client = Client("Reubencf/Kiku-ACE-Step-15", token=get_token(), verbose=False)
    setup_seconds = time.perf_counter() - started
    for index in range(2):
        started = time.perf_counter()
        label = f"zerogpu-{index + 1}"
        metadata = {"label": label, "space_revision": info.sha,
                    "space_stage_before_test": info.runtime.stage,
                    "client_setup_seconds": setup_seconds, "duration_requested": 30,
                    "seed": 42, "steps": 8}
        try:
            job = client.submit(
                "Warm acoustic pop instrumental, piano, clean guitar, bass and gentle drums, 100 BPM, no vocals",
                "", 30, 8, 7, 42, api_name="/instrumental",
            )
            status, path = job.result(timeout=300)
            metadata["end_to_end_seconds"] = time.perf_counter() - started
            metadata["status"] = status
            destination = output / f"{label}.wav"
            shutil.copyfile(path, destination)
            with wave.open(str(destination)) as wav:
                metadata["audio_seconds"] = wav.getnframes() / wav.getframerate()
                assert wav.getnframes() > 0 and abs(metadata["audio_seconds"] - 30) < 2
            metadata["audio_file"] = str(destination.resolve())
        except Exception as exc:
            metadata.update(error=str(exc), end_to_end_seconds=time.perf_counter() - started)
            (output / f"{label}.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
            print(json.dumps(metadata), flush=True)
            break
        (output / f"{label}.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        print(json.dumps(metadata), flush=True)


if __name__ == "__main__":
    main()
