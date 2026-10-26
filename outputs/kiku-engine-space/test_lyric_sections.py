"""Section tags for transcribed lyrics: where the singing is and what each part is."""
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lyric_sections as ls

failures = []


def check(label, condition, detail=""):
    print(("  PASS  " if condition else "  FAIL  ") + label + ("" if condition else " -> " + str(detail)))
    if not condition:
        failures.append(label)


def tone(seconds, sr):
    t = np.arange(int(seconds * sr)) / sr
    return 0.4 * np.sin(2 * np.pi * 220 * t)


def silence(seconds, sr):
    return np.zeros(int(seconds * sr))


print("sung_spans")
SR = 16000
mono = np.concatenate([silence(5, SR), tone(3, SR), silence(0.4, SR), tone(3, SR),
                       silence(8, SR), tone(40, SR), silence(3, SR), tone(0.2, SR), silence(2, SR)])
spans = ls.sung_spans(mono, SR)
check("starts after the intro", abs(spans[0][0] - 5) < 0.2, spans)
check("a short breath stays inside one stretch", abs(spans[0][1] - 11.4) < 0.2, spans)
check("a long stretch is cut to fit the transcriber", all(e - s <= ls.WINDOW + 0.01 for s, e in spans), spans)
check("the long stretch is covered end to end", abs(spans[-1][1] - 59.4) < 0.2, spans)
check("a blip is not singing", len(spans) == 3, spans)

print("lines_of")
check("splits at capitals, keeps I", ls.lines_of("I was there and I knew Then the rain came down")
      == ["I was there and I knew", "Then the rain came down"])

check("Japanese splits at phrase spaces", ls.lines_of("地球の裏側は まだ昨日だから 今走れば 間に合うかな")
      == ["地球の裏側は", "まだ昨日だから", "今走れば", "間に合うかな"], ls.lines_of("地球の裏側は まだ昨日だから 今走れば 間に合うかな"))
check("mixed text keeps the capital rule", ls.lines_of("Hello 世界 Goodbye moon") == ["Hello 世界", "Goodbye moon"])

print("sections")
VERSE1 = "Walking down the empty road Counting every stone"
VERSE2 = "Paper boats along the stream Drifting like a dream"
CHORUS = "Sing it loud and sing it free This is where I want to be"
BRIDGE = "Every light goes out tonight Hold me till the morning"
heard = [((6, 14), VERSE1), ((14.5, 22), CHORUS), ((23, 31), VERSE2), ((31.5, 39), CHORUS),
         ((47, 55), BRIDGE), ((55.5, 63), CHORUS)]
text = ls.sections(heard, 70)
print(text)
tags = [line for line in text.splitlines() if line.startswith("[")]
check("labels a verse/chorus song", tags == ["[intro]", "[verse]", "[chorus]", "[verse]", "[chorus]",
                                             "[inst]", "[bridge]", "[chorus]", "[outro]"], tags)
check("keeps every line", text.count("Sing it loud") == 3 and "Counting every stone" in text)
check("no intro when singing starts at once", not ls.sections([((0.5, 8), VERSE1)], 9).startswith("[intro]"))
check("words never repeated are one verse",
      ls.sections([((0, 8), VERSE1), ((9, 16), VERSE2)], 16) == "[verse]\n" + "\n".join(
          ls.lines_of(VERSE1) + ls.lines_of(VERSE2)) + "\n")
check("nothing sung gives nothing", ls.sections([((0, 2), "")], 5) == "")

if failures:
    sys.exit("%d failed" % len(failures))
print("all passed")
