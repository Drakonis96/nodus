#!/usr/bin/env python3
"""Extract scan-page images and OCR them locally with macOS Vision.

Dependencies are deliberately small and MIT-licensed: pdfplumber/pdfminer.six
and PyObjC's Vision bridge. The OCR model is part of macOS; no model download or
remote service is used.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import objc
import pdfplumber
import Vision


def recognize(image_bytes: bytes, languages: list[str]) -> list[dict[str, Any]]:
    with objc.autorelease_pool():
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(0)  # VNRequestTextRecognitionLevelAccurate
        available = set(request.supportedRecognitionLanguagesAndReturnError_(None)[0])
        selected = [language for language in languages if language in available]
        if selected:
            request.setRecognitionLanguages_(selected)
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(image_bytes, None)
        result = handler.performRequests_error_([request], None)
        ok, error = result if isinstance(result, tuple) else (bool(result), None)
        if not ok or error is not None:
            raise RuntimeError(f"Apple Vision OCR failed: {error}")
        lines: list[dict[str, Any]] = []
        for observation in request.results():
            bbox = observation.boundingBox()
            lines.append(
                {
                    "text": str(observation.text()),
                    "confidence": float(observation.confidence()),
                    "bbox": [
                        float(bbox.origin.x),
                        float(bbox.origin.y),
                        float(bbox.size.width),
                        float(bbox.size.height),
                    ],
                }
            )
        return lines


def full_page_scan(page: Any) -> dict[str, Any]:
    candidates = sorted(
        page.images,
        key=lambda image: float(image["width"]) * float(image["height"]),
        reverse=True,
    )
    if not candidates:
        raise ValueError(f"PDF page {page.page_number} has no embedded scan image")
    image = candidates[0]
    coverage = (float(image["width"]) * float(image["height"])) / (page.width * page.height)
    if coverage < 0.8:
        raise ValueError(f"PDF page {page.page_number} is not a full-page scan ({coverage:.1%})")
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--language", action="append", default=["es-ES"])
    parser.add_argument("--image-dir", type=Path)
    args = parser.parse_args()

    pages: list[dict[str, Any]] = []
    if args.image_dir:
        args.image_dir.mkdir(parents=True, exist_ok=True)
    with pdfplumber.open(args.pdf) as pdf:
        for page in pdf.pages:
            image = full_page_scan(page)
            encoded = image["stream"].get_rawdata()
            if args.image_dir:
                (args.image_dir / f"page-{page.page_number:03d}.jpg").write_bytes(encoded)
            pages.append(
                {
                    "page": page.page_number,
                    "width": int(image["srcsize"][0]),
                    "height": int(image["srcsize"][1]),
                    "native_text": page.extract_text() or "",
                    "ocr_lines": recognize(encoded, args.language),
                }
            )
            print(f"OCR {page.page_number}/{len(pdf.pages)}", flush=True)

    payload = {"source": str(args.pdf.resolve()), "pages": pages}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
