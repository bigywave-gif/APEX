/** Validate a documented JSON Schema subset; unsupported constraints fail closed. */
import { isDeepStrictEqual } from 'node:util';

const metadata = new Set(['$schema', '$id', 'title', 'description', 'examples', 'default']);
const supported = new Set(['$ref', '$defs', 'definitions', 'type', 'required', 'properties', 'items', 'enum', 'const', 'additionalProperties', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const actualType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !(ref === '#' || ref.startsWith('#/'))) throw new Error('only local JSON Pointer references are supported');
  let pointer; try { pointer = decodeURIComponent(ref.slice(1)); } catch { throw new Error('invalid reference encoding'); }
  let value = root;
  for (const part of pointer ? pointer.slice(1).split('/') : []) {
    if (/~(?![01])/.test(part)) throw new Error('invalid JSON Pointer escape');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!object(value) || !Object.hasOwn(value, key)) throw new Error('reference target does not exist');
    value = value[key];
  }
  if (!object(value)) throw new Error('reference target is not a supported schema');
  return value;
}
function schemaErrors(schema, at, root = schema, seen = new Set()) {
  if (!object(schema)) return [`${at}: invalid or unsupported schema`];
  if (seen.has(schema)) return [];
  seen.add(schema);
  const errors = [], invalid = message => errors.push(`${at}: ${message}`);
  for (const key of Object.keys(schema)) if (!metadata.has(key) && !supported.has(key)) invalid(`unsupported schema keyword ${key}`);
  if (schema !== root && '$id' in schema) invalid('nested $id changes reference scope and is unsupported');
  if ('$ref' in schema) { try { errors.push(...schemaErrors(resolveRef(root, schema.$ref), `${at}.$ref`, root, seen)); } catch (error) { invalid(`invalid $ref: ${error.message}`); } }
  for (const key of ['$defs', 'definitions']) if (key in schema) {
    if (!object(schema[key])) invalid(`invalid ${key}`);
    else for (const [name, child] of Object.entries(schema[key])) errors.push(...schemaErrors(child, `${at}.${key}.${name}`, root, seen));
  }
  const allowed = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  if (allowed.some(type => !types.has(type)) || (Array.isArray(schema.type) && !allowed.length)) invalid('invalid schema type');
  if ('enum' in schema && (!Array.isArray(schema.enum) || !schema.enum.length)) invalid('invalid enum');
  if ('required' in schema && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string'))) invalid('invalid required list');
  if ('properties' in schema && !object(schema.properties)) invalid('invalid properties');
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean' && !object(schema.additionalProperties)) invalid('invalid additionalProperties');
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (key in schema && (!Number.isInteger(schema[key]) || schema[key] < 0)) invalid(`invalid ${key}`);
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) if (key in schema && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) invalid(`invalid ${key}`);
  if ('pattern' in schema) { try { if (typeof schema.pattern !== 'string') throw new Error(); new RegExp(schema.pattern, 'u'); } catch { invalid('invalid pattern'); } }
  if (object(schema.properties)) for (const [key, child] of Object.entries(schema.properties)) errors.push(...schemaErrors(child, `${at}.properties.${key}`, root, seen));
  if ('items' in schema) errors.push(...schemaErrors(schema.items, `${at}.items`, root, seen));
  if (object(schema.additionalProperties)) errors.push(...schemaErrors(schema.additionalProperties, `${at}.additionalProperties`, root, seen));
  return errors;
}
function check(value, schema, at, root, active = new Set()) {
  const errors = [], invalid = message => errors.push(`${at}: ${message}`);
  if ('$ref' in schema) {
    const target = resolveRef(root, schema.$ref), key = `${at}\u0000${schema.$ref}`;
    if (active.has(key)) return [`${at}: circular reference does not advance through the sample`];
    const next = new Set(active); next.add(key);
    errors.push(...check(value, target, at, root, next));
  }
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
    if ('items' in schema) value.forEach((item, index) => errors.push(...check(item, schema.items, `${at}[${index}]`, root, active)));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) invalid(`missing required property ${key}`);
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...check(child, properties[key], `${at}.${key}`, root, active));
      else if (schema.additionalProperties === false) invalid(`additional property ${key}`);
      else if (object(schema.additionalProperties)) errors.push(...check(child, schema.additionalProperties, `${at}.${key}`, root, active));
    }
  }
  return errors;
}
export function validateApiSample(value, schema, location = '$') {
  const invalidSchema = schemaErrors(schema, location);
  return invalidSchema.length ? invalidSchema : check(value, schema, location, schema);
}
