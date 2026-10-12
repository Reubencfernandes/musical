"""Verify the private Gradio API with a temporary Modal proxy token."""
import argparse
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from uuid import uuid4

from pip._vendor import truststore
truststore.inject_into_ssl()
import modal

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "work" / "hf-deploy-deps"))
from gradio_client import Client

URL = "https://konkanillm--kiku-acestep15-engine-web.modal.run"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="modal-web")
    parser.add_argument("--check-planner", action="store_true")
    args = parser.parse_args()
    output = Path(__file__).parent / "benchmark-results"
    output.mkdir(exist_ok=True)
    try:
        urllib.request.urlopen(URL + "/health", timeout=30)
        raise AssertionError("Unauthenticated access was allowed")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    workspace = modal.Workspace.from_context()
    token = workspace.proxy_tokens.create(name="kiku-verification-" + uuid4().hex[:8])
    try:
        headers = {"Modal-Key": token.token_id, "Modal-Secret": token.token_secret}
        request = urllib.request.Request(URL + "/health", headers=headers)
        with urllib.request.urlopen(request, timeout=180) as response:
            health = json.load(response)
        assert health["ready"]
        print(json.dumps({"health": health, "anonymous_status": 401}), flush=True)
        # Explicitly disable HF credentials when calling the Modal URL.
        client = Client(URL, token=False, headers=headers, verbose=False,
                        analytics_enabled=False)
        names = {item.get("api_name") for item in client.config["dependencies"]}
        expected = {"song", "instrumental", "remix", "repaint", "extend", "part", "accompany", "enhance", "sample"}
        assert expected <= names, names
        (output / f"{args.label}-config.json").write_text(json.dumps(client.config, indent=2), encoding="utf-8")
        for index in range(2):
            started = time.perf_counter()
            status, path = client.submit(
                "Warm acoustic pop instrumental, piano, clean guitar, bass and gentle drums, 100 BPM, no vocals",
                "", 30, 8, 7, 42, api_name="/instrumental",
            ).result(timeout=300)
            elapsed = time.perf_counter() - started
            label = f"{args.label}-{index + 1}"
            destination = output / f"{label}.wav"
            shutil.copyfile(path, destination)
            with wave.open(str(destination)) as wav:
                duration = wav.getnframes() / wav.getframerate()
                assert abs(duration - 30) < 2 and wav.getnchannels() == 2
            metrics = {"label": label, "end_to_end_seconds": elapsed, "status": status,
                        "audio_seconds": duration, "health": health,
                        "audio_file": str(destination.resolve()), "seed": 42, "steps": 8}
            (output / f"{label}.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
            print(json.dumps(metrics), flush=True)
        if args.check_planner:
            started = time.perf_counter()
            status, caption, lyrics, raw_metadata = client.submit(
                "A 30 second acoustic pop instrumental with piano and gentle drums at 100 BPM",
                True, "en", api_name="/sample",
            ).result(timeout=300)
            assert status == "Written" and caption.strip() and lyrics.strip()
            metadata = json.loads(raw_metadata)
            assert isinstance(metadata, dict)
            planner = {"status": status, "caption": caption, "lyrics": lyrics,
                       "metadata": metadata, "health": health,
                       "end_to_end_seconds": time.perf_counter() - started}
            (output / f"{args.label}-planner.json").write_text(
                json.dumps(planner, indent=2), encoding="utf-8",
            )
            print(json.dumps({"planner_status": status,
                              "end_to_end_seconds": planner["end_to_end_seconds"]}), flush=True)
    finally:
        workspace.proxy_tokens.delete(token.token_id)
        print("Temporary verification credential removed", flush=True)


if __name__ == "__main__":
    main()
