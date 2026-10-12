"""Verify published source, running containers and public route boundaries."""
from pathlib import Path
import hashlib
import json
import urllib.request
import urllib.error
from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi
ROOT = Path(__file__).resolve().parents[1]
api = HfApi()
expected = {"Kiku-Engine": "ffe9044f8842d4c1b1cabe0946e5ef3a29f734fa",
            "Kiku-ACE-Step-15": "6bcab7ed2ae1007d20e9b0a2ec72596c9214737c"}
files = {"Kiku-AI": ("kiku-ai", ["components/studio/AIPanel.tsx", "components/studio/ComposerSelect.tsx", "components/studio/ScoreEditor.tsx", "components/studio/useJobs.ts", "app/studio.css", "app/api/plan/route.ts"]),
         "Kiku-Engine": ("kiku-engine-space", ["app.py", "audio_tools.py"]),
         "Kiku-ACE-Step-15": ("kiku-acestep15-space", ["app.py", "audio_tools.py"])}
for name, (folder, paths) in files.items():
    info = api.space_info("Reubencf/"+name)
    assert info.runtime.stage == "RUNNING", (name, info.runtime.stage)
    if name in expected:
        assert info.sha == expected[name]
    for path in paths:
        url = "https://huggingface.co/spaces/Reubencf/%s/raw/%s/%s" % (name, info.sha, path)
        with urllib.request.urlopen(url, timeout=30) as response:
            remote = response.read()
        local = (ROOT / "outputs" / folder / path).read_bytes()
        assert remote == local, (name, path, "published source differs")
    print("PASS", name, info.sha, "RUNNING; source matches", flush=True)
origin="https://reubencf-kiku-ai.hf.space"
with urllib.request.urlopen(origin+"/studio", timeout=30) as response:
    assert response.status == 200
for route in ["plan", "instrumental", "cover", "accompany"]:
    request=urllib.request.Request(origin+"/api/"+route, data=b"{}", headers={"Origin":origin,"Content-Type":"application/json"})
    try:
        urllib.request.urlopen(request, timeout=20)
        raise AssertionError("Anonymous GPU call allowed")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401, (route, exc.code)
        print("PASS anonymous production GPU request rejected:", route, flush=True)
with urllib.request.urlopen("https://reubencf-kiku-engine.hf.space/config", timeout=30) as response:
    config=json.load(response)
names={d.get("api_name"):d for d in config["dependencies"]}
assert "plan_score" in names and "score_instrumental" in names
assert len(names["restage"]["outputs"])==6 and len(names["song"]["outputs"])==6
print("PASS live Gradio endpoint contracts", flush=True)
