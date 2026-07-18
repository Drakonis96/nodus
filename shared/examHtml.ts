import {
  examExportContent,
  examAnswerLines,
  examDocumentLabels,
  examOptionLetter,
  examQuestionTypeDef,
  examTotalPoints,
  flattenExamBlocks,
  formatExamPoints,
  groupExamQuestions,
  type ExamExportOptions,
  type ExamQuestion,
  type TeachingExam,
} from './teachingExams';

/**
 * Renders the exam as a self-contained A4 HTML document.
 *
 * The same markup is used for the builder's live preview and for the PDF (printed
 * through Electron's `printToPDF`), so what the teacher sees on screen is exactly what
 * comes out of the printer — no second layout engine to keep in sync. Images and logos
 * are inlined as data URIs, so the document has no external dependencies.
 */

export interface ExamHtmlOptions extends ExamExportOptions {
  /** Screen preview drops the page shadow/margins that only make sense on paper. */
  forPreview?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Preserve the teacher's paragraph breaks without allowing markup through. */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

function answerLinesHtml(count: number): string {
  if (count <= 0) return '';
  return `<div class="lines">${'<div class="line"></div>'.repeat(count)}</div>`;
}

function questionBodyHtml(question: ExamQuestion, exam: TeachingExam): string {
  const labels = examDocumentLabels(exam.language);
  const def = examQuestionTypeDef(question.type);
  switch (question.type) {
    case 'multiple_choice':
      return `<ol class="options">${question.options
        .filter((option) => option.text.trim())
        .map((option, index) => `<li><span class="box"></span><span class="letter">${examOptionLetter(index)})</span> ${escapeHtml(option.text)}</li>`)
        .join('')}</ol>`;
    case 'true_false':
      return `<div class="tf"><span class="box"></span> ${escapeHtml(labels.trueLabel)} <span class="box tf-gap"></span> ${escapeHtml(labels.falseLabel)}</div>`;
    case 'matching': {
      const pairs = question.pairs.filter((pair) => pair.left.trim() && pair.right.trim());
      // The right column is presented in its stored order; the teacher shuffles it when
      // authoring if they want, so the printed key stays predictable.
      return `<table class="matching"><thead><tr><th>${escapeHtml(labels.columnA)}</th><th></th><th>${escapeHtml(labels.columnB)}</th></tr></thead><tbody>${pairs
        .map((pair, index) => `<tr><td>${index + 1}. ${escapeHtml(pair.left)}</td><td class="dot">•&nbsp;&nbsp;&nbsp;&nbsp;•</td><td>${examOptionLetter(index)}) ${escapeHtml(pair.right)}</td></tr>`)
        .join('')}</tbody></table>`;
    }
    case 'ordering':
      return `<ol class="ordering">${question.items
        .filter((item) => item.trim())
        .map((item) => `<li><span class="num-box"></span> ${escapeHtml(item)}</li>`)
        .join('')}</ol>`;
    case 'image_comment': {
      const image = question.imageDataUrl
        ? `<figure class="figure"><img src="${escapeHtml(question.imageDataUrl)}" alt="" />${question.imageCaption ? `<figcaption>${escapeHtml(question.imageCaption)}</figcaption>` : ''}</figure>`
        : '';
      return `${image}${answerLinesHtml(examAnswerLines(question))}`;
    }
    default:
      return answerLinesHtml(examAnswerLines(question));
  }
}

