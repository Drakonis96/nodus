/** Plain-language reading of a reaction-fingerprint similarity (0..1). Calibrated on real ORD
 *  neighbours: 1.0 is the same local change (often on another substrate); 0.7-0.9 the same
 *  reaction type on a different substrate (acylations, SOCl2, Suzuki, brominations); around
 *  0.5-0.6 only partial overlap (a Kolbe carboxylation's nearest were salicylate salt formations). */
export function similarityBand(similarity: number): string {
  // Only a step with no exact match is given a band, so 100% is always other molecules.
  if (similarity >= 0.999) return 'same bond changes, on different molecules';
  if (similarity >= 0.7) return 'same transformation, different substrate';
  if (similarity >= 0.4) return 'shares some of the bond changes';
  return 'loosely related';
}
