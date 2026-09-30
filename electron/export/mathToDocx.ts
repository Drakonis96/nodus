/**
 * LaTeX → native, editable Word equations. KaTeX (with mhchem) produces MathML; this
 * walks that small, well-formed tree and builds the `docx` package's Math components,
 * which Word stores as OMML. Anything outside the supported subset throws, and the
 * caller prints the LaTeX source instead — never a half-converted formula.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';
import {
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
} from 'docx';

type MathComponent = MathRun | MathFraction | MathRadical | MathSubScript | MathSubSuperScript | MathSuperScript;

interface XmlNode { tag: string; children: XmlNode[]; text?: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Minimal parser for KaTeX's MathML (elements, attributes ignored, text, entities). */
export function parseMathMl(xml: string): XmlNode {
  const root: XmlNode = { tag: '#root', children: [] };
  const stack: XmlNode[] = [root];
  const pattern = /<\/?([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(pattern)) {
    const [whole, tag, , selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (text.trim() || top.tag === 'mtext' || top.tag === 'mo') top.children.push({ tag: '#text', children: [], text: decode(text) });
    } else if (whole.startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else {
      const node: XmlNode = { tag: tag.replace(/^.*:/, ''), children: [] };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  return root;
}

class UnsupportedMath extends Error {}

function elements(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => child.tag !== '#text');
}

function textOf(node: XmlNode): string {
  return node.children.map((child) => (child.tag === '#text' ? child.text ?? '' : textOf(child))).join('');
}

function convert(node: XmlNode): MathComponent[] {
  const kids = elements(node);
  const arg = (index: number) => {
    const child = kids[index];
    if (!child) throw new UnsupportedMath(`missing argument of ${node.tag}`);
    return convert(child);
  };
  switch (node.tag) {
    case '#root': case 'span': case 'math': case 'semantics': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose':
      return kids.flatMap(convert);
    case 'annotation': case 'annotation-xml': case 'mphantom':
      return [];
    case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': {
      const value = textOf(node);
      return value ? [new MathRun(value)] : [];
    }
    case 'mspace':
      return [new MathRun(' ')];
    case 'mfrac':
      return [new MathFraction({ numerator: arg(0), denominator: arg(1) })];
    case 'msqrt':
      return [new MathRadical({ children: kids.flatMap(convert) })];
    case 'mroot':
      return [new MathRadical({ children: arg(0), degree: arg(1) })];
    case 'msup': case 'mover':
      return [new MathSuperScript({ children: arg(0), superScript: arg(1) })];
    case 'msub': case 'munder':
      return [new MathSubScript({ children: arg(0), subScript: arg(1) })];
    case 'msubsup': case 'munderover':
      return [new MathSubSuperScript({ children: arg(0), subScript: arg(1), superScript: arg(2) })];
    default:
      throw new UnsupportedMath(node.tag);
  }
}

/** A Word equation for `tex`, or null when it falls outside the supported subset. */
export function latexToDocxMath(tex: string, display = false): DocxMath | null {
  try {
    const mathml = katex.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore', trust: false });
    const children = convert(parseMathMl(mathml));
    return children.length ? new DocxMath({ children }) : null;
  } catch {
    return null;
  }
}