function headerHtml(exam: TeachingExam, questions: ExamQuestion[]): string {
  const labels = examDocumentLabels(exam.language);
  const header = exam.header;
  const logos = exam.logos
    .filter((logo) => logo.dataUrl)
    .map((logo) => `<img class="logo" src="${escapeHtml(logo.dataUrl)}" alt="" />`)
    .join('');
  const titleLine = header.examTitle?.trim() || exam.title;
  const meta: string[] = [];
  if (header.subjectName.trim()) meta.push(escapeHtml(header.subjectName));
  if (header.teachers.trim()) meta.push(escapeHtml(header.teachers));
  if (header.durationMinutes) meta.push(`${escapeHtml(labels.duration)}: ${header.durationMinutes} ${escapeHtml(labels.minutes)}`);
  if (header.showPoints) meta.push(`${escapeHtml(labels.total)}: ${escapeHtml(formatExamPoints(examTotalPoints(questions), exam.language))}`);

  const fields: string[] = [];
  if (header.showStudentName) fields.push(`<div class="field wide"><span>${escapeHtml(labels.studentName)}</span><i></i></div>`);
  if (header.showStudentId) fields.push(`<div class="field"><span>${escapeHtml(labels.studentId)}</span><i></i></div>`);
  if (header.showGroup) fields.push(`<div class="field"><span>${escapeHtml(labels.group)}</span><i></i></div>`);
  if (header.showDate) fields.push(`<div class="field"><span>${escapeHtml(labels.date)}</span><i></i>${header.dateText.trim() ? `<em>${escapeHtml(header.dateText)}</em>` : ''}</div>`);

  return `<header class="exam-header">
    <div class="brand">
      ${logos ? `<div class="logos">${logos}</div>` : ''}
      <div class="brand-text">
        ${header.institution.trim() ? `<div class="institution">${escapeHtml(header.institution)}</div>` : ''}
        <h1>${escapeHtml(titleLine)}</h1>
        ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
      </div>
      ${header.showGradeBox ? `<div class="grade"><span>${escapeHtml(labels.grade)}</span><div class="grade-box"></div></div>` : ''}
    </div>
    ${fields.length ? `<div class="fields">${fields.join('')}</div>` : ''}
    ${header.instructions.trim() ? `<div class="instructions"><strong>${escapeHtml(labels.instructions)}:</strong> ${escapeMultiline(header.instructions)}</div>` : ''}
  </header>`;
}

/** The key on its own is a marker's document: title only, no student name fields. */
function keyHeaderHtml(exam: TeachingExam): string {
  const labels = examDocumentLabels(exam.language);
  const title = exam.header.examTitle?.trim() || exam.title;
  const meta = [exam.header.subjectName, exam.header.teachers].filter((part) => part.trim()).map(escapeHtml).join(' · ');
  return `<header class="exam-header"><div class="brand"><div class="brand-text">
    <div class="institution">${escapeHtml(labels.answerKey)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div></div></header>`;
}

function answerKeyHtml(exam: TeachingExam, blocks: ReturnType<typeof groupExamQuestions>, standalone = false): string {
  const labels = examDocumentLabels(exam.language);
  // Sections themselves have no answer, so the key lists only what is actually marked —
  // under the same numbers the student's paper shows.
  const rows = flattenExamBlocks(blocks)
    .map(({ question, number }) => {
      const def = examQuestionTypeDef(question.type);
      let answer = escapeMultiline(question.solution);
      if (question.type === 'multiple_choice') {
        const correct = question.options.findIndex((option) => option.correct);
        const letter = correct >= 0 ? `${examOptionLetter(correct)}) ${escapeHtml(question.options[correct]?.text ?? '')}` : '';
        answer = [letter, answer].filter(Boolean).join(' — ');
      } else if (question.type === 'true_false') {
        const isTrue = question.options.find((option) => option.correct)?.text === 'Verdadero';
        answer = [escapeHtml(isTrue ? labels.trueLabel : labels.falseLabel), answer].filter(Boolean).join(' — ');
      } else if (question.type === 'matching') {
        const pairs = question.pairs
          .filter((pair) => pair.left.trim() && pair.right.trim())
          .map((pair, pairIndex) => `${pairIndex + 1}–${examOptionLetter(pairIndex)}`)
          .join(', ');
        answer = [escapeHtml(pairs), answer].filter(Boolean).join(' — ');
      } else if (question.type === 'ordering') {
        answer = [escapeHtml(question.items.filter((item) => item.trim()).join(' → ')), answer].filter(Boolean).join(' — ');
      }
      return `<li><strong>${labels.question} ${escapeHtml(number)}</strong> (${escapeHtml(def.label)}): ${answer || '—'}</li>`;
    })
    .join('');
  return `<section class="answer-key${standalone ? ' standalone' : ''}"><h2>${escapeHtml(labels.answerKey)}</h2><ol>${rows}</ol></section>`;
}

