#!/usr/bin/env python3
"""Build the five Nodus Wiki vault manuals from the website's shared content."""

from __future__ import annotations

import html
import json
import shutil
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageStat
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
CONTENT_PATH = ROOT / "site" / "wiki" / "content.json"
ASSETS = ROOT / "site" / "wiki" / "assets"
LOGO = ROOT / "site" / "assets" / "nodus-logo.png"
OUTPUT = ROOT / "output" / "pdf"
PUBLIC = ROOT / "site" / "manuals"
LIGHT_CAPTURE_CACHE = ROOT / "tmp" / "pdfs" / "light-captures"
PAGE_W, PAGE_H = A4


def rgb(hex_value: str) -> colors.Color:
    value = hex_value.lstrip("#")
    return colors.Color(*(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)))


INK = rgb("#172033")
MUTED = rgb("#657086")
PAPER = rgb("#fbfaf8")
LINE = rgb("#dfe3ea")
VIOLET = rgb("#7257d7")


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, *, title: str, vault_name: str, accent: colors.Color, version: str, updated: str):
        super().__init__(
            filename,
            pagesize=A4,
            rightMargin=22 * mm,
            leftMargin=22 * mm,
            topMargin=25 * mm,
            bottomMargin=22 * mm,
            title=title,
            author="Nodus",
            subject=f"Complete manual for the Nodus {vault_name} vault",
            creator="Nodus Wiki manual builder",
        )
        self.manual_title = title
        self.vault_name = vault_name
        self.accent = accent
        self.version = version
        self.updated = updated
        self._bookmark_counter = 0
        body_frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="manual", frames=[body_frame], onPage=self._draw_page))

    def beforeDocument(self):
        # multiBuild performs several passes while resolving the table of contents.
        # Stable bookmark keys are required for the index to converge.
        self._bookmark_counter = 0

    def _draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        if doc.page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.55)
            canvas.line(self.leftMargin, PAGE_H - 16 * mm, PAGE_W - self.rightMargin, PAGE_H - 16 * mm)
            if LOGO.exists():
                canvas.drawImage(str(LOGO), self.leftMargin, PAGE_H - 13.2 * mm, width=7 * mm, height=7 * mm, mask="auto", preserveAspectRatio=True)
            canvas.setFillColor(INK)
            canvas.setFont("Helvetica-Bold", 8.2)
            canvas.drawString(self.leftMargin + 9 * mm, PAGE_H - 11.4 * mm, "NODUS")
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 7.4)
            canvas.drawRightString(PAGE_W - self.rightMargin, PAGE_H - 11.4 * mm, f"{self.vault_name.upper()} VAULT MANUAL")
            canvas.setStrokeColor(LINE)
            canvas.line(self.leftMargin, 14.5 * mm, PAGE_W - self.rightMargin, 14.5 * mm)
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 7.5)
            canvas.drawString(self.leftMargin, 10.2 * mm, f"Nodus {self.version} · User guide · {self.updated}")
            canvas.drawRightString(PAGE_W - self.rightMargin, 10.2 * mm, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "toc_level", None)
        if level is None:
            return
        self._bookmark_counter += 1
        key = f"section-{self._bookmark_counter}"
        title = flowable.getPlainText()
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title, key, level=level, closed=level > 0)
        self.notify("TOCEntry", (level, title, self.page, key))


