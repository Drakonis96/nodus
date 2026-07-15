#!/usr/bin/env python3
"""Create the small deterministic PDF used by the isolated Gemini study smoke test."""

from pathlib import Path
import sys

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/pdfs/shadow-study-source.pdf").resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ShadowTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=27,
        textColor=HexColor("#16324F"),
        spaceAfter=9 * mm,
    )
    heading = ParagraphStyle(
        "ShadowHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=HexColor("#0F766E"),
        spaceBefore=5 * mm,
        spaceAfter=2 * mm,
    )
    body = ParagraphStyle(
        "ShadowBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=16,
        textColor=HexColor("#263238"),
        spaceAfter=3 * mm,
    )
    doc = SimpleDocTemplate(
        str(target),
        pagesize=A4,
        rightMargin=22 * mm,
        leftMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="Material shadow - fotosintesis",
        author="Nodus isolated verification",
    )
    story = [
        Paragraph("Material shadow: fotosintesis y energia", title),
        Paragraph("1. Concepto central", heading),
        Paragraph(
            "La fotosintesis transforma energia luminosa en energia quimica. En las plantas, "
            "el proceso ocurre principalmente en los cloroplastos y utiliza agua y dioxido de "
            "carbono para formar glucosa y liberar oxigeno.",
            body,
        ),
        Paragraph("2. Fase luminosa", heading),
        Paragraph(
            "La fase luminosa tiene lugar en las membranas de los tilacoides. La clorofila absorbe "
            "fotones, se produce ATP y NADPH, y la fotolisis del agua libera oxigeno. ATP y NADPH "
            "transportan energia y poder reductor hacia el ciclo de Calvin.",
            body,
        ),
        Paragraph("3. Ciclo de Calvin", heading),
        Paragraph(
            "El ciclo de Calvin ocurre en el estroma. La enzima RuBisCO fija dioxido de carbono y, "
            "mediante reacciones que consumen ATP y NADPH, contribuye a formar moleculas organicas. "
            "Por tanto, la fase luminosa y el ciclo de Calvin son procesos distintos pero dependientes.",
            body,
        ),
        Spacer(1, 5 * mm),
        Paragraph(
            "Dato de control: en este material shadow se conserva el valor 50% para comprobar que "
            "una mejora de estilo no altera cifras protegidas.",
            body,
        ),
    ]
    doc.build(story)
    print(target)


if __name__ == "__main__":
    main()
