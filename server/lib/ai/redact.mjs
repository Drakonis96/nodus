const REDACTED = '[REDACTED]';
const SENSITIVE = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passphrase|credential|authorization|private[_-]?key|signing[_-]?key|webhook[_-]?secret|bearer)$/i;

function sensitiveKey(key) {
  const normalized = String(key).replace(/[\s.]/g, '');
  // Do not redact harmless counters such as `token_count`; token fields themselves
  // (and explicit token values) are sensitive.
  return SENSITIVE.test(normalized)
    || /(?:secret|password|passphrase|credential|authorization|api[-_]?key|private[-_]?key)/i.test(normalized)
    || /(?:^|[-_])(?:access[-_]?|refresh[-_]?|id[-_]?|bearer[-_]?)?token(?:$|value|secret)/i.test(normalized);
}

export function redactText(value, replacement = REDACTED) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${replacement}`)
    .replace(/\b(?:sk|key|token)[-_][A-Za-z0-9_-]{16,}\b/gi, replacement)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, replacement)
    .replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/gi, replacement)
    .replace(/([?&](?:key|api_key|access_token|refresh_token)=)[^&#\s]+/gi, `$1${replacement}`)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[:=]\s*)[^,;\s]+/gi, `$1${replacement}`);
}

/** Return a structurally equivalent value with credential-like fields replaced. */
export function redactStructured(value, { replacement = REDACTED, maxDepth = 20 } = {}) {
  const seen = new WeakSet();
  function visit(current, depth, key = '') {
    if (sensitiveKey(key)) return replacement;
    if (current === null || current === undefined || typeof current === 'number' || typeof current === 'boolean') return current;
    if (typeof current === 'string') return redactText(current, replacement);
    if (typeof current === 'bigint') return String(current);
    if (Buffer.isBuffer(current) || current instanceof Uint8Array) return replacement;
    if (depth >= maxDepth) return '[TRUNCATED]';
    if (typeof current !== 'object') return replacement;
    if (seen.has(current)) return '[CIRCULAR]';
    seen.add(current);
    if (Array.isArray(current)) return current.map((entry) => visit(entry, depth + 1));
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(current)) output[entryKey] = visit(entryValue, depth + 1, entryKey);
    return output;
  }
  return visit(value, 0);
}

export const REDACTED_VALUE = REDACTED;