def styles(accent: colors.Color):
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle("CoverKicker", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=accent, spaceAfter=8, uppercase=True, tracking=1.8),
        "cover_title": ParagraphStyle("CoverTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=32, leading=36, textColor=INK, alignment=TA_LEFT, spaceAfter=10),
        "cover_subtitle": ParagraphStyle("CoverSubtitle", parent=base["Normal"], fontName="Helvetica", fontSize=14, leading=21, textColor=MUTED, spaceAfter=14),
        "cover_meta": ParagraphStyle("CoverMeta", parent=base["Normal"], fontName="Helvetica", fontSize=8.5, leading=13, textColor=MUTED),
        "h1": ParagraphStyle("ManualHeading1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=INK, spaceBefore=5, spaceAfter=10, keepWithNext=True),
        "h2": ParagraphStyle("ManualHeading2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INK, spaceBefore=7, spaceAfter=7, keepWithNext=True),
        "eyebrow": ParagraphStyle("Eyebrow", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=accent, tracking=1.2, spaceBefore=4, spaceAfter=4),
        "lead": ParagraphStyle("Lead", parent=base["Normal"], fontName="Helvetica", fontSize=11.2, leading=17, textColor=INK, alignment=TA_JUSTIFY, firstLineIndent=7 * mm, spaceAfter=8),
        "body": ParagraphStyle("BodyJustified", parent=base["BodyText"], fontName="Helvetica", fontSize=9.4, leading=14.2, textColor=INK, alignment=TA_JUSTIFY, firstLineIndent=7 * mm, spaceAfter=8),
        "step": ParagraphStyle("Step", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=INK, leftIndent=9 * mm, firstLineIndent=-6 * mm, spaceAfter=5),
        "tip": ParagraphStyle("Tip", parent=base["BodyText"], fontName="Helvetica", fontSize=8.7, leading=13, textColor=INK, leftIndent=5 * mm, bulletIndent=0, spaceAfter=3),
        "caption": ParagraphStyle("Caption", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=7.4, leading=10, textColor=MUTED, alignment=TA_CENTER, spaceBefore=4, spaceAfter=9),
        "toc_title": ParagraphStyle("TOCTitle", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=24, leading=29, textColor=INK, spaceAfter=18),
        "toc0": ParagraphStyle("TOC0", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, leading=16, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=4),
        "toc1": ParagraphStyle("TOC1", parent=base["Normal"], fontName="Helvetica", fontSize=8.8, leading=14, textColor=MUTED, leftIndent=7 * mm, firstLineIndent=0),
    }


def heading(text: str, style: ParagraphStyle, level: int) -> Paragraph:
    flowable = Paragraph(html.escape(text), style)
    flowable.toc_level = level
    return flowable


def light_document_capture(source: PILImage.Image) -> PILImage.Image:
    """Return a light-paper edition of a dark UI capture for the PDF manuals.

    The website keeps the original dark screenshots. This print-only transform
    reverses neutral luminance while retaining the hue of Nodus vault accents,
    so the PDF has white surfaces and dark text without maintaining a second
    manually captured image set.
    """
    image = source.convert("RGB")
    sample = image.resize((64, 64))
    if sum(ImageStat.Stat(sample).mean) / 3 >= 112:
        return image

    try:
        import numpy as np
    except ImportError:
        # The current PDF runtime includes NumPy. Keep a safe monochrome-light
        # fallback for minimal ReportLab environments.
        luminance = image.convert("L")
        lightness = luminance.point(lambda value: max(20, min(248, round(248 - value * 0.91))))
        return PILImage.merge("RGB", (lightness, lightness, lightness))

    pixels = np.asarray(image, dtype=np.float32)
    luma = pixels[..., 0] * 0.2126 + pixels[..., 1] * 0.7152 + pixels[..., 2] * 0.0722
    target = np.clip(248.0 - luma * 0.91, 22.0, 248.0)
    neutral = target[..., None] + (pixels - luma[..., None]) * 0.24

    chroma = pixels.max(axis=2) - pixels.min(axis=2)
    saturation = chroma / np.maximum(pixels.max(axis=2), 1.0)
    # Keep saturated UI accents recognisable, but brighten very dark accent
    # fills slightly so labels remain legible on paper.
    accent = pixels * 0.88 + 18.0
    mix = np.clip((saturation - 0.27) / 0.32, 0.0, 0.82)[..., None]
    converted = neutral * (1.0 - mix) + accent * mix
    return PILImage.fromarray(np.clip(converted, 0, 255).astype("uint8"), "RGB")


def screenshot(path: Path, max_width: float, max_height: float = 98 * mm, caption: str = "Nodus desktop application"):
    if not path.exists():
        return []
    with PILImage.open(path) as source:
        converted = light_document_capture(source)
        width, height = converted.size
        scale = min(max_width / width, max_height / height)
        target_w, target_h = width * scale, height * scale
        buffer = BytesIO()
        converted.save(buffer, format="JPEG", quality=84, optimize=True, progressive=True)
        buffer.seek(0)
    return [Image(buffer, width=target_w, height=target_h), Paragraph(html.escape(caption), CURRENT_STYLES["caption"])]


def location_box(chapter: dict, vault_name: str | None):
    location = chapter.get("location") or (f"{vault_name} vault → {chapter['title']}" if vault_name else f"Nodus → {chapter['title']}")
    table = Table([
        [Paragraph("WHERE TO FIND IT", CURRENT_STYLES["eyebrow"])],
        [Paragraph(html.escape(location), CURRENT_STYLES["tip"])],
    ], colWidths=[None], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f5f3f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 3 * mm), ("BOTTOMPADDING", (0, -1), (-1, -1), 3 * mm),
    ]))
    return table


