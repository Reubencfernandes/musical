"""Create and push the Kiku Engine and ACE-Step 1.5 Spaces.

Usage (PowerShell):
    $env:HF_TOKEN = "hf_your_new_token"
    python work/deploy_kiku_spaces.py

The token is read from the environment, or from a `hf auth login` on this machine,
and never written to disk. Re-running is
safe: the Spaces are created with exist_ok and the folders are re-uploaded.
"""
import os
import sys
from pathlib import Path

# Some machines inspect HTTPS with a root certificate that lives in the OS store
# but not in certifi's bundle. Verify against the OS store when it is available;
# verification itself is never turned off.
try:
    import truststore
except ImportError:
    try:
        from pip._vendor import truststore
    except ImportError:
        truststore = None
if truststore:
    truststore.inject_into_ssl()

from huggingface_hub import HfApi


OWNER = "Reubencf"
ROOT = Path(__file__).resolve().parent.parent / "outputs"
# ZeroGPU is still identified as "zero-a10g" even though it now runs on
# RTX Pro 6000 Blackwell; the enum value was kept for compatibility.
HARDWARE = "zero-a10g"
# One Gradio Space holds every model; ZeroGPU supports no other SDK, so the
# Next.js interface deploys separately with deploy_kiku_app.py.
# ACE-Step 1.5 needs Python 3.11, Gradio 6 and torch 2.9, which cannot share the
# engine's YuE2 stack, so it is a second Space with the same endpoint names.
SPACES = [
    ("Kiku-Engine", ROOT / "kiku-engine-space"),
    ("Kiku-ACE-Step-15", ROOT / "kiku-acestep15-space"),
    # Z-Image Turbo song artwork, in its own Space so its diffusers/torch stack stays separate.
    ("Kiku-Art", ROOT / "kiku-art-space"),
]
# Build artefacts and local test scratch never belong in a Space.
IGNORE = ["__pycache__/*", "*.pyc", ".ipynb_checkpoints/*", "*.wav", "*.flac", "data/*"]


def main():
    api = HfApi(token=os.environ.get("HF_TOKEN"))
    try:
        who = api.whoami()
    except Exception as exc:
        sys.exit("Could not sign in to Hugging Face (%s). Set HF_TOKEN or run `hf auth login`: "
                 "https://huggingface.co/settings/tokens" % exc)
    print("Signed in as %s" % who.get("name"))

    for name, folder in [s for s in SPACES if not sys.argv[1:] or s[0] in sys.argv[1:]]:
        if not folder.is_dir():
            sys.exit("Missing folder: %s" % folder)
        if not (folder / "app.py").is_file():
            sys.exit("No app.py in %s" % folder)
        repo_id = "%s/%s" % (OWNER, name)
        print("\n--- %s ---" % repo_id)
        # Asking for ZeroGPU again on an existing Space is refused once the account
        # is at its ZeroGPU Space limit, so only new Spaces are created.
        if not api.repo_exists(repo_id, repo_type="space"):
            api.create_repo(repo_id, repo_type="space", space_sdk="gradio",
                            space_hardware=HARDWARE, private=False)
            print("  Created on %s" % HARDWARE)
        api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(folder),
                          ignore_patterns=IGNORE,
                          commit_message="Deploy %s" % name)
        print("  Uploaded %s" % folder.name)
        print("  https://huggingface.co/spaces/%s" % repo_id)

    print("\nThe Space is building. The first build is slow: it installs three model"
          " stacks and pre-fetches several GB of weights, so expect roughly 10-20"
          " minutes. Watch the build log on the Space page above.")
    print("\nIf a Space shows CPU instead of ZeroGPU, set it under Settings > Hardware.")


if __name__ == "__main__":
    main()
