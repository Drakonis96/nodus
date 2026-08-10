#!/usr/bin/env python3
"""Validate the two-document Nodus library extraction prototype."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import unicodedata
from collections import Counter
from pathlib import Path


EXPECTED_NOTES = {
    "garciafernandezEntreNormaDeseo2020": [str(number) for number in range(1, 13)],
    "aliamirandaMujeresSolasPosguerra2017": ["front"]
    + [str(number) for number in range(1, 69)],
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_png(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"Invalid PNG: {path}"
    assert data[12:16] == b"IHDR", f"Missing PNG IHDR: {path}"
    return struct.unpack(">II", data[16:24])


def validate_item(item_dir: Path) -> dict[str, object]:
    storage_id = item_dir.name
    markdown_path = item_dir / "reader.md"
    original_path = item_dir / "original.pdf"
    source_map_path = item_dir / "source-map.json"
    metadata_path = item_dir / "metadata.json"
    quality_path = item_dir / "quality-report.json"
    for path in (markdown_path, original_path, source_map_path, metadata_path, quality_path):
        assert path.is_file(), f"Missing file: {path}"

    markdown = markdown_path.read_text(encoding="utf-8")
    source_map = json.loads(source_map_path.read_text(encoding="utf-8"))
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    quality = json.loads(quality_path.read_text(encoding="utf-8"))

    key = metadata["citationKey"]
    assert metadata["storageId"] == storage_id
    assert source_map["citationKey"] == key
    assert source_map["reader"]["sha256"] == sha256(markdown_path)
    assert source_map["source"]["sha256"] == sha256(original_path)
    assert original_path.read_bytes()[:4] == b"%PDF"
    assert markdown == unicodedata.normalize("NFC", markdown)
    assert "\u00ad" not in markdown
    assert not re.search(r" {2,}", markdown)
    assert not re.search(r"\w-\n\w", markdown)

    notes_heading = markdown.index("## Notas")
    body = markdown[:notes_heading]
    notes = markdown[notes_heading:]
    references = re.findall(r"\[\^([^\]]+)\]", body)
    definitions = re.findall(r"(?m)^\[\^([^\]]+)\]:", notes)
    expected_notes = EXPECTED_NOTES[key]
    assert references == expected_notes, (key, "reference order", references)
    assert definitions == expected_notes, (key, "definition order", definitions)
    assert Counter(references) == Counter(definitions)

    pages = {page["page"]: page for page in source_map["pages"]}
    previous_end = 0
    block_ids: set[str] = set()
    for block in source_map["blocks"]:
        assert block["id"] not in block_ids
        block_ids.add(block["id"])
        start = block["markdown"]["start"]
        end = block["markdown"]["end"]
        assert previous_end <= start < end <= len(markdown), (key, block["id"], start, end)
        previous_end = end
        assert block["anchors"], (key, block["id"], "no anchors")
        for anchor in block["anchors"]:
            page = pages[anchor["page"]]
            x0, top, x1, bottom = anchor["bbox"]
            assert 0 <= x0 <= x1 <= page["width"]
            assert 0 <= top <= bottom <= page["height"]

    images = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", markdown)
    for relative_path in images:
        assert (item_dir / relative_path).is_file(), (key, relative_path)

    assert quality["doubleSpaces"] == 0
    assert quality["decomposedUnicodeMarks"] == 0
    assert quality["softHyphens"] == 0
    assert quality["brokenWordLineWraps"] == 0
    return {
        "pages": len(pages),
        "blocks": len(source_map["blocks"]),
        "notes": len(definitions),
        "images": len(images),
        "tables": len(re.findall(r"(?m)^\|(?: --- \|)+$", markdown)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("library", type=Path, help="Path to the nodus-library directory")
    args = parser.parse_args()
    library = args.library.resolve()
    catalog = json.loads((library / "library.json").read_text(encoding="utf-8"))
    assert catalog["engine"]["remoteServices"] is False
    assert all(component["license"] == "MIT" for component in catalog["engine"]["components"])

    results = {}
    for key, entry in catalog["items"].items():
        item_dir = library / entry["path"]
        assert item_dir.is_dir()
        results[key] = validate_item(item_dir)

    map_path = (
        library
        / "E7FGXJFE"
        / "assets"
        / "mapa-001-delitos-juzgados-1905-1914.png"
    )
    results["E7FGXJFE"]["mapDimensions"] = validate_png(map_path)
    assert results["84BXPV2V"]["pages"] == 21
    assert results["84BXPV2V"]["images"] == 0
    assert results["E7FGXJFE"]["pages"] == 24
    assert results["E7FGXJFE"]["images"] == 1
    assert results["E7FGXJFE"]["tables"] == 1
    assert results["E7FGXJFE"]["mapDimensions"] == (1231, 919)
    print(json.dumps({"status": "ok", "items": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
