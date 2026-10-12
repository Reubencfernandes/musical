"""Audition and accepted stems must reproduce the same headroom-safe mixture."""
import ast
from pathlib import Path
from types import SimpleNamespace
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
for folder in ["kiku-engine-space", "kiku-acestep15-space"]:
    tree = ast.parse((ROOT / "outputs" / folder / "audio_tools.py").read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "mix")
    saved = []
    scope = {"np": np, "SR": 48000, "QUIETEST": 0.01,
        "to_stereo": lambda a, sr: a,
        "loudness": lambda a, sr: float(np.sqrt(np.mean(a*a))),
        "sf": SimpleNamespace(write=lambda path, audio, *a, **k: saved.append(audio.T))}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "audio_tools.py", "exec"), scope)
    t = np.arange(48000) / 48000
    voice = np.tile(0.9*np.sin(2*np.pi*220*t), (2, 1))
    drums = np.tile(0.3*np.sin(2*np.pi*60*t), (2, 1))
    bass = np.tile(0.2*np.sin(2*np.pi*110*t), (2, 1))
    keys = np.tile(0.1*np.sin(2*np.pi*440*t), (2, 1))
    report = {}
    scope["mix"](voice, drums+bass+keys, "unused.flac", report=report)
    levels = report["mix"]
    reproduced = voice*levels["vocal"] + (drums+bass+keys)*levels["backing"]
    np.testing.assert_allclose(reproduced, saved[0], atol=1e-7)
    assert np.max(np.abs(reproduced)) <= 0.9900001
    np.testing.assert_allclose(voice*levels["vocal"]/levels["vocal"], voice)
    print("PASS original vocal and separate parts reproduce audition mix:", folder)
