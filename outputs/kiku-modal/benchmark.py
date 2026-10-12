"""Call the deployed worker twice and retain timing measurements and audio."""
import argparse
from array import array
import io
import json
import math
import time
import wave
from pathlib import Path

import modal


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "benchmark-results")
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--label", default="cold")
    parser.add_argument("--calls", type=int, default=2)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    worker = modal.Cls.from_name("kiku-acestep15", "Engine", environment_name="main")()
    measurements = []
    for index in range(args.calls):
        started = time.perf_counter()
        with modal.enable_output():
            result = worker.benchmark.remote(
                "Warm acoustic pop instrumental, piano, clean guitar, bass and gentle drums, 100 BPM, no vocals",
                args.duration, 42,
            )
        elapsed = time.perf_counter() - started
        audio = result.pop("audio")
        # Check the real returned artifact, rather than trusting the endpoint's status.
        with wave.open(io.BytesIO(audio)) as wav:
            assert wav.getnframes() > 0 and wav.getnchannels() == 2
            assert abs(wav.getnframes() / wav.getframerate() - args.duration) < 2
            assert wav.getsampwidth() == 2
            samples = array("h", wav.readframes(wav.getnframes()))
            rms = math.sqrt(sum(float(value) ** 2 for value in samples) / len(samples)) / 32768
            assert rms > 0.0001, "Returned audio is silent"
        label = args.label if index == 0 else f"{args.label}-warm-{index}"
        audio_path = args.output / f"{label}.wav"
        audio_path.write_bytes(audio)
        metrics = result["metrics"]
        metrics.update({"label": label, "end_to_end_seconds": elapsed,
                        "audio_bytes": len(audio), "rms_dbfs": 20 * math.log10(rms),
                        "audio_file": str(audio_path.resolve())})
        measurements.append(metrics)
        (args.output / f"{label}.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        print(json.dumps({key: metrics[key] for key in (
            "label", "end_to_end_seconds", "generation_seconds",
            "model_initialization_seconds", "worker_id", "audio_seconds", "peak_allocated_gib",
        )}), flush=True)
    if len(measurements) > 1:
        assert len({item["worker_id"] for item in measurements}) == 1, "Warm calls used different workers"


if __name__ == "__main__":
    main()