const STYLES = `
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Iowan Old Style", Georgia, "Times New Roman", serif; font-size: 11.5pt; line-height: 1.45; color: #111; background: #fff; }
  .sheet { padding: 0; }
  .exam-header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .logos { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .logo { max-height: 56px; max-width: 130px; object-fit: contain; }
  .brand-text { flex: 1; min-width: 0; }
  .institution { font-size: 9.5pt; letter-spacing: .08em; text-transform: uppercase; color: #444; }
  .exam-header h1 { font-size: 16pt; margin: 2px 0 0; font-weight: 700; }
  .meta { font-size: 9.5pt; color: #444; margin-top: 3px; }
  .grade { flex-shrink: 0; text-align: center; font-size: 9pt; color: #444; }
  .grade-box { width: 62px; height: 44px; border: 1.5px solid #111; border-radius: 3px; margin-top: 3px; }
  .fields { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; font-size: 10pt; }
  .field { display: flex; align-items: baseline; gap: 6px; flex: 1 1 150px; }
  .field.wide { flex: 2 1 320px; }
  .field span { color: #333; white-space: nowrap; }
  .field i { flex: 1; border-bottom: 1px dotted #555; min-width: 60px; height: 1em; }
  .field em { font-style: normal; color: #111; }
  .instructions { margin-top: 11px; font-size: 10pt; background: #f4f4f4; border-left: 3px solid #888; padding: 7px 10px; }
  .question { margin: 0 0 15px; page-break-inside: avoid; }
  .q-head { display: flex; gap: 8px; align-items: baseline; }
  .q-num { font-weight: 700; flex-shrink: 0; }
  .q-prompt { flex: 1; }
  .q-points { flex-shrink: 0; font-size: 9pt; color: #444; white-space: nowrap; }
  /* A grouped exercise: the shared statement reads as the exercise, its sub-questions
     are indented under it and may break across pages if the block is long. */
  .exercise { margin: 0 0 17px; }
  .section-head { padding-bottom: 5px; border-bottom: 1px solid #d5d5d5; margin-bottom: 8px; }
  .section-head .q-prompt { font-weight: 600; }
  .sub-questions { padding-left: 15px; }
  .sub-questions .question { margin-bottom: 11px; }
  .sub-questions .question:last-child { margin-bottom: 0; }
  .sub-question .q-num { font-weight: 600; color: #333; }
  .lines { margin-top: 7px; }
  .line { border-bottom: 1px solid #c4c4c4; height: 1.55em; }
  .options { list-style: none; margin: 7px 0 0; padding: 0 0 0 6px; }
  .options li { margin: 4px 0; display: flex; align-items: baseline; gap: 7px; }
  .letter { font-weight: 600; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1.2px solid #111; border-radius: 2px; flex-shrink: 0; }
  .tf { margin-top: 7px; display: flex; align-items: center; gap: 7px; }
  .tf-gap { margin-left: 22px; }
  .matching { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10.5pt; }
  .matching th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #bbb; padding-bottom: 3px; }
  .matching td { padding: 5px 6px; vertical-align: top; }
  .matching .dot { text-align: center; color: #888; white-space: nowrap; width: 70px; }
  .ordering { list-style: none; margin: 7px 0 0; padding: 0 0 0 6px; }
  .ordering li { margin: 5px 0; display: flex; align-items: baseline; gap: 8px; }
  .num-box { display: inline-block; width: 22px; height: 15px; border: 1.2px solid #111; border-radius: 2px; flex-shrink: 0; }
  .figure { margin: 9px 0; text-align: center; }
  .figure img { max-width: 100%; max-height: 78mm; object-fit: contain; }
  .figure figcaption { font-size: 9pt; color: #555; margin-top: 3px; font-style: italic; }
  .answer-key { page-break-before: always; border-top: 2px solid #111; padding-top: 12px; }
  /* On its own the key opens the document, so it must not push a blank first page. */
  .answer-key.standalone { page-break-before: auto; border-top: 0; padding-top: 0; }
  .answer-key h2 { font-size: 13pt; margin: 0 0 8px; }
  /* Each row prints its own question number ("Question 6.1"), so the list must not add a
     second, different counter down the margin. */
  .answer-key ol { list-style: none; padding-left: 0; font-size: 10pt; }
  .answer-key li { margin: 5px 0; }
  .preview-body { background: #f1f1f1; padding: 22px; }
  .preview-body .sheet { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 15mm 18mm; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
  /* The sheet is a real A4 (210mm ≈ 794px) and the preview pane is narrower, so scale
     it down to fit instead of forcing a horizontal scrollbar. Media queries read the
     IFRAME's width, which keeps this pure CSS — the preview is sandboxed with no JS.
     Uses zoom rather than transform so the scaled sheet still reserves its layout box. */
  @media (max-width: 900px) { .preview-body { padding: 16px; } .preview-body .sheet { zoom: 0.85; } }
  @media (max-width: 780px) { .preview-body .sheet { zoom: 0.72; } }
  @media (max-width: 660px) { .preview-body { padding: 12px; } .preview-body .sheet { zoom: 0.6; } }
  @media (max-width: 540px) { .preview-body .sheet { zoom: 0.5; } }
  @media (max-width: 440px) { .preview-body .sheet { zoom: 0.4; } }
`;

