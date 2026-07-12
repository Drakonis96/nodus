/**
 * GEDCOM 5.5.1 parse + serialize over a neutral intermediate form. The genealogist
 * already has a tree; they must be able to bring it in and hand it back to Gramps /
 * Ancestry, so GEDCOM is the interop lingua franca. Pure and dependency-free; the
 * electron bridge maps this neutral form to and from Nodus persons/relationships.
 *
 * Supported: INDI (NAME, SEX, BIRT/DEAT with DATE + PLAC) and FAM (HUSB, WIFE, CHIL,
 * MARR with DATE + PLAC). Dates round-trip through the shared historical-date parser.
 */

import { parseHistoricalDate } from './genealogyDates';

export interface GedcomPerson {
  xref: string;
  name: string;
  given: string | null;
  surname: string | null;
  sex: 'M' | 'F' | null;
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
}

export interface GedcomFamily {
  xref: string;
  husband: string | null; // person xref
  wife: string | null;
  children: string[];
  marriageDate: string | null;
  marriagePlace: string | null;
}

export interface GedcomData {
  persons: GedcomPerson[];
  families: GedcomFamily[];
}

interface GedNode {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
  children: GedNode[];
}

const MONTHS_ES_TO_GED: Record<string, string> = {
  ene: 'JAN', feb: 'FEB', mar: 'MAR', abr: 'APR', may: 'MAY', jun: 'JUN',
  jul: 'JUL', ago: 'AUG', sep: 'SEP', oct: 'OCT', nov: 'NOV', dic: 'DEC',
};

function esMonthsToGed(text: string): string {
  return text.replace(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/gi, (m) => MONTHS_ES_TO_GED[m.toLowerCase()] ?? m);
}

/** Convert a Nodus date display ("c. 1850", "2 mar 1875", "entre X y Y") to a GEDCOM date. */
export function toGedcomDate(display: string | null | undefined): string {
  const s = (display ?? '').trim();
  if (!s) return '';
  let m: RegExpExecArray | null;
  if ((m = /^entre\s+(.+?)\s+y\s+(.+)$/i.exec(s))) return `BET ${esMonthsToGed(m[1])} AND ${esMonthsToGed(m[2])}`;
  if ((m = /^c\.\s*(.+)$/i.exec(s))) return `ABT ${esMonthsToGed(m[1])}`;
  if ((m = /^antes de\s+(.+)$/i.exec(s))) return `BEF ${esMonthsToGed(m[1])}`;
  if ((m = /^despu[eé]s de\s+(.+)$/i.exec(s))) return `AFT ${esMonthsToGed(m[1])}`;
  return esMonthsToGed(s);
}

/** Convert a GEDCOM date to a normalised Nodus display via the shared parser. */
export function fromGedcomDate(gedcom: string | null | undefined): string | null {
  const s = (gedcom ?? '').trim();
  if (!s) return null;
  const parsed = parseHistoricalDate(s);
  return parsed.sortKey || parsed.qualifier !== 'unknown' ? parsed.display : s;
}

// ── Parsing ────────────────────────────────────────────────────────────────

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

function parseNodes(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const level = Number(m[1]);
    // A leading @XREF@ before the tag is a record id; after the tag it's a value.
    const node: GedNode = { level, xref: m[2] ?? null, tag: m[3], value: (m[4] ?? '').trim(), children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

function child(node: GedNode, tag: string): GedNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function eventParts(node: GedNode, tag: string): { date: string | null; place: string | null } {
  const ev = child(node, tag);
  if (!ev) return { date: null, place: null };
  return { date: fromGedcomDate(child(ev, 'DATE')?.value ?? null), place: child(ev, 'PLAC')?.value || null };
}

function parseName(value: string): { name: string; given: string | null; surname: string | null } {
  // GEDCOM name: "Given /Surname/".
  const m = /^(.*?)\s*\/([^/]*)\/\s*(.*)$/.exec(value);
  if (!m) return { name: value.trim(), given: value.trim() || null, surname: null };
  const given = `${m[1].trim()} ${m[3].trim()}`.trim();
  const surname = m[2].trim() || null;
  const name = `${given} ${surname ?? ''}`.trim();
  return { name: name || value.trim(), given: given || null, surname };
}

export function parseGedcom(text: string): GedcomData {
  const roots = parseNodes(text);
  const persons: GedcomPerson[] = [];
  const families: GedcomFamily[] = [];

  for (const rec of roots) {
    if (rec.tag === 'INDI' && rec.xref) {
      const nameNode = child(rec, 'NAME');
      const parsedName = nameNode ? parseName(nameNode.value) : { name: rec.xref, given: null, surname: null };
      const sexVal = child(rec, 'SEX')?.value?.toUpperCase();
      const birth = eventParts(rec, 'BIRT');
      const death = eventParts(rec, 'DEAT');
      persons.push({
        xref: rec.xref,
        name: parsedName.name,
        given: parsedName.given,
        surname: parsedName.surname,
        sex: sexVal === 'M' ? 'M' : sexVal === 'F' ? 'F' : null,
        birthDate: birth.date,
        birthPlace: birth.place,
        deathDate: death.date,
        deathPlace: death.place,
      });
    } else if (rec.tag === 'FAM' && rec.xref) {
      const marriage = eventParts(rec, 'MARR');
      families.push({
        xref: rec.xref,
        husband: child(rec, 'HUSB')?.value || null,
        wife: child(rec, 'WIFE')?.value || null,
        children: rec.children.filter((c) => c.tag === 'CHIL').map((c) => c.value).filter(Boolean),
        marriageDate: marriage.date,
        marriagePlace: marriage.place,
      });
    }
  }
  return { persons, families };
}

// ── Serializing ──────────────────────────────────────────────────────────────

function nameValue(p: GedcomPerson): string {
  if (p.given || p.surname) return `${p.given ?? ''} /${p.surname ?? ''}/`.trim();
  return p.name;
}

function eventLines(tag: string, date: string | null, place: string | null): string[] {
  if (!date && !place) return [];
  const lines = [`1 ${tag}`];
  if (date) lines.push(`2 DATE ${toGedcomDate(date)}`);
  if (place) lines.push(`2 PLAC ${place}`);
  return lines;
}

export function serializeGedcom(data: GedcomData): string {
  const lines: string[] = [
    '0 HEAD',
    '1 SOUR Nodus',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
  ];

  for (const p of data.persons) {
    lines.push(`0 ${p.xref} INDI`);
    lines.push(`1 NAME ${nameValue(p)}`);
    if (p.sex) lines.push(`1 SEX ${p.sex}`);
    lines.push(...eventLines('BIRT', p.birthDate, p.birthPlace));
    lines.push(...eventLines('DEAT', p.deathDate, p.deathPlace));
  }

  for (const f of data.families) {
    lines.push(`0 ${f.xref} FAM`);
    if (f.husband) lines.push(`1 HUSB ${f.husband}`);
    if (f.wife) lines.push(`1 WIFE ${f.wife}`);
    for (const c of f.children) lines.push(`1 CHIL ${c}`);
    lines.push(...eventLines('MARR', f.marriageDate, f.marriagePlace));
  }

  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}