def step_box(chapter: dict, accent: colors.Color):
    items = [Paragraph(f"<b>{index}.</b> {html.escape(step)}", CURRENT_STYLES["step"]) for index, step in enumerate(chapter["steps"], 1)]
    content = [[Paragraph("STEP BY STEP", CURRENT_STYLES["eyebrow"])], *[[item] for item in items]]
    table = Table(content, colWidths=[None], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.Color(accent.red, accent.green, accent.blue, alpha=0.055)),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.Color(accent.red, accent.green, accent.blue, alpha=0.32)),
        ("LEFTPADDING", (0, 0), (-1, -1), 6 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 6 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 4 * mm), ("BOTTOMPADDING", (0, -1), (-1, -1), 4 * mm),
    ]))
    return table


def add_chapter(story: list, chapter: dict, number: str, accent: colors.Color, include_image: bool, vault_name: str | None = None):
    story.append(Paragraph(html.escape(chapter["group"].upper()), CURRENT_STYLES["eyebrow"]))
    story.append(heading(f"{number}  {chapter['title']}", CURRENT_STYLES["h2"], 1))
    story.append(Paragraph(html.escape(chapter["summary"]), CURRENT_STYLES["lead"]))
    story.append(Paragraph(html.escape(chapter["details"]), CURRENT_STYLES["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(location_box(chapter, vault_name))
    story.append(Spacer(1, 4 * mm))
    story.append(step_box(chapter, accent))
    story.append(Spacer(1, 4 * mm))
    tips = [Paragraph(f"• {html.escape(tip)}", CURRENT_STYLES["tip"]) for tip in chapter["tips"]]
    tip_table = Table([[Paragraph("GOOD PRACTICE", CURRENT_STYLES["eyebrow"])], *[[tip] for tip in tips]], colWidths=[None])
    tip_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f3f1fb")),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 3 * mm), ("BOTTOMPADDING", (0, -1), (-1, -1), 3 * mm),
    ]))
    story.append(tip_table)
    if include_image:
        story.append(Spacer(1, 5 * mm))
        story.extend(screenshot(ASSETS / chapter["image"], 166 * mm, caption=f"{chapter['title']} in the Nodus desktop application"))
    story.append(Spacer(1, 7 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceBefore=2 * mm, spaceAfter=4 * mm))


