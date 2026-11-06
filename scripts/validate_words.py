"""Validate The Manipulator's curated word database before release."""
import json
from collections import Counter
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "backend" / "game" / "database" / "words.json"
words = json.loads(path.read_text(encoding="utf-8"))
required = {"word", "info", "category", "difficulty", "image_url", "image_source_url", "image_credit", "image_license"}
errors = []
seen = set()
for index, item in enumerate(words, 1):
    missing = required - item.keys()
    if missing:
        errors.append(f"#{index}: missing {', '.join(sorted(missing))}")
    word = str(item.get("word", "")).strip()
    if not word:
        errors.append(f"#{index}: empty word")
    elif word in seen:
        errors.append(f"#{index}: duplicate word {word}")
    seen.add(word)
    if not str(item.get("info", "")).strip():
        errors.append(f"#{index}: empty GM explanation")
    if item.get("difficulty") not in {"easy", "medium", "hard"}:
        errors.append(f"#{index}: invalid difficulty {item.get('difficulty')!r}")
    if item.get("image_url") and not (item.get("image_credit") and item.get("image_license")):
        errors.append(f"#{index}: image URL requires creator and license attribution")

if errors:
    print("WORD DATABASE INVALID")
    print("\n".join(errors))
    raise SystemExit(1)
print(f"WORD DATABASE OK: {len(words)} unique words; difficulty={dict(Counter(x['difficulty'] for x in words))}; categories={len(set(x['category'] for x in words))}")
