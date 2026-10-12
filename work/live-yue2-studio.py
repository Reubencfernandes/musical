"""Smoke test the deployed YuE2 endpoints using a synthetic, owned score."""
from pathlib import Path
import json
import time
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import get_token
from gradio_client import Client
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "work/live-yue2-studio"
DEST.mkdir(exist_ok=True)
client = Client("Reubencf/Kiku-Engine", token=get_token(), verbose=False, download_files=str(DEST))
config = client.config
names = {d.get("api_name") for d in config["dependencies"]}
assert "plan_score" in names and "score_instrumental" in names
print("PASS live endpoint registration", flush=True)
def wait(job):
    last = ""
    while not job.done():
        status = job.status()
        message = str(status.code) + " " + str(status.progress_data)
        if message != last:
            print(message, flush=True)
            last = message
        time.sleep(5)
    return job.result()
result = wait(client.submit("solo piano, warm acoustic instrumental, C major, 96 BPM, eight bars",
                           "", 42, True, api_name="/plan_score"))
assert result[1].strip()
(DEST / "planned.abc").write_text(result[1])
print("PASS live musical draft:", result[0], result[2], flush=True)
score = (ROOT / "work/score-editor-proof/score.abc").read_text()
played = wait(client.submit("solo acoustic piano, intimate and gentle", score, 20, 42,
                           api_name="/score_instrumental"))
assert Path(played[1]).stat().st_size > 10000
(DEST / "played.abc").write_text(played[2])
(DEST / "report.json").write_text(played[4])
print("PASS live audio rendering:", played[0], played[4], "bytes", Path(played[1]).stat().st_size, flush=True)
