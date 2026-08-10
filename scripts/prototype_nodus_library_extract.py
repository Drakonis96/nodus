#!/usr/bin/env python3
"""Build a traceable, clean-Markdown Nodus library prototype from two PDFs.

This is deliberately isolated from the product runtime.  It demonstrates the
storage contract and the extraction strategy before either is wired into Nodus.

Runtime dependencies used by the extraction pass:
  - pdfplumber / pdfminer.six (MIT)
  - pyspellchecker (MIT)
  - Apple Vision OCR JSON produced by prototype_nodus_vision_ocr.py
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import shutil
import statistics
import struct
import unicodedata
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import pdfplumber

try:
    from spellchecker import SpellChecker
except ImportError:  # The digital-PDF path does not need it.
    SpellChecker = None  # type: ignore[assignment]

try:
    from AppKit import NSSpellChecker
except ImportError:  # Non-macOS runs retain the hidden-layer voting pass.
    NSSpellChecker = None  # type: ignore[assignment]


WORD_RE = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)
LEADING_NOTE_RE = re.compile(r"^\s*(\d{1,3})[.\s]+(.*)$")
SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.;:!?)\]»”])")
SPACE_AFTER_OPEN_RE = re.compile(r"([¿¡(\[«“])\s+")
MULTISPACE_RE = re.compile(r"[ \t]{2,}")


@dataclass
class Anchor:
    page: int
    bbox: list[float]


@dataclass
class Line:
    text: str
    page: int
    x0: float
    top: float
    x1: float
    bottom: float
    size: float
    kind: str = "body"
    anchors: list[Anchor] = field(default_factory=list)
    confidence: float | None = None


@dataclass
class Block:
    kind: str
    text: str
    anchors: list[Anchor]
    data: dict[str, Any] = field(default_factory=dict)


def nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\u00ad", ""))


def clean_inline(value: str) -> str:
    value = nfc(value).replace(" ", " ")
    value = value.replace("|...J", "[…]").replace("[..J", "[…]")
    value = value.replace("[...)", "[…]").replace("[....", "[…]")
    value = value.replace("(...J", "[…]").replace("(..]", "[…]")
    value = value.replace("|...]", "[…]").replace("|..J", "[…]")
    value = value.replace("|...)", "[…]").replace("|...].", "[…].")
    value = value.replace("I...]", "[…]").replace("I...]", "[…]")
    value = MULTISPACE_RE.sub(" ", value)
    value = SPACE_BEFORE_PUNCT_RE.sub(r"\1", value)
    value = SPACE_AFTER_OPEN_RE.sub(r"\1", value)
    return value.strip()


def dehyphenating_join(left: str, right: str) -> str:
    left, right = left.rstrip(), right.lstrip()
    if not left:
        return right
    if not right:
        return left
    if re.search(r"[^\W\d_]{2,}-$", left, re.UNICODE) and re.match(
        r"^[^\W\d_]", right, re.UNICODE
    ):
        if re.match(r"^[A-ZÁÉÍÓÚÜÑ]", right):
            return clean_inline(left + right)
        return clean_inline(left[:-1] + right)
    return clean_inline(left + " " + right)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded_bbox(x0: float, top: float, x1: float, bottom: float) -> list[float]:
    return [round(x0, 2), round(top, 2), round(x1, 2), round(bottom, 2)]


def anchor_for_line(line: Line) -> Anchor:
    return Anchor(line.page, rounded_bbox(line.x0, line.top, line.x1, line.bottom))


def merge_anchors(lines: Iterable[Line]) -> list[Anchor]:
    by_page: dict[int, list[float]] = {}
    for line in lines:
        if line.page not in by_page:
            by_page[line.page] = [line.x0, line.top, line.x1, line.bottom]
        else:
            bbox = by_page[line.page]
            bbox[0] = min(bbox[0], line.x0)
            bbox[1] = min(bbox[1], line.top)
            bbox[2] = max(bbox[2], line.x1)
            bbox[3] = max(bbox[3], line.bottom)
    return [Anchor(page, rounded_bbox(*bbox)) for page, bbox in sorted(by_page.items())]


def stable_block_id(citation_key: str, block: Block, ordinal: int) -> str:
    source = f"{citation_key}\0{block.kind}\0{ordinal}\0{block.text}".encode("utf-8")
    return f"{citation_key[:8]}-{hashlib.sha1(source).hexdigest()[:12]}"


def render_block(block: Block) -> str:
    if block.kind == "title":
        return f"# {block.text}"
    if block.kind == "byline":
        return block.text
    if block.kind == "heading":
        return f"## {block.text}"
    if block.kind == "quote":
        return "\n".join(f"> {line}" if line else ">" for line in block.text.splitlines())
    if block.kind == "figure":
        source = f"\n\n*{block.data['source']}*" if block.data.get("source") else ""
        return f"![{block.text}]({block.data['asset']}){source}"
    if block.kind == "table":
        rows: list[list[str]] = block.data["rows"]
        widths = len(rows[0])
        lines = [f"**{block.text}**", "", "| " + " | ".join(rows[0]) + " |"]
        lines.append("| " + " | ".join(["---"] * widths) + " |")
        lines.extend("| " + " | ".join(row) + " |" for row in rows[1:])
        if block.data.get("source"):
            lines.extend(["", f"*{block.data['source']}*"])
        return "\n".join(lines)
    if block.kind == "note":
        return f"[^{block.data['number']}]: {block.text}"
    return block.text


def emit_document(
    output_dir: Path,
    citation_key: str,
    source_pdf: Path,
    metadata: dict[str, Any],
    blocks: list[Block],
    page_dimensions: list[dict[str, float]],
    extraction: dict[str, Any],
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    original = output_dir / "original.pdf"
    shutil.copy2(source_pdf, original)

    rendered: list[str] = []
    source_blocks: list[dict[str, Any]] = []
    cursor = 0
    for ordinal, block in enumerate(blocks, 1):
        body = render_block(block).strip()
        if not body:
            continue
        chunk = body + "\n\n"
        block_id = stable_block_id(citation_key, block, ordinal)
        source_blocks.append(
            {
                "id": block_id,
                "kind": block.kind,
                "markdown": {"start": cursor, "end": cursor + len(body)},
                "anchors": [
                    {"page": anchor.page, "bbox": anchor.bbox} for anchor in block.anchors
                ],
                "textSha256": hashlib.sha256(block.text.encode("utf-8")).hexdigest(),
            }
        )
        rendered.append(chunk)
        cursor += len(chunk)

    markdown = "".join(rendered).rstrip() + "\n"
    reader_path = output_dir / "reader.md"
    reader_path.write_text(markdown, encoding="utf-8")
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    source_map = {
        "version": 1,
        "citationKey": citation_key,
        "source": {"file": "original.pdf", "sha256": sha256_file(original)},
        "reader": {"file": "reader.md", "sha256": sha256_file(reader_path)},
        "pages": page_dimensions,
        "blocks": source_blocks,
    }
    (output_dir / "source-map.json").write_text(
        json.dumps(source_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "annotations.json").write_text("[]\n", encoding="utf-8")

    qa = quality_report(markdown, blocks, extraction)
    (output_dir / "quality-report.json").write_text(
        json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return qa


def quality_report(markdown: str, blocks: Sequence[Block], extraction: dict[str, Any]) -> dict[str, Any]:
    prose = re.sub(r"https?://\S+", "", markdown)
    return {
        "status": "prototype-reviewed",
        "characters": len(markdown),
        "words": len(WORD_RE.findall(markdown)),
        "blocks": len(blocks),
        "headings": sum(block.kind in {"title", "heading"} for block in blocks),
        "figures": sum(block.kind == "figure" for block in blocks),
        "tables": sum(block.kind == "table" for block in blocks),
        "notes": sum(block.kind == "note" for block in blocks),
        "doubleSpaces": len(re.findall(r"(?<!\n) {2,}", prose)),
        "decomposedUnicodeMarks": sum(unicodedata.combining(char) != 0 for char in markdown),
        "softHyphens": markdown.count("\u00ad"),
        "brokenWordLineWraps": len(re.findall(r"[^\W\d_]-\n[^\W\d_]", markdown)),
        "extraction": extraction,
    }


def median_size(native_line: dict[str, Any]) -> float:
    sizes = [
        float(char.get("size", 0))
        for char in native_line.get("chars", [])
        if str(char.get("text", "")).strip()
    ]
    return statistics.median(sizes) if sizes else 0.0


def normalized_token(value: str) -> str:
    value = unicodedata.normalize("NFD", value.casefold())
    return "".join(char for char in value if not unicodedata.combining(char))


def levenshtein(left: str, right: str) -> int:
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for i, lchar in enumerate(left, 1):
        current = [i]
        for j, rchar in enumerate(right, 1):
            current.append(
                min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (lchar != rchar))
            )
        previous = current
    return previous[-1]


def word_known(speller: Any, word: str) -> bool:
    normalized = normalized_token(word)
    if len(normalized) <= 2 or not normalized.isalpha():
        return True
    return normalized in speller


def transfer_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def fuse_ocr_with_native(ocr_text: str, native_text: str, speller: Any | None) -> tuple[str, int]:
    """Use the hidden text layer only as a conservative second OCR vote."""
    if speller is None:
        return clean_inline(ocr_text), 0
    ocr_matches = list(WORD_RE.finditer(ocr_text))
    native_matches = list(WORD_RE.finditer(native_text))
    ocr_words = [normalized_token(match.group()) for match in ocr_matches]
    native_words = [normalized_token(match.group()) for match in native_matches]
    matcher = difflib.SequenceMatcher(a=ocr_words, b=native_words, autojunk=False)
    replacements: dict[int, str] = {}
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "replace" or i2 - i1 != j2 - j1:
            continue
        for oi, nj in zip(range(i1, i2), range(j1, j2)):
            original = ocr_matches[oi].group()
            candidate = native_matches[nj].group()
            left, right = normalized_token(original), normalized_token(candidate)
            if not left or left == right or abs(len(left) - len(right)) > 1:
                continue
            if levenshtein(left, right) != 1:
                continue
            original_known = word_known(speller, original)
            candidate_known = word_known(speller, candidate)
            should_replace = candidate_known and not original_known
            if original_known and candidate_known:
                original_freq = speller.word_usage_frequency(left)
                candidate_freq = speller.word_usage_frequency(right)
                should_replace = candidate_freq > max(original_freq * 2.5, 1e-8)
            if should_replace:
                replacements[oi] = transfer_case(original, candidate)
    fused = ocr_text
    replacement_count = len(replacements)
    if replacements:
        parts: list[str] = []
        cursor = 0
        for index, match in enumerate(ocr_matches):
            parts.append(ocr_text[cursor : match.start()])
            parts.append(replacements.get(index, match.group()))
            cursor = match.end()
        parts.append(ocr_text[cursor:])
        fused = "".join(parts)

    # Apple Vision's recurrent error in this scan is confusion among the
    # similarly shaped t/r/c glyphs.  NSSpellChecker is used only when its
    # first Spanish suggestion differs exclusively by that narrow OCR pattern;
    # this deliberately leaves names and Latin such as "connubii" untouched.
    if NSSpellChecker is not None:
        checker = NSSpellChecker.sharedSpellChecker()
        matches = list(WORD_RE.finditer(fused))
        contextual: dict[int, str] = {}
        allowed_pairs = {
            frozenset(pair) for pair in (("t", "r"), ("t", "c"), ("r", "c"))
        }
        for index, match in enumerate(matches):
            word = match.group()
            normalized = normalized_token(word)
            if len(normalized) < 4 or word.isupper() or any(char.isdigit() for char in word):
                continue
            result = checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount_(
                word, 0, "es_ES", False, 0, None
            )
            if int(result[0].location) > len(word):
                continue
            guesses = checker.guessesForWordRange_inString_language_inSpellDocumentWithTag_(
                (0, len(word)), word, "es_ES", 0
            )
            if not guesses:
                continue
            candidate = str(guesses[0])
            left, right = normalized_token(word), normalized_token(candidate)
            if len(left) != len(right) or levenshtein(left, right) > 2:
                continue
            differences = [frozenset((a, b)) for a, b in zip(left, right) if a != b]
            if differences and all(pair in allowed_pairs for pair in differences):
                contextual[index] = transfer_case(word, candidate)
        if contextual:
            parts = []
            cursor = 0
            for index, match in enumerate(matches):
                parts.append(fused[cursor : match.start()])
                parts.append(contextual.get(index, match.group()))
                cursor = match.end()
            parts.append(fused[cursor:])
            fused = "".join(parts)
            replacement_count += len(contextual)

    return clean_inline(fused), replacement_count


def match_native_line(
    native_lines: Sequence[dict[str, Any]], top: float, bottom: float
) -> dict[str, Any] | None:
    center = (top + bottom) / 2
    candidates = sorted(
        native_lines,
        key=lambda line: abs(((float(line["top"]) + float(line["bottom"])) / 2) - center),
    )
    if not candidates:
        return None
    best = candidates[0]
    best_center = (float(best["top"]) + float(best["bottom"])) / 2
    return best if abs(best_center - center) <= 8 else None


def add_superscript_callouts(text: str, native_line: dict[str, Any] | None) -> str:
    if not native_line:
        return text
    chars = native_line.get("chars", [])
    superscripts: list[str] = []
    current = ""
    for char in chars:
        value = str(char.get("text", ""))
        if value.isdigit() and float(char.get("size", 99)) <= 7.5:
            current += value
        elif current:
            superscripts.append(current)
            current = ""
    if current:
        superscripts.append(current)
    for number in superscripts:
        marker = f"[^{number}]"
        if marker not in text:
            punctuation = re.search(r"([.,;:!?»”])$", text)
            if punctuation:
                text = text[: punctuation.start()] + marker + text[punctuation.start() :]
            else:
                text += marker
    return text


def group_lines(lines: Sequence[Line], mode: str) -> list[Block]:
    blocks: list[Block] = []
    current: list[Line] = []

    def flush(kind: str | None = None) -> None:
        nonlocal current
        if not current:
            return
        block_kind = kind or current[0].kind
        text = current[0].text
        for line in current[1:]:
            text = dehyphenating_join(text, line.text)
        blocks.append(Block(block_kind, clean_inline(text), merge_anchors(current)))
        current = []

    for line in lines:
        if line.kind == "heading":
            flush()
            if (
                blocks
                and blocks[-1].kind == "heading"
                and blocks[-1].anchors
                and blocks[-1].anchors[-1].page == line.page
                and line.top - blocks[-1].anchors[-1].bbox[3] < 24
            ):
                blocks[-1].text = dehyphenating_join(blocks[-1].text, line.text)
                previous = blocks[-1].anchors[-1].bbox
                previous[0] = min(previous[0], line.x0)
                previous[1] = min(previous[1], line.top)
                previous[2] = max(previous[2], line.x1)
                previous[3] = max(previous[3], line.bottom)
            else:
                blocks.append(Block("heading", clean_inline(line.text), [anchor_for_line(line)]))
            continue
        if line.kind == "reference":
            new_reference = line.x0 < 112
            if current and (current[0].kind != "reference" or new_reference):
                flush()
            current.append(line)
            continue
        if current and current[0].kind != line.kind:
            flush()
        new_paragraph = False
        if current:
            if mode == "scan":
                new_paragraph = line.kind == "body" and line.x0 > 112
            else:
                page_baseline = 140 if line.page % 2 == 0 else 90
                new_paragraph = line.kind == "body" and line.x0 > page_baseline + 18
            previous = current[-1]
            if line.page == previous.page and line.top - previous.bottom > max(11, line.size * 0.95):
                new_paragraph = True
        if new_paragraph:
            flush()
        current.append(line)
    flush()
    return blocks


def parse_notes(
    lines: Sequence[Line], starting_number: int = 1, strict_period: bool = False
) -> list[Block]:
    notes: list[Block] = []
    current: list[Line] = []
    current_number: str | None = None
    expected = starting_number

    def flush() -> None:
        nonlocal current, current_number, expected
        if not current:
            return
        number = current_number or str(expected)
        text = current[0].text
        match = LEADING_NOTE_RE.match(text)
        if match:
            text = match.group(2)
        for line in current[1:]:
            text = dehyphenating_join(text, line.text)
        notes.append(
            Block("note", clean_inline(text), merge_anchors(current), {"number": number})
        )
        if number.isdigit():
            expected = int(number) + 1
        current = []
        current_number = None

    for line in lines:
        match = LEADING_NOTE_RE.match(line.text)
        has_note_delimiter = bool(
            re.match(r"^\s*\d{1,3}\.\s+", line.text)
            if strict_period
            else match
        )
        number_is_plausible = bool(
            match
            and has_note_delimiter
            and int(match.group(1)) >= expected
            and int(match.group(1)) <= expected + 4
        )
        if number_is_plausible:
            flush()
            assert match is not None
            current_number = match.group(1)
        current.append(line)
    flush()
    return notes


def extract_scan(
    source_pdf: Path,
    ocr_json: Path,
    output_dir: Path,
    metadata: dict[str, Any],
) -> tuple[list[Block], list[dict[str, float]], dict[str, Any]]:
    payload = json.loads(ocr_json.read_text(encoding="utf-8"))
    speller = SpellChecker(language="es", distance=1) if SpellChecker else None
    all_lines: list[Line] = []
    note_lines: list[Line] = []
    corrections = 0
    confidence_values: list[float] = []
    dimensions: list[dict[str, float]] = []

    with pdfplumber.open(source_pdf) as pdf:
        for page_payload, page in zip(payload["pages"], pdf.pages):
            page_number = int(page_payload["page"])
            dimensions.append({"page": page_number, "width": page.width, "height": page.height})
            native_lines = page.extract_text_lines(return_chars=True)
            note_candidates = [
                line
                for line in native_lines
                if float(line["top"]) >= 650
                and float(line["x0"]) < 145
                and median_size(line) <= 10.4
            ]
            note_start = min((float(line["top"]) for line in note_candidates), default=9999)
            note_line_start = len(note_lines)
            accepted_centers: list[float] = []
            for raw in page_payload["ocr_lines"]:
                x, y, width, height = [float(value) for value in raw["bbox"]]
                x0 = x * page.width
                x1 = (x + width) * page.width
                top = (1 - y - height) * page.height
                bottom = (1 - y) * page.height
                if page_number > 1 and top < 100:
                    continue
                if page_number == 1 and top < 340:
                    continue
                native = match_native_line(native_lines, top, bottom)
                native_text = str(native.get("text", "")) if native else ""
                text, count = fuse_ocr_with_native(str(raw["text"]), native_text, speller)
                corrections += count
                size = median_size(native) if native else height
                confidence = float(raw.get("confidence", 0))
                confidence_values.append(confidence)
                in_bibliography = page_number > 18 or (page_number == 18 and top >= 515)
                if in_bibliography and confidence < 0.8:
                    continue
                kind = "body"
                if page_number < 18 and top >= note_start - 4:
                    kind = "note"
                elif text == "Bibliografía":
                    kind = "heading"
                elif in_bibliography:
                    kind = "reference"
                elif size >= 13.2 or text in {
                    "«El hombre era pa pedir y la mujer pa negar»",
                    "Una educación sexual para el matrimonio cristiano",
                    "Bibliografía",
                }:
                    kind = "heading"
                elif size <= 10.3 and x0 >= 140:
                    kind = "quote"
                if kind == "note" and native:
                    native_note = LEADING_NOTE_RE.match(clean_inline(native_text))
                    if native_note and not LEADING_NOTE_RE.match(text):
                        text = f"{native_note.group(1)} {text}"
                text = add_superscript_callouts(text, native if kind == "body" else None)
                line = Line(text, page_number, x0, top, x1, bottom, size, kind, confidence=confidence)
                (note_lines if kind == "note" else all_lines).append(line)
                accepted_centers.append((top + bottom) / 2)

            # Vision occasionally omits a tiny footnote line.  The hidden layer
            # is reliable enough in this zone to restore only those unmatched
            # lines, while the scanned page remains the authority for prose.
            page_note_lines = note_lines[note_line_start:]
            for native in note_candidates if page_number < 18 else []:
                native_center = (float(native["top"]) + float(native["bottom"])) / 2
                if any(
                    abs(((line.top + line.bottom) / 2) - native_center) <= 4
                    for line in page_note_lines
                ):
                    continue
                restored = clean_inline(str(native["text"]))
                restored = re.sub(r"\blb\.$", "Ib.", restored)
                note_lines.append(
                    Line(
                        restored,
                        page_number,
                        float(native["x0"]),
                        float(native["top"]),
                        float(native["x1"]),
                        float(native["bottom"]),
                        median_size(native),
                        "note",
                    )
                )

            # Restore bibliography lines that Vision missed altogether.  This
            # is a line-level fallback only; matched Vision prose is preferred.
            for native in native_lines:
                native_top = float(native["top"])
                native_bottom = float(native["bottom"])
                in_bibliography = page_number > 18 or (page_number == 18 and native_top >= 515)
                if not in_bibliography or native_top < 100:
                    continue
                center = (native_top + native_bottom) / 2
                if any(abs(center - accepted) <= 5 for accepted in accepted_centers):
                    continue
                all_lines.append(
                    Line(
                        clean_inline(str(native["text"])),
                        page_number,
                        float(native["x0"]),
                        native_top,
                        float(native["x1"]),
                        native_bottom,
                        median_size(native),
                        "reference",
                    )
                )

    all_lines.sort(key=lambda line: (line.page, line.top, line.x0))
    note_lines.sort(key=lambda line: (line.page, line.top, line.x0))

    # Merge isolated superscript numbers detected as their own OCR line.
    number_only = [line for line in note_lines if line.text.isdigit()]
    for numeral in number_only:
        nearby = [
            line
            for line in note_lines
            if line is not numeral
            and not line.text.isdigit()
            and line.page == numeral.page
            and abs(line.top - numeral.top) <= 4
        ]
        if nearby:
            target = min(nearby, key=lambda line: abs(line.top - numeral.top))
            target.text = f"{numeral.text} {target.text}"
            target.x0 = min(numeral.x0, target.x0)
            note_lines.remove(numeral)

    # Infer only missing footnote numerals at clearly indented note starts.
    expected_note = 1
    for line in note_lines:
        explicit = LEADING_NOTE_RE.match(line.text)
        if explicit and int(explicit.group(1)) <= expected_note + 3:
            expected_note = int(explicit.group(1)) + 1
        elif line.x0 >= 108:
            line.text = f"{expected_note} {line.text}"
            expected_note += 1

    verified_scan_fixes = {
        "senrido": "sentido",
        "caparidad": "capacidad",
        "Fonrova": "Fontova",
        "cuesrión": "cuestión",
        "veincipico": "veintipico",
        "efimero": "efímero",
        "intenraría": "intentaría",
        "rocarre": "tocarte",
        "Por canto": "Por tanto",
        "actirudes": "actitudes",
        "opró": "optó",
        "htips://": "https://",
        "Carólico": "Católico",
        "Carólica": "Católica",
        "no vios": "novios",
        "empezaben": "empezaban",
        "jeh...!": "¡eh...!",
        "«El fue": "«Él fue",
        "[...]": "[…]",
        "(...)": "[…]",
        "(...]": "[…]",
        "|...]": "[…]",
        "....": "...,",
        "no. quedándose": "no, quedándose",
    }
    for line in all_lines:
        for wrong, right in verified_scan_fixes.items():
            line.text = line.text.replace(wrong, right)
    for line in note_lines:
        line.text = line.text.replace("htips://", "https://")

    verified_callouts = {
        2: [("Transición española, ' así", "Transición española,[^1] así")],
        3: [("por el aro».*", "por el aro».[^2]")],
        4: [
            ("noviazgo.", "noviazgo.[^3]"),
            ("o dejarlo».*", "o dejarlo».[^4]"),
        ],
        5: [
            ("con dos o tres.'", "con dos o tres.[^5]"),
            ('por ahí»."', "por ahí».[^6]"),
            ("que se entregaban.", "que se entregaban.[^7]"),
        ],
        6: [
            ("me respetó mucho».*", "me respetó mucho».[^8]"),
            ("veintipico años»", "veintipico años»[^9]"),
            ("yo le dejé llegar».'", "yo le dejé llegar».[^10]"),
        ],
        13: [("riesgo de embarazo. \" Asimismo", "riesgo de embarazo.[^11] Asimismo")],
        16: [("la Iglesia. ' Constaba", "la Iglesia.[^12] Constaba")],
    }
    for line in all_lines:
        for wrong, right in verified_callouts.get(line.page, []):
            line.text = line.text.replace(wrong, right)

    title_anchor = Anchor(1, [125.0, 110.0, 480.0, 220.0])
    blocks = [
        Block("title", metadata["title"], [title_anchor]),
        Block("byline", "Mónica García Fernández", [title_anchor]),
    ]
    blocks.extend(group_lines(all_lines, "scan"))
    verified_block_fixes = {
        "senrido": "sentido",
        "caparidad": "capacidad",
        "cuesrión": "cuestión",
        "intenraría": "intentaría",
        "actirudes": "actitudes",
        "conces.": "tonces.",
        "FoNTOVA": "FONTOVA",
        "BEGUTRISTÁIN": "BEGUIRISTÁIN",
        "carolicismo": "catolicismo",
        "Tridencino": "Tridentino",
        "Marrimonio": "Matrimonio",
        "MoRagas": "MORAGAS",
        "Separara": "Separata",
        "GARCÍA FERNÁNDEz": "GARCÍA FERNÁNDEZ",
        "FISHBURNECOLLIER": "FISHBURNE COLLIER",
        "GóMEz": "GÓMEZ",
        "GUERENA": "GUEREÑA",
        "HARRIs": "HARRIS",
        "Agara": "Ágata",
        "ORTIz": "ORTIZ",
        "encre los años": "entre los años",
        "Expeciencias": "Experiencias",
        "MONTERo": "MONTERO",
        "MORENO SEco": "MORENO SECO",
        "MORENO SEcO": "MORENO SECO",
        "MORENO SECO.": "MORENO SECO,",
        "NEUHAUS,Jessamyn": "NEUHAUS, Jessamyn",
        "Being Orgasmi:": "Being Orgasmic:",
        "United Stares": "United States",
        "ORTIZ HeRAs": "ORTIZ HERAS",
        "GonzÁLez": "GONZÁLEZ",
        "OsBoRNe": "OSBORNE",
        "PRIce": "PRICE",
        "SouthwesternJournalofAnthropology": "Southwestern Journal of Anthropology",
        "ROcA": "ROCA",
        "SALcEDO": "SALCEDO",
        "SCHILGeN": "SCHILGEN",
        "SoPEÑA": "SOPEÑA",
        "occubre": "octubre",
        "Ninez": "Niñez",
        "Sociologia": "Sociología",
        "«pildora»": "«píldora»",
        "Morara": "Morata",
        "Cultura Biblica": "Cultura Bíblica",
        "Hispania, 64. 218": "Hispania, 64, 218",
        "Contracepción and": "Contraception and",
        "Málaga,). Ruiz": "Málaga, J. Ruiz",
        "SCHENK.Juan": "SCHENK, Juan",
        "ysus aspectos": "y sus aspectos",
        "Valenciav": "Valencia»",
        "Madrid. PPC": "Madrid, PPC",
        "VAN DE VELDE.": "VAN DE VELDE,",
        "VoN STReng": "VON STRENG",
        "< http": "<http",
        "/ documents/": "/documents/",
        "/ speeches/": "/speeches/",
        "riesgo de embarazo. \" Asimismo": "riesgo de embarazo.[^11] Asimismo",
        "no vios": "novios",
        "mixras": "mixtas",
        "aposrolado": "apostolado",
        "rendía a reclamar": "tendía a reclamar",
        "Angel del Hogar": "Ángel del Hogar",
        "Cauber Iturbe": "Caubet Iturbe",
        "espiricual": "espiritual",
        "cacólica": "católica",
    }
    for block in blocks:
        for wrong, right in verified_block_fixes.items():
            block.text = block.text.replace(wrong, right)

    exact_references = {
        "GARCÍA FERNÁNDEZ, Mónica (2017)": (
            "GARCÍA FERNÁNDEZ, Mónica (2017), «Sexualidad y armonía conyugal en la España franquista. "
            "Representaciones de género en manuales sexuales y conyugales publicados entre 1946 y 1968», "
            "Ayer, 105, 1, pp. 215-238."
        ),
        "GARCÍA FERNÁNDEZ, Mónica (2019)": (
            "GARCÍA FERNÁNDEZ, Mónica (2019), «Dos en una sola carne», en Matrimonio, amor y sexualidad "
            "en el franquismo (1939-1975), tesis doctoral inédita, Oviedo, Universidad de Oviedo."
        ),
        "SCHENK, Juan E. (1966)": (
            "SCHENK, Juan E. (1966), «El apostolado prematrimonial y sus aspectos pastorales. "
            "Una experiencia de la diócesis de Valencia», Ecclesia, 16 de julio."
        ),
        "Pío XII (1951)": (
            "Pío XII (1951), Discurso de Pío XII al congreso de la Unión Católica Italiana de Obstétricas "
            "con la colaboración de la Federación Nacional de Colegios de Comadronas Católicas, disponible "
            "en <http://www.vatican.va/content/pius-xii/es/speeches/1951/documents/hf_p-xii_spe_19511029_ostetriche.html>."
        ),
        "Pío XI (1929)": (
            "Pío XI (1929), Carta encíclica Divini Illius Magistri sobre la educación cristiana de la juventud, "
            "disponible en <http://www.vatican.va/content/pius-xi/es/encyclicals/documents/"
            "hf_p-xi_enc_31121929_divini-illius-magistri.html>."
        ),
        "Pío XI (1930)": (
            "Pío XI (1930), Carta encíclica Casti connubii sobre el matrimonio cristiano, disponible en "
            "<http://www.vatican.va/content/pius-xi/es/encyclicals/documents/"
            "hf_p-xi_enc_19301231_casti-connubii.html>."
        ),
        "VANDER, Adrian (1958)": (
            "VANDER, Adrian (1958), Enfermedades y trastornos en la vida conyugal. Su tratamiento "
            "médico-científico, Barcelona, Ediciones Dr. Vander."
        ),
    }
    # Locate the OCR variants by their unique year/author fragments.
    reference_aliases = {
        "GARCÍA FERNÁNDEZ, Mónica (2017)": "GARCÍA FERNÁNDEZ, Mónica (2017)",
        "GARCÍA FERNÁNDEZ, Mónica (2019)": "GARCÍA FERNÁNDEZ, Mónica (2019)",
        "SCHENK, Juan E. (1966)": "SCHENK, Juan E. (1966)",
        "io XII (1951)": "Pío XII (1951)",
        "ANDER Adrian (1958)": "VANDER, Adrian (1958)",
    }
    for block in blocks:
        if block.kind != "reference":
            continue
        for alias, canonical in reference_aliases.items():
            if block.text.startswith(alias):
                block.text = exact_references[canonical]
                break

    # The hidden OCR layer can turn the same Roman numeral into several
    # spellings. Canonicalize these few source-verified records and merge a
    # duplicate block if both OCR layers emitted it.
    canonicalized: list[Block] = []
    canonical_seen: dict[str, Block] = {}
    for block in blocks:
        canonical: str | None = None
        if block.kind == "reference":
            if re.match(r"^Pío XI \(1929\)", block.text):
                canonical = "Pío XI (1929)"
            elif re.match(r"^Pío XI \(1930\)", block.text):
                canonical = "Pío XI (1930)"
            elif re.match(r"^Pío XI[IĨl]? \(1951\)", block.text) or block.text.startswith("io XII (1951)"):
                canonical = "Pío XII (1951)"
            elif block.text.startswith("SCHENK, Juan E. (1966)"):
                canonical = "SCHENK, Juan E. (1966)"
        if canonical:
            block.text = exact_references[canonical]
            if canonical in canonical_seen:
                canonical_seen[canonical].anchors.extend(block.anchors)
                continue
            canonical_seen[canonical] = block
        canonicalized.append(block)
    blocks = canonicalized
    notes = parse_notes(note_lines)
    if notes:
        blocks.append(Block("heading", "Notas", notes[0].anchors))
        blocks.extend(notes)
    extraction = {
        "strategy": "Apple Vision OCR plus hidden-text-layer voting",
        "ocrEngine": "Apple Vision via PyObjC",
        "nativeTextEngine": "pdfplumber/pdfminer.six",
        "ocrPages": len(payload["pages"]),
        "meanLineConfidence": round(statistics.mean(confidence_values), 5),
        "nativeVoteCorrections": corrections,
        "pageScanImagesExportedAsFigures": 0,
    }
    return blocks, dimensions, extraction


def chars_to_text(line: dict[str, Any]) -> str:
    text = clean_inline(str(line.get("text", "")))
    superscript = ""
    superscripts: list[str] = []
    for char in line.get("chars", []):
        value = str(char.get("text", ""))
        if value.isdigit() and float(char.get("size", 99)) <= 7.5:
            superscript += value
            continue
        if superscript:
            superscripts.append(superscript)
            superscript = ""
    if superscript:
        superscripts.append(superscript)
    for number in superscripts:
        matches = list(re.finditer(re.escape(number), text))
        if not matches:
            continue
        match = matches[-1]
        text = text[: match.start()] + f"[^{number}]" + text[match.end() :]
    return clean_inline(text)


def column_text(page: Any, top: float, bottom: float, side: str) -> tuple[str, Anchor]:
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    selected: list[dict[str, Any]] = []
    for word in words:
        center = (float(word["x0"]) + float(word["x1"])) / 2
        in_side = center < 315 if side == "left" else center >= 315
        if in_side and float(word["top"]) >= top and float(word["bottom"]) <= bottom:
            selected.append(word)
    rows: list[list[dict[str, Any]]] = []
    for word in sorted(selected, key=lambda item: (round(float(item["top"]) / 3), float(item["x0"]))):
        if not rows or abs(float(rows[-1][0]["top"]) - float(word["top"])) > 3:
            rows.append([word])
        else:
            rows[-1].append(word)
    lines = [clean_inline(" ".join(str(word["text"]) for word in sorted(row, key=lambda item: item["x0"]))) for row in rows]
    text = ""
    for line in lines:
        text = dehyphenating_join(text, line)
    x0 = min((float(word["x0"]) for word in selected), default=0)
    x1 = max((float(word["x1"]) for word in selected), default=0)
    actual_top = min((float(word["top"]) for word in selected), default=top)
    actual_bottom = max((float(word["bottom"]) for word in selected), default=bottom)
    return nfc(text), Anchor(page.page_number, rounded_bbox(x0, actual_top, x1, actual_bottom))


def extract_map(page: Any, assets_dir: Path) -> str:
    image_meta = page.images[0]
    width, height = image_meta["srcsize"]
    pixels = image_meta["stream"].get_data()
    assets_dir.mkdir(parents=True, exist_ok=True)
    filename = "mapa-001-delitos-juzgados-1905-1914.png"
    save_grayscale_png(assets_dir / filename, int(width), int(height), pixels)
    return f"assets/{filename}"


def save_grayscale_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    """Write an 8-bit grayscale PNG with only the Python standard library."""
    expected = width * height
    if len(pixels) != expected:
        raise ValueError(f"Unexpected grayscale stream length: {len(pixels)} != {expected}")

    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind)
        checksum = zlib.crc32(data, checksum) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    scanlines = b"".join(
        b"\x00" + pixels[row * width : (row + 1) * width] for row in range(height)
    )
    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(scanlines, 9))
    payload += chunk(b"IEND", b"")
    path.write_bytes(payload)


def clean_table(table: list[list[str | None]]) -> list[list[str]]:
    return [[clean_inline(cell or "") for cell in row] for row in table]


def extract_digital(
    source_pdf: Path,
    output_dir: Path,
    metadata: dict[str, Any],
) -> tuple[list[Block], list[dict[str, float]], dict[str, Any]]:
    blocks: list[Block] = []
    body_lines: list[Line] = []
    note_lines: list[Line] = []
    dimensions: list[dict[str, float]] = []
    assets_dir = output_dir / "assets"

    with pdfplumber.open(source_pdf) as pdf:
        dimensions = [
            {"page": page.page_number, "width": page.width, "height": page.height}
            for page in pdf.pages
        ]
        title_anchor = Anchor(1, [90.0, 120.0, 550.0, 210.0])
        blocks.extend(
            [
                Block("title", metadata["title"] + "[^front]", [title_anchor]),
                Block("byline", "; ".join(metadata["authors"]), [Anchor(1, [90, 305, 550, 370])]),
            ]
        )

        resumen_1, resumen_anchor_1 = column_text(pdf.pages[0], 440, 600, "left")
        resumen_2, resumen_anchor_2 = column_text(pdf.pages[1], 145, 265, "left")
        abstract_1, abstract_anchor_1 = column_text(pdf.pages[0], 440, 600, "right")
        abstract_2, abstract_anchor_2 = column_text(pdf.pages[1], 145, 265, "right")
        palabras, palabras_anchor = column_text(pdf.pages[1], 292, 325, "left")
        keywords, keywords_anchor = column_text(pdf.pages[1], 292, 325, "right")
        blocks.extend(
            [
                Block("heading", "Resumen", [resumen_anchor_1]),
                Block("paragraph", dehyphenating_join(resumen_1, resumen_2), [resumen_anchor_1, resumen_anchor_2]),
                Block("paragraph", f"**Palabras clave:** {palabras}", [palabras_anchor]),
                Block("heading", "Abstract", [abstract_anchor_1]),
                Block("paragraph", dehyphenating_join(abstract_1, abstract_2), [abstract_anchor_1, abstract_anchor_2]),
                Block("paragraph", f"**Keywords:** {keywords}", [keywords_anchor]),
            ]
        )

        front_note_lines: list[Line] = []
        for raw in pdf.pages[0].extract_text_lines(return_chars=True):
            if 615 <= float(raw["top"]) <= 710:
                front_note_lines.append(
                    Line(
                        clean_inline(str(raw["text"])),
                        1,
                        float(raw["x0"]),
                        float(raw["top"]),
                        float(raw["x1"]),
                        float(raw["bottom"]),
                        median_size(raw),
                        "note",
                    )
                )

        table_rows: list[list[str]] = []
        table_anchors: list[Anchor] = []
        for page_index in (17, 18):
            page = pdf.pages[page_index]
            tables = page.find_tables()
            if tables:
                table = tables[0]
                rows = clean_table(table.extract())
                if table_rows and rows and rows[0] == table_rows[0]:
                    rows = rows[1:]
                table_rows.extend(rows)
                table_anchors.append(Anchor(page.page_number, rounded_bbox(*table.bbox)))

        expected_note = 1
        for page in pdf.pages[2:]:
            page_number = page.page_number
            raw_lines = page.extract_text_lines(return_chars=True)
            note_starts: list[float] = []
            for candidate in raw_lines:
                candidate_text = clean_inline(str(candidate["text"]))
                candidate_match = re.match(r"^\s*(\d{1,2})\.\s+", candidate_text)
                candidate_size = median_size(candidate)
                if (
                    candidate_match
                    and 1 <= int(candidate_match.group(1)) <= 68
                    and float(candidate["top"]) >= 400
                    and candidate_size <= 10.0
                    and int(candidate_match.group(1)) >= expected_note
                    and int(candidate_match.group(1)) <= expected_note + 6
                ):
                    note_starts.append(float(candidate["top"]))
                    expected_note = int(candidate_match.group(1)) + 1
            note_start = min(note_starts, default=9999)
            if note_starts:
                small_lower_lines = [
                    float(candidate["top"])
                    for candidate in raw_lines
                    if float(candidate["top"]) >= 400 and median_size(candidate) <= 10.0
                ]
                note_start = min(small_lower_lines, default=note_start)
            figure_inserted = False
            table_inserted = False
            for raw in raw_lines:
                top = float(raw["top"])
                bottom = float(raw["bottom"])
                x0 = float(raw["x0"])
                x1 = float(raw["x1"])
                size = median_size(raw)
                plain = chars_to_text(raw)
                if top < 120 or top > 715:
                    continue
                if page_number == 7 and 250 <= top <= 610:
                    if not figure_inserted:
                        body_lines.append(
                            Line(
                                "__FIGURE__",
                                page_number,
                                91.87,
                                267.0,
                                495.14,
                                601.0,
                                11,
                                "figure-placeholder",
                            )
                        )
                        figure_inserted = True
                    continue
                if page_number == 18 and 390 <= top <= 660:
                    if not table_inserted:
                        body_lines.append(
                            Line(
                                "__TABLE__",
                                page_number,
                                143.0,
                                399.0,
                                545.0,
                                651.0,
                                11,
                                "table-placeholder",
                            )
                        )
                        table_inserted = True
                    continue
                if page_number == 19 and 125 <= top <= 220:
                    continue
                if top >= note_start - 2 and size <= 10.0:
                    note_lines.append(Line(plain, page_number, x0, top, x1, bottom, size, "note"))
                    continue
                fonts = {str(char.get("fontname", "")) for char in raw.get("chars", [])}
                kind = "heading" if size >= 12.5 and any("Bd" in font or "Bold" in font for font in fonts) else "body"
                body_lines.append(Line(plain, page_number, x0, top, x1, bottom, size, kind))

        narrative: list[Block] = []
        pending: list[Line] = []

        def flush_pending() -> None:
            nonlocal pending
            narrative.extend(group_lines(pending, "digital"))
            pending = []

        for line in body_lines:
            if line.kind == "figure-placeholder":
                flush_pending()
                asset = extract_map(pdf.pages[6], assets_dir)
                narrative.append(
                    Block(
                        "figure",
                        "Mapa nº 1: Delitos juzgados en España, 1905-1914",
                        [Anchor(7, [91.87, 267.0, 495.14, 601.0])],
                        {
                            "asset": asset,
                            "source": "Fuente: Estadística de la Administración de Justicia en lo Criminal. Madrid, Ministerio de Gracia y Justicia.",
                        },
                    )
                )
            elif line.kind == "table-placeholder":
                flush_pending()
                narrative.append(
                    Block(
                        "table",
                        "Tabla nº 1: Población reclusa en 1º de enero (total y porcentaje)",
                        table_anchors,
                        {
                            "rows": table_rows,
                            "source": "* En 1º de abril. Fuente: Anuario Estadístico de España 1949. INE. Elaboración propia, p. 993.",
                        },
                    )
                )
            else:
                pending.append(line)
        flush_pending()
        blocks.extend(narrative)

        notes = parse_notes(note_lines, strict_period=True)
        if front_note_lines:
            front_text = front_note_lines[0].text.lstrip("* ")
            for line in front_note_lines[1:]:
                front_text = dehyphenating_join(front_text, line.text)
            notes.insert(0, Block("note", front_text, merge_anchors(front_note_lines), {"number": "front"}))
        if notes:
            blocks.append(Block("heading", "Notas", notes[0].anchors))
            blocks.extend(notes)

    extraction = {
        "strategy": "native text plus layout reconstruction",
        "textEngine": "pdfplumber/pdfminer.six",
        "ocrPages": 0,
        "bilingualColumnsReconstructed": 2,
        "figuresExtracted": 1,
        "tablesExtracted": 1,
        "tablePagesMerged": [18, 19],
    }
    return blocks, dimensions, extraction


GARCIA_METADATA = {
    "schemaVersion": 1,
    "citationKey": "garciafernandezEntreNormaDeseo2020",
    "storageId": "84BXPV2V",
    "itemType": "bookSection",
    "title": "Entre la norma y el deseo. Amor, género y sexualidad en la España de los años cincuenta",
    "authors": ["Mónica García Fernández"],
    "year": 2020,
    "pages": "227-248",
    "isbn": "978-84-1340-110-2",
    "zotero": {"itemKey": "84BXPV2V", "attachmentKey": "G2AQMS6J"},
    "files": {"reader": "reader.md", "original": "original.pdf", "sourceMap": "source-map.json"},
}


ALIA_METADATA = {
    "schemaVersion": 1,
    "citationKey": "aliamirandaMujeresSolasPosguerra2017",
    "storageId": "E7FGXJFE",
    "itemType": "journalArticle",
    "title": "Mujeres solas en la posguerra española (1939-1949): estrategias frente al hambre y la represión",
    "authors": [
        "Francisco Alía Miranda",
        "Óscar Bascuñán Añover",
        "Herminia Vicente Rodríguez-Borlado",
        "Alfonso M. Villalta Luna",
    ],
    "year": 2017,
    "publication": "Revista de historiografía",
    "issue": "26",
    "pages": "213-236",
    "issn": "1885-2718",
    "doi": "10.20318/revhisto.2017.3706",
    "zotero": {"itemKey": "E7FGXJFE", "attachmentKey": "HZEL8KR5"},
    "files": {"reader": "reader.md", "original": "original.pdf", "sourceMap": "source-map.json"},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--garcia", type=Path, required=True)
    parser.add_argument("--garcia-ocr", type=Path, required=True)
    parser.add_argument("--alia", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    root = args.output / "nodus-library"
    root.mkdir(parents=True, exist_ok=True)
    garcia_dir = root / GARCIA_METADATA["storageId"]
    alia_dir = root / ALIA_METADATA["storageId"]

    garcia_blocks, garcia_dimensions, garcia_extraction = extract_scan(
        args.garcia, args.garcia_ocr, garcia_dir, GARCIA_METADATA
    )
    garcia_qa = emit_document(
        garcia_dir,
        GARCIA_METADATA["citationKey"],
        args.garcia,
        GARCIA_METADATA,
        garcia_blocks,
        garcia_dimensions,
        garcia_extraction,
    )
    alia_blocks, alia_dimensions, alia_extraction = extract_digital(
        args.alia, alia_dir, ALIA_METADATA
    )
    alia_qa = emit_document(
        alia_dir,
        ALIA_METADATA["citationKey"],
        args.alia,
        ALIA_METADATA,
        alia_blocks,
        alia_dimensions,
        alia_extraction,
    )

    catalog = {
        "schemaVersion": 1,
        "engine": {
            "prototype": True,
            "remoteServices": False,
            "platformApis": [
                {
                    "name": "Apple Vision",
                    "bundledWith": "macOS",
                    "redistributed": False,
                    "role": "local OCR",
                }
            ],
            "components": [
                {
                    "name": "pdfplumber / pdfminer.six",
                    "license": "MIT",
                    "role": "native PDF text, layout, coordinates, and embedded-image extraction",
                },
                {
                    "name": "PyObjC",
                    "license": "MIT",
                    "role": "Python bridge to the macOS Vision API",
                },
                {
                    "name": "pyspellchecker",
                    "license": "MIT",
                    "role": "conservative OCR anomaly detection and normalization",
                },
            ],
        },
        "collections": [
            {
                "id": "prototype",
                "name": "Prototipo de lector",
                "items": [GARCIA_METADATA["storageId"], ALIA_METADATA["storageId"]],
                "children": [],
            }
        ],
        "items": {
            GARCIA_METADATA["storageId"]: {
                "path": GARCIA_METADATA["storageId"],
                "citationKey": GARCIA_METADATA["citationKey"],
                "origin": "zotero",
            },
            ALIA_METADATA["storageId"]: {
                "path": ALIA_METADATA["storageId"],
                "citationKey": ALIA_METADATA["citationKey"],
                "origin": "zotero",
            },
        },
    }
    (root / "library.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    summary = {
        GARCIA_METADATA["citationKey"]: garcia_qa,
        ALIA_METADATA["citationKey"]: alia_qa,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
