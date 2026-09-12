/** The JSON Schema subset both capability APIs accept. Deliberately tiny: every
 *  construct here can be validated without a schema library and without recursion
 *  a hostile manifest can weaponize. */

export interface JsonSchema {
  type?: 'null' | 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEMVER = /^\d+\.\d+\.\d+$/;

// eslint-disable-next-line no-control-regex -- manifests are hostile input
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

/** Non-empty, bounded, free of control characters. Tabs and line breaks are allowed. */
export const plainText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);

export const exactKeys = (value: object, allowed: readonly string[]): boolean =>
  Object.keys(value).every(key => allowed.includes(key));

const SCHEMA_KEYS = ['type', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum'];

export function validateJsonSchema(schema: unknown, depth = 0): asserts schema is JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 8) throw new Error('Invalid capability JSON schema.');
  const value = schema as JsonSchema;
  if (!exactKeys(value, SCHEMA_KEYS)) throw new Error('Invalid capability JSON schema.');
  if (value.type && !['null', 'boolean', 'number', 'integer', 'string', 'array', 'object'].includes(value.type)) throw new Error('Invalid capability JSON schema type.');
  if (value.properties) {
    if (value.type !== 'object' || Object.keys(value.properties).length > 64) throw new Error('Invalid capability object schema.');
    for (const [key, child] of Object.entries(value.properties)) {
      if ((!SLUG.test(key) && !/^[a-z][a-zA-Z0-9]{0,63}$/.test(key)) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid capability schema property.');
      validateJsonSchema(child, depth + 1);
    }
  }
  if (value.required && (!Array.isArray(value.required) || value.required.some(key => typeof key !== 'string' || !value.properties?.[key]))) throw new Error('Invalid capability required properties.');
  if (value.items) { if (value.type !== 'array') throw new Error('Invalid capability array schema.'); validateJsonSchema(value.items, depth + 1); }
  for (const bound of [value.minItems, value.maxItems]) if (bound !== undefined && (value.type !== 'array' || !Number.isInteger(bound) || bound < 0 || bound > 200000)) throw new Error('Invalid capability array limit.');
  if (value.minItems !== undefined && value.maxItems !== undefined && value.minItems > value.maxItems) throw new Error('Invalid capability array limits.');
  if (value.enum && (!Array.isArray(value.enum) || value.enum.length > 100)) throw new Error('Invalid capability enum.');
}

export function jsonSchemaMatches(schema: JsonSchema, value: unknown): boolean {
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength);
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'array') return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems) && (!schema.items || value.every(item => jsonSchemaMatches(schema.items!, item)));
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some(key => !(key in record))) return false;
    if (schema.additionalProperties === false && Object.keys(record).some(key => !schema.properties?.[key])) return false;
    return Object.entries(schema.properties ?? {}).every(([key, child]) => !(key in record) || jsonSchemaMatches(child, record[key]));
  }
  return false;
}

export function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** Half-open range check used by capability dependencies: [min, maxExclusive). */
export const semverInRange = (version: string, min: string, maxExclusive: string): boolean =>
  compareSemver(version, min) >= 0 && compareSemver(version, maxExclusive) < 0;
