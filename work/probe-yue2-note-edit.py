"""CPU-only feasibility check for a future note editor; no model inference."""
from dataclasses import replace
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "outputs" / "kiku-engine-space"
sys.path.insert(0, str(ENGINE))
import scores

original = scores.read((ENGINE / "fixtures" / "score.abc").read_text(encoding="utf-8"))
onset, pitch, duration = original.vocal[0]
changed = (onset, pitch + 2, duration / 2)
draft = replace(original, vocal=[changed, *original.vocal[1:]])
native = scores.write(draft)
restored = scores.read(native)

checks = {
    "requested_pitch_and_duration_survive_serialization": restored.vocal[0] == changed,
    "other_vocal_notes_unchanged": restored.vocal[1:] == original.vocal[1:],
    "instrumental_melody_unchanged": restored.ins == original.ins,
    "chords_unchanged": restored.chords == original.chords,
    "tempo_unchanged": restored.bpm == original.bpm,
    "bars_keys_meters_sections_unchanged": restored.bars == original.bars,
}
if not all(checks.values()):
    raise AssertionError(checks)

destination = ROOT / "work" / "yue2-note-edit-proof"
destination.mkdir(parents=True, exist_ok=True)
(destination / "edited-score.abc").write_text(native, encoding="utf-8")
report = {
    "scope": "Native score edit and round-trip only; no generated-audio claim",
    "source": "Kiku engine fixture score.abc",
    "original_note": [str(onset), pitch, str(duration)],
    "edited_note": [str(changed[0]), changed[1], str(changed[2])],
    "checks": checks,
}
(destination / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
