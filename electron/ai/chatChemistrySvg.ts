import type { ChatSkill } from '@shared/chatSkills';

const CHEMISTRY_REQUEST = /\b(?:atom|bond-line|line-bond|chemical|chemistry|molecul|orbital|electron|valen|lone[ -]?pair|nonbonding|lewis|kekul|skeletal|tetrahed|wedge|hashed|dash(?:ed)?|staggered|eclipsed|conformation|hybridi[sz]|alkane|chloroform|ethane|propane|methyllithium|methylamine|hydrogen sulfide)\b/i;
const CHEMISTRY_SVG = /(?:>\s*(?:C|H|N|O|S|P|F|Cl|Br|I|Li)\s*<|CH(?:Cl|₃|3)|tetrahed|lone[ -]?pair|bond)/i;

/** Keep the extra model call scoped to drawings where chemistry conventions carry
 * semantic meaning. A generic process diagram that merely says "bond" in prose
 * should not pay for, or be rewritten by, the chemistry audit. */
export function isChemistrySvgRequest(question: string, svg: string): boolean {
  return CHEMISTRY_REQUEST.test(question) && CHEMISTRY_SVG.test(svg);
}

export type ChemistrySvgMode = 'tetrahedral' | 'planar-line-bond' | 'general';

export function chemistrySvgMode(question: string): ChemistrySvgMode {
  if (/\b(?:tetrahed|wedge|hashed|dash(?:ed)?|perspective|3D)\b/i.test(question)) return 'tetrahedral';
  if (/\b(?:line-bond|bond-line|nonbonding|lone[ -]?pair|lewis|skeletal)\b/i.test(question)) return 'planar-line-bond';
  return 'general';
}

/** Cheap markup checks catch unambiguous convention violations that font/layout
 * inspection cannot see. They intentionally avoid trying to infer arbitrary
 * molecular connectivity from free-form SVG coordinates. */
export function chemistrySvgMarkupIssues(question: string, svg: string): string[] {
  const mode = chemistrySvgMode(question);
  const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, '');
  const issues: string[] = [];
  if (/<circle\b/i.test(withoutComments)) issues.push('Remove circles and ball-and-stick atom badges; use plain element labels.');
  if (mode === 'planar-line-bond') {
    if (/<polygon\b/i.test(withoutComments)) issues.push('Planar line-bond mode forbids polygon or wedge bonds. Replace every molecular bond with an ordinary solid line.');
    if (/stroke-dasharray\s*=/i.test(withoutComments)) issues.push('Planar line-bond mode forbids dashed or hashed bonds. Use ordinary solid lines only.');
  }
  if (mode === 'tetrahedral') {
    const polygons = [...withoutComments.matchAll(/<polygon\b[^>]*\bpoints\s*=\s*["']([^"']+)["'][^>]*>/gi)];
    if (!polygons.length) issues.push('Tetrahedral mode requires one filled triangular wedge in the molecular drawing.');
    for (const polygon of polygons) {
      const vertices = polygon[1].trim().split(/\s+/).filter(Boolean);
      if (vertices.length !== 3) issues.push(`A filled wedge polygon has ${vertices.length} vertices; rebuild it as exactly one opaque three-vertex triangle.`);
      if (/\bopacity\s*=/i.test(polygon[0])) issues.push('Filled wedges must be opaque black with no opacity attribute.');
    }
  }
  return [...new Set(issues)];
}

export function chemistrySvgAuditSystem(skill: ChatSkill, mode: ChemistrySvgMode): string {
  const modeRules = mode === 'tetrahedral'
    ? `REQUIRED REPRESENTATION: TETRAHEDRAL WEDGE-AND-DASH. The current user explicitly requested three-dimensional tetrahedral notation.
- Show exactly two ordinary in-plane bonds, exactly one filled triangular wedge toward the viewer, and exactly one hashed wedge away. Unless the user specifies an orientation, use one ordinary bond upward, one ordinary bond down-left, one hashed wedge down-right, and one filled wedge downward.
- The filled wedge must be exactly one opaque black polygon with exactly three perimeter-ordered points. Its narrow first point touches the stereocenter; the other two form the wide base by the substituent. Never use a quadrilateral, a five-point polygon, overlapping shapes, opacity, internal lines, or extra outline segments.
- The hashed wedge is only a sequence of short crossbars that widen away from the stereocenter, perpendicular to that bond's direction. Give all four bonds distinct projected directions. Never put any two substituents at opposite ends of one straight line through the central atom. Never label a projected two-dimensional angle 109.5 degrees.`
    : mode === 'planar-line-bond'
      ? `REQUIRED REPRESENTATION: PLANAR LINE-BOND / LEWIS. This classification is final because the current user did not request stereochemical perspective.
- Every molecular bond must be one ordinary solid line in the plane. Use no filled wedge, hashed wedge, dasharray, dashed bond, polygon bond, perspective cue, or stereochemical legend anywhere in the SVG, even if the draft contains one. Remove all such draft elements.
- Prefer the textbook's uncluttered 90-degree cross-style layout when atoms are written explicitly. Do not label a bond angle unless the current user explicitly asks for its value.
- Render every lone pair as two compact, aligned dots adjacent to its owning atom. Show exactly the chemically required number of pairs and keep them clear of labels and bonds.`
      : `REQUIRED REPRESENTATION: GENERAL CLASSICAL CHEMISTRY. Use the conventional two-dimensional notation that directly answers the current request. Do not add stereochemical perspective or angle labels unless requested.`;
  return `You are the final technical editor for a classical organic-chemistry SVG. Audit the supplied drawing against the user's exact request and return one corrected, complete fenced svg block. Do not return commentary, an assessment, or the word OK.

${modeRules}

This is a semantic correction pass, not a decorative redesign. First reason privately from the molecular formula or name: enumerate atoms, connectivity, bond order, formal charge where relevant, valence at every atom, and the exact number and ownership of lone pairs. Then inspect the actual SVG elements and coordinates rather than trusting its title, legend, comments, or prose.

Required conventions:
- Use monochrome classical textbook notation: plain element labels and bond strokes. No colored atoms, balls, circles, badges, or ball-and-stick styling.
- For carbon skeletons, preserve the requested molecular formula and conventional zig-zag connectivity. Do not add hydrogens or wedge/dash detail unless the question calls for them.
- Keep a small, accurate legend only when it helps the request. Its symbols must exactly match the drawing. Remove decorative atom keys.
- Keep all content inside the viewBox with generous margins. If a tetrahedral drawing includes a legend, use a canvas at least 900 units high, keep the legend in its own region below the molecule, and leave at least 60 units of blank space below the final legend row. Omit an optional legend rather than clip or overlap it.

Preserve correct explanatory content and the SVG's accessible title and description, but simplify the artwork whenever that improves chemical accuracy. Check the finished markup once more against your private atom-and-bond ledger before returning it.

The enabled SVG skill remains authoritative for layout, safety, and output format:
${skill.instructions}`;
}