export function renderExamHtml(exam: TeachingExam, questions: ExamQuestion[], options: ExamHtmlOptions = {}): string {
  const labels = examDocumentLabels(exam.language);
  const content = examExportContent(options);
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const blocks = groupExamQuestions(ordered);
  const questionHtml = (question: ExamQuestion, number: string, nested: boolean): string => {
    const points = exam.header.showPoints ? `<span class="q-points">${escapeHtml(formatExamPoints(question.points, exam.language))}</span>` : '';
    return `<article class="question${nested ? ' sub-question' : ''}">
      <div class="q-head"><span class="q-num">${escapeHtml(number)}${nested ? ')' : '.'}</span><span class="q-prompt">${escapeMultiline(question.prompt)}</span>${points}</div>
      ${questionBodyHtml(question, exam)}
    </article>`;
  };
  const body = content === 'keyOnly' ? '' : blocks
    .map((block) => {
      if (!block.section) {
        const only = block.questions[0];
        return only ? questionHtml(only.question, only.number, false) : '';
      }
      // The statement carries the exercise's whole mark, so the teacher writes the marks
      // once per sub-question and the header total is always the sum.
      const points = exam.header.showPoints
        ? `<span class="q-points">${escapeHtml(formatExamPoints(block.points, exam.language))}</span>`
        : '';
      const image = block.section.imageDataUrl
        ? `<figure class="figure"><img src="${escapeHtml(block.section.imageDataUrl)}" alt="" />${block.section.imageCaption ? `<figcaption>${escapeHtml(block.section.imageCaption)}</figcaption>` : ''}</figure>`
        : '';
      return `<section class="exercise">
        <div class="q-head section-head"><span class="q-num">${escapeHtml(block.number)}.</span><span class="q-prompt">${escapeMultiline(block.section.prompt)}</span>${points}</div>
        ${image}
        <div class="sub-questions">${block.questions.map((entry) => questionHtml(entry.question, entry.number, true)).join('')}</div>
      </section>`;
    })
    .join('');
  const key = content === 'exam' ? '' : answerKeyHtml(exam, blocks, content === 'keyOnly');
  const lang = exam.language === 'pt-BR' ? 'pt-BR' : exam.language;
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head><meta charset="utf-8" /><title>${escapeHtml(exam.header.examTitle?.trim() || exam.title)}</title><style>${STYLES}</style></head>
<body class="${options.forPreview ? 'preview-body' : ''}">
  <div class="sheet">
    ${content === 'keyOnly' ? keyHeaderHtml(exam) : headerHtml(exam, ordered)}
    ${content === 'keyOnly' ? '' : `<main>${body || `<p style="color:#888">${escapeHtml(labels.question)} —</p>`}</main>`}
    ${key}
  </div>
</body>
</html>`;
}
