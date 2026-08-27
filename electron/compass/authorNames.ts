// SPDX-License-Identifier: AGPL-3.0-only

const NAME_CONNECTORS = new Set([
  "al", "da", "das", "de", "del", "della", "den", "der", "di", "do",
  "dos", "du", "el", "la", "las", "le", "los", "van", "von", "y",
]);
const TOPIC_WORDS = new Set([
  "analysis", "análisis", "archaeology", "arqueología", "artificial",
  "biology", "book", "ciencia", "climate", "computer", "computing",
  "cultural", "culture", "democracy", "democratic", "digital", "economics",
  "economy", "education", "educación", "engineering", "environmental",
  "estudio", "gender", "history", "historia", "humanities", "intelligence",
  "inteligencia", "investigación", "law", "learning", "libro", "literature",
  "literatura", "machine", "medicine", "open", "philosophy", "physics",
  "politics", "psychology", "quantum", "research", "science", "social",
  "sociology", "source", "sources", "study", "tecnología", "theory",
  "tourism", "travel", "vision", "war",
]);

export function normalizeCompassAuthorName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalizeCompassAuthorName(value)
    .split(" ")
    .filter((token) => token && !NAME_CONNECTORS.has(token));
}

/** Conservative local detection for a query made only of a person's name. */
export function probableCompassAuthorName(value: string): string | null {
  const candidate = value.trim().replace(/^["'“”]|["'“”]$/g, "").trim();
  if (
    !candidate ||
    candidate.length > 160 ||
    !/^[\p{L}\p{M}.'’\-\s,]+$/u.test(candidate) ||
    (candidate.match(/,/g)?.length ?? 0) > 1
  )
    return null;
  const words = candidate.match(/[\p{L}\p{M}]+/gu) ?? [];
  const significant = words.filter(
    (word) => !NAME_CONNECTORS.has(normalizeCompassAuthorName(word)),
  );
  if (significant.length < 2 || significant.length > 5) return null;
  if (
    significant.some((word) => {
      const normalized = normalizeCompassAuthorName(word);
      return TOPIC_WORDS.has(normalized) || word[0] !== word[0]?.toLocaleUpperCase();
    })
  )
    return null;
  return candidate.replace(/\s+/g, " ");
}

/**
 * Compares author names without depending on display order or diacritics. Full
 * initials are accepted, while missing surnames remain below the match threshold.
 */
export function compassAuthorNameScore(
  requested: string,
  candidate: string,
): number {
  const expected = tokens(requested);
  const actual = tokens(candidate);
  if (!expected.length || !actual.length) return 0;
  if (
    expected.length === actual.length &&
    [...expected].sort().join(" ") === [...actual].sort().join(" ")
  )
    return 1;

  const remaining = [...actual];
  let matched = 0;
  let initialMatches = 0;
  for (const expectedToken of expected) {
    let index = remaining.findIndex((token) => token === expectedToken);
    if (index < 0)
      index = remaining.findIndex(
        (token) =>
          (token.length === 1 || expectedToken.length === 1) &&
          token[0] === expectedToken[0],
      );
    if (index < 0) continue;
    if (remaining[index] !== expectedToken) initialMatches += 1;
    remaining.splice(index, 1);
    matched += 1;
  }
  const coverage = matched / expected.length;
  const specificity = matched / actual.length;
  return Math.max(
    0,
    Math.min(1, 0.7 * coverage + 0.3 * specificity - initialMatches * 0.03),
  );
}

export function compassAuthorQueryVariants(value: string): string[] {
  const parts = value
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length < 2) return [value.trim()].filter(Boolean);
  const variants = [value.trim(), parts.join(" ")];
  for (let split = 1; split < parts.length; split += 1)
    variants.push(
      `${parts.slice(split).join(" ")}, ${parts.slice(0, split).join(" ")}`,
    );
  return [...new Set(variants)];
}
