/** Validate a documented JSON Schema subset; unsupported constraints fail closed. */
import { isDeepStrictEqual } from 'node:util';

const metadata = new Set(['$schema', '$id', 'title', 'description', 'examples', 'default']);
const supported = new Set(['type', 'required', 'properties', 'items', 'enum', 'const', 'additionalProperties', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const actualType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function schemaErrors(schema, at) {
  if (!object(schema)) return [`${at}: invalid or unsupported schema`];
  const errors = [], invalid = message => errors.push(`${at}: ${message}`);
  for (const key of Object.keys(schema)) if (!metadata.has(key) && !supported.has(key)) invalid(`unsupported schema keyword ${key}`);
  const allowed = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (allowed.some(type => !types.has(type)) || (Array.isArray(schema.type) && !allowed.length)) invalid('invalid schema type');
  if ('enum' in schema && (!Array.isArray(schema.enum) || !schema.enum.length)) invalid('invalid enum');
  if ('required' in schema && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string'))) invalid('invalid required list');
  if ('properties' in schema && !object(schema.properties)) invalid('invalid properties');
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean' && !object(schema.additionalProperties)) invalid('invalid additionalProperties');
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (key in schema && (!Number.isInteger(schema[key]) || schema[key] < 0)) invalid(`invalid ${key}`);
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) if (key in schema && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) invalid(`invalid ${key}`);
  if ('pattern' in schema) { try { if (typeof schema.pattern !== 'string') throw new Error(); new RegExp(schema.pattern, 'u'); } catch { invalid('invalid pattern'); } }
  if (object(schema.properties)) for (const [key, child] of Object.entries(schema.properties)) errors.push(...schemaErrors(child, `${at}.properties.${key}`));
  if ('items' in schema) errors.push(...schemaErrors(schema.items, `${at}.items`));
  if (object(schema.additionalProperties)) errors.push(...schemaErrors(schema.additionalProperties, `${at}.additionalProperties`));
  return errors;
}
function check(value, schema, at) {
  const errors = [], invalid = message => errors.push(`${at}: ${message}`);
  const allowed = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type], type = actualType(value);
  if (allowed.length && !allowed.some(expected => expected === type || (expected === 'integer' && type === 'number' && Number.isInteger(value)))) return [`${at}: expected ${allowed.join('|')}, received ${type}`];
  if ('const' in schema && !isDeepStrictEqual(value, schema.const)) invalid('value differs from const');
  if ('enum' in schema && !schema.enum.some(item => isDeepStrictEqual(item, value))) invalid('value is not in enum');
  if (type === 'number') for (const [key, fails] of [['minimum', value < schema.minimum], ['maximum', value > schema.maximum], ['exclusiveMinimum', value <= schema.exclusiveMinimum], ['exclusiveMaximum', value >= schema.exclusiveMaximum]]) if (key in schema && fails) invalid(`violates ${key}`);
  if (type === 'string') {
    const length = [...value].length;
    if ('minLength' in schema && length < schema.minLength) invalid('violates minLength');
    if ('maxLength' in schema && length > schema.maxLength) invalid('violates maxLength');
    if ('pattern' in schema && !(new RegExp(schema.pattern, 'u')).test(value)) invalid('pattern mismatch');
  }
  if (type === 'array') {
    if ('minItems' in schema && value.length < schema.minItems) invalid('violates minItems');
    if ('maxItems' in schema && value.length > schema.maxItems) invalid('violates maxItems');
    if ('items' in schema) value.forEach((item, index) => errors.push(...check(item, schema.items, `${at}[${index}]`)));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) invalid(`missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...check(child, properties[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) invalid(`additional property ${key}`);
      else if (object(schema.additionalProperties)) errors.push(...check(child, schema.additionalProperties, `${at}.${key}`));
    }
  }
  return errors;
}
export function validateApiSample(value, schema, location = '$') {
  const invalidSchema = schemaErrors(schema, location);
  return invalidSchema.length ? invalidSchema : check(value, schema, location);
}
