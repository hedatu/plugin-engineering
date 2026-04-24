import { readJson } from "./io.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function matchesType(value, expectedType) {
  if (expectedType === "array") {
    return Array.isArray(value);
  }
  if (expectedType === "object") {
    return isPlainObject(value);
  }
  if (expectedType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expectedType === "integer") {
    return Number.isInteger(value);
  }
  if (expectedType === "null") {
    return value === null;
  }
  return typeof value === expectedType;
}

function validateNode(value, schema, currentPath = "$") {
  if (!isPlainObject(schema)) {
    return [];
  }

  const errors = [];
  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length > 0 && !expectedTypes.some((expectedType) => matchesType(value, expectedType))) {
    errors.push(`${currentPath} expected ${expectedTypes.join(" or ")} but got ${describeType(value)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${currentPath} must be one of: ${schema.enum.join(", ")}`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${currentPath} must have length >= ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${currentPath} must have length <= ${schema.maxLength}`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${currentPath} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${currentPath} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${currentPath} must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${currentPath} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateNode(item, schema.items, `${currentPath}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${currentPath}.${key} is required`);
      }
    }

    if (isPlainObject(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(...validateNode(value[key], childSchema, `${currentPath}.${key}`));
        }
      }
    }
  }

  return errors;
}

export async function assertMatchesSchema({ data, schemaPath, label }) {
  const schema = await readJson(schemaPath);
  const errors = validateNode(data, schema);
  if (errors.length === 0) {
    return;
  }

  const preview = errors.slice(0, 6).join("; ");
  throw new Error(`Schema validation failed for ${label}: ${preview}`);
}