def build_manual(content: dict, vault: dict):
    global CURRENT_STYLES
    accent = rgb(vault["accent"])
    CURRENT_STYLES = styles(accent)
    filename = f"nodus-{vault['id'].replace('_', '-')}-manual.pdf"
    target = OUTPUT / filename
    public_target = PUBLIC / filename
    title = f"Nodus {vault['name']} Vault Manual"
    doc = ManualDocTemplate(str(target), title=title, vault_name=vault["name"], accent=accent, version=content["version"], updated=content["updated"])
    story = []

    story.append(Spacer(1, 23 * mm))
    if LOGO.exists():
        story.append(Image(str(LOGO), width=25 * mm, height=25 * mm, hAlign="LEFT"))
        story.append(Spacer(1, 12 * mm))
    story.append(Paragraph("NODUS · COMPLETE VAULT GUIDE", CURRENT_STYLES["cover_kicker"]))
    story.append(Paragraph(html.escape(vault["name"]), CURRENT_STYLES["cover_title"]))
    story.append(Paragraph(html.escape(vault["tagline"]), CURRENT_STYLES["cover_subtitle"]))
    story.append(HRFlowable(width="100%", thickness=3, color=accent, spaceBefore=4 * mm, spaceAfter=7 * mm))
    story.append(Paragraph(html.escape(vault["description"]), CURRENT_STYLES["body"]))
    story.append(Spacer(1, 12 * mm))
    meta = Table([
        ["VERSION", f"Nodus {content['version']}"], ["UPDATED", content["updated"]], ["AUDIENCE", vault["audience"]],
    ], colWidths=[28 * mm, 118 * mm])
    meta.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 7.5), ("TEXTCOLOR", (0, 0), (0, -1), accent),
        ("FONT", (1, 0), (1, -1), "Helvetica", 8.5), ("TEXTCOLOR", (1, 0), (1, -1), MUTED),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 3 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    story.append(meta)
    story.append(PageBreak())

    story.append(Paragraph("Contents", CURRENT_STYLES["toc_title"]))
    story.append(Paragraph("Core operation, configuration and the complete vault workflow.", CURRENT_STYLES["lead"]))
    toc = TableOfContents()
    toc.levelStyles = [CURRENT_STYLES["toc0"], CURRENT_STYLES["toc1"]]
    toc.dotsMinLevel = 0
    story.append(toc)
    story.append(PageBreak())

    story.append(Paragraph("PART I · FOUNDATION", CURRENT_STYLES["eyebrow"]))
    story.append(heading("Core Nodus workflow", CURRENT_STYLES["h1"], 0))
    story.append(Paragraph("Start here if Nodus is new to you. These chapters explain what a vault is, how to move through the application, how sources remain traceable, when a model is optional and how to keep a recoverable copy of the work.", CURRENT_STYLES["lead"]))
    for index, chapter in enumerate(content["common"], 1):
        add_chapter(story, chapter, f"{index}", accent, include_image=index in {1, 2, 3, 4, 7})

    story.append(PageBreak())
    story.append(Paragraph("PART II · VAULT GUIDE", CURRENT_STYLES["eyebrow"]))
    story.append(heading(f"Complete {vault['name']} workflow", CURRENT_STYLES["h1"], 0))
    story.append(Paragraph(html.escape(vault["description"]), CURRENT_STYLES["lead"]))
    story.extend(screenshot(ASSETS / vault["id"] / "home.png", 166 * mm, 92 * mm, caption=f"{vault['name']} vault home in the Nodus desktop application"))
    for index, chapter in enumerate(vault["chapters"], 1):
        add_chapter(story, chapter, f"{index}", accent, include_image=(index == 1 or index % 2 == 0), vault_name=vault["name"])

    story.append(PageBreak())
    story.append(Paragraph("REFERENCE", CURRENT_STYLES["eyebrow"]))
    story.append(heading("Completion checklist", CURRENT_STYLES["h1"], 0))
    checklist = [
        "The vault scope and name match the project.", "Sources or records have preserved originals and reviewed metadata.",
        "Generated interpretations have been checked against their evidence.", "Optional providers and integrations use only the intended data.",
        "Exports have been proofread in their final format.", "A recent backup has been created and verified.",
    ]
    for item in checklist:
        story.append(Paragraph(f"□  {html.escape(item)}", CURRENT_STYLES["step"]))
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(f"This manual documents the desktop workflow represented in Nodus {content['version']}. Interface details may evolve between releases; the in-app privacy notice and release notes govern the exact behaviour of the installed version.", CURRENT_STYLES["body"]))

    doc.multiBuild(story)
    shutil.copy2(target, public_target)
    return target, public_target


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    content = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    public_manuals = []
    for vault in content["vaults"]:
        target, public_target = build_manual(content, vault)
        public_manuals.append(public_target)
        print(f"Built {target.relative_to(ROOT)} and {public_target.relative_to(ROOT)}")
    bundle = PUBLIC / "nodus-vault-manuals.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for manual in public_manuals:
            archive.write(manual, arcname=manual.name)
    print(f"Built {bundle.relative_to(ROOT)} with {len(public_manuals)} manuals")


if __name__ == "__main__":
    main()
