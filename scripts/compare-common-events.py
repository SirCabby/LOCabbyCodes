import codecs
import json
from pathlib import Path


def load_common_events(path: Path):
    """Load a CommonEvents JSON file regardless of BOM/encoding."""
    data = path.read_bytes()
    if data.startswith(codecs.BOM_UTF16_LE):
        text = data.decode("utf-16-le")
    elif data.startswith(codecs.BOM_UTF16_BE):
        text = data.decode("utf-16-be")
    elif data.startswith(codecs.BOM_UTF8):
        text = data.decode("utf-8-sig")
    else:
        # Fallback to utf-8 which is what the game uses by default.
        text = data.decode("utf-8")
    # Strip any BOM that may remain after decoding so json.loads is happy.
    text = text.lstrip("\ufeff")
    return json.loads(text)


def main():
    repo_root = Path(__file__).resolve().parents[1]
    mod_path = repo_root / "CommonEvents.json"
    base_path = repo_root / "game_files" / "CommonEvents.json"

    mod_events = load_common_events(mod_path)
    base_events = load_common_events(base_path)

    if len(mod_events) != len(base_events):
        print(
            f"Event count mismatch: mod={len(mod_events)} base={len(base_events)}"
        )

    diff_ids = []
    for idx, (mod_event, base_event) in enumerate(
        zip(mod_events, base_events)
    ):
        if mod_event != base_event:
            diff_ids.append(idx)

    print(f"Found {len(diff_ids)} differing events.")
    for idx in diff_ids:
        mod_event = mod_events[idx]
        base_event = base_events[idx]
        name_mod = mod_event["name"] if mod_event else "<null>"
        name_base = base_event["name"] if base_event else "<null>"
        print(f"- Event {idx}: mod={name_mod!r}, base={name_base!r}")


if __name__ == "__main__":
    main()

