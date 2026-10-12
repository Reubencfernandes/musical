"""Check score reading, rewriting and every studio edit against YuE2's own examples."""
from fractions import Fraction
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scores
from abc_tools import compare, parse_abc

HERE = Path(__file__).resolve().parent / "fixtures"
failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + str(detail)))
    if not condition:
        failures.append(label)


for name in ("score", "score-jazz", "melody"):
    text = (HERE / (name + ".abc")).read_text(encoding="utf-8")
    print(name + ".abc")
    score = scores.read(text)
    again = scores.write(score)
    result = compare(parse_abc(text), parse_abc(again))
    check("rewrites without changing a note", result["match"], result["differences"])
    check("keeps the harmony", scores.read(again).chords == score.chords,
          (score.chords[:4], scores.read(again).chords[:4]))
    check("keeps the sections", [s for _, s in scores.sections(scores.read(again))] ==
          [s for _, s in scores.sections(score)])

    moved = scores.read(scores.write(scores.vocal_to_ins(score)))
    check("vocal_to_ins leaves the Vocal voice silent", not moved.vocal)
    check("vocal_to_ins keeps every sung note", all(n in moved.ins for n in score.vocal))

    band = scores.read(scores.write(scores.without_vocal(score)))
    check("without_vocal keeps chords only", not band.vocal and band.chords == score.chords)

    up = scores.read(scores.write(scores.transpose(score, 3)))
    check("transpose moves every note", [p for _, p, _ in up.vocal] == [p + 3 for _, p, _ in score.vocal])
    back = scores.read(scores.write(scores.transpose(up, -3)))
    check("transposing back restores the pitches", back.vocal == score.vocal and back.ins == score.ins)
    check("transposing back restores the chords (enharmonics aside)",
          [scores.PITCH_CLASS[scores.ROOT.match(s).group(1)] for _, s in back.chords] ==
          [scores.PITCH_CLASS[scores.ROOT.match(s).group(1)] for _, s in score.chords])

    fast = scores.read(scores.write(scores.with_tempo(score, 120)))
    check("tempo change keeps the notes", fast.bpm == 120 and fast.vocal == score.vocal)

    if score.chords:
        edited = scores.read(scores.write(scores.with_bar_chords(score, {1: ["Dm7", "G7"]})))
        check("bar chords replaced and spread", scores.bar_chords(edited, 1) == ["Dm7", "G7"],
              scores.bar_chords(edited, 1))
        check("the next bar keeps its harmony", scores.bar_chords(edited, 2) == scores.bar_chords(score, 2),
              (scores.bar_chords(edited, 2), scores.bar_chords(score, 2)))
        check("melody untouched by a chord edit", edited.vocal == score.vocal)
    check("lyric tags follow the sections", scores.lyric_tags(score).startswith("["), scores.lyric_tags(score))
    check("a bar profile is normalised", abs(float((scores.profile(score, 0) ** 2).sum()) - 1) < 1e-6)

print("\nlyrics")
score = scores.read((HERE / "score.abc").read_text(encoding="utf-8"))
per_bar = score.seconds(score.bars[0].length)
clock = [i * per_bar for i in range(len(score.bars) + 1)]
chorus_at = clock[next(i for i, b in enumerate(score.bars) if "chorus" in b.sections)]
lines = [{"start": 0.5, "end": 2.0, "text": "first verse line"},
         {"start": chorus_at + 0.5, "end": chorus_at + 2.0, "text": "first chorus line"}]
text = scores.lyrics_by_time(lines, score, clock)
check("transcribed lines land in the section they were sung in",
      text.index("[Verse]") < text.index("first verse line") < text.index("[Chorus]") < text.index("first chorus line"),
      text)
spread = scores.lyrics_by_notes("one\ntwo\nthree\nfour", score)
check("untagged lyrics are spread over the sung sections", spread.count("[") == len(scores.sections(score))
      and all(w in spread for w in ("one", "four")), spread)
check("tagged lyrics are left alone", scores.lyrics_by_notes("[Chorus]\nla la", score) == "[Chorus]\nla la\n")
at = scores.time_of(score, [0.0, 2.0, 5.0] + [5.0 + 3 * i for i in range(1, len(score.bars) - 1)])
check("time_of follows an uneven bar clock", abs(at(score.bars[1].start + score.bars[1].length / 2) - 3.5) < 1e-9)
check("key_words names the mode", scores.key_words("F#m") == "F# minor" and scores.key_words("Bb") == "Bb major")

print("\nshift_chord")
check("F#m7 up 2 is G#m7", scores.shift_chord("F#m7", 2) == "G#m7")
check("G/B down 2 with flats is F/A", scores.shift_chord("G/B", -2, sharp=False) == "F/A")
print("\n" + ("ALL CHECKS PASSED" if not failures else "FAILED: " + ", ".join(failures)))
sys.exit(1 if failures else 0)
