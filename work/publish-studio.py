"""Publish the reviewed studio changes, preserving existing secrets and remote assets."""
import os
import sys
from pathlib import Path
try:
    import truststore
except ImportError:
    from pip._vendor import truststore
truststore.inject_into_ssl()
from huggingface_hub import HfApi
ROOT = Path(__file__).resolve().parents[1]
api = HfApi(token=os.environ.get("HF_TOKEN"))
print("Publishing as", api.whoami()["name"], flush=True)
for name, folder in [("Kiku-Engine", "kiku-engine-space"), ("Kiku-ACE-Step-15", "kiku-acestep15-space"), ("Kiku-AI", "kiku-ai")]:
    if sys.argv[1:] and name not in sys.argv[1:]:
        continue
    commit = api.upload_folder(repo_id="Reubencf/" + name, repo_type="space",
        folder_path=str(ROOT / "outputs" / folder),
        ignore_patterns=["node_modules/**", ".next/**", ".env*", "*.tsbuildinfo",
                         "__pycache__/**", "*.pyc", ".git/**", "data/**"],
        commit_message="Add reviewed scores, three cover modes, YuE2 planning and take auditions")
    print(name, commit.oid, flush=True)
