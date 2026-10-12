from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "outputs/kiku-engine-space"))
import scores
for path in (ROOT / "work/score-editor-proof").glob("*.abc"):
    score = scores.read(path.read_text())
    rewritten = scores.read(scores.write(score))
    assert score.vocal == rewritten.vocal and score.ins == rewritten.ins
    assert score.bars == rewritten.bars and score.chords == rewritten.chords
    assert not scores.vocal_to_ins(score).vocal
    print("PASS engine accepts edited score:", path.name)
