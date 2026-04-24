const SECRET_ENV_NAMES = [
  "CHROME_WEB_STORE_CLIENT_SECRET",
  "CHROME_WEB_STORE_REFRESH_TOKEN",
  "CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON",
  "CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS"
];

const SECRET_KEY_NAMES = new Set([
  "access_token",
  "authorization",
  "client_secret",
  "id_token",
  "private_key",
  "refresh_token",
  "token"
]);

const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN(?: RSA| EC|)? PRIVATE KEY-----[\s\S]*?-----END(?: RSA| EC|)? PRIVATE KEY-----/g;
const SECRET_KEY_NAME_PATTERN = /\b(access_token|authorization|client_secret|id_token|private_key|refresh_token)\b/gi;
const URL_CREDENTIALS_PATTERN = /(https?:\/\/)([^\/@\s]+)@/gi;
const BEARER_TOKEN_DETECT_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/i;
const PRIVATE_KEY_DETECT_PATTERN = /-----BEGIN(?: RSA| EC|)? PRIVATE KEY-----[\s\S]*?-----END(?: RSA| EC|)? PRIVATE KEY-----/;
const SECRET_KEY_NAME_DETECT_PATTERN = /\b(access_token|authorization|client_secret|id_token|private_key|refresh_token)\b/i;

export function collectSecretEnvValues() {
  return SECRET_ENV_NAMES
    .map((name) => process.env[name])
    .filter((value) => typeof value === "string" && value.length >= 8);
}

function redactExactSecretValues(text) {
  let sanitized = text;
  const secretValues = collectSecretEnvValues().sort((left, right) => right.length - left.length);
  for (const secretValue of secretValues) {
    sanitized = sanitized.split(secretValue).join("[redacted]");
  }
  return sanitized;
}

export function redactSecretLikeText(value) {
  if (typeof value !== "string") {
    return value;
  }

  let sanitized = redactExactSecretValues(value);
  sanitized = sanitized.replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]");
  sanitized = sanitized.replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]");
  sanitized = sanitized.replace(URL_CREDENTIALS_PATTERN, "$1[redacted]@");
  sanitized = sanitized.replace(SECRET_KEY_NAME_PATTERN, "[redacted-secret-field]");
  return sanitized;
}

export function redactSecretLikeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretLikeValue(entry));
  }

  if (typeof value === "string") {
    return redactSecretLikeText(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY_NAMES.has(key))
      .map(([key, nestedValue]) => [key, redactSecretLikeValue(nestedValue)])
  );
}

export function inspectSecretLikeContent(value) {
  const serialized = JSON.stringify(value);
  const secretValues = collectSecretEnvValues();
  const secretValuesPresent = secretValues.some((secretValue) => serialized.includes(secretValue));
  const bearerTokenPatternPresent = BEARER_TOKEN_DETECT_PATTERN.test(serialized);
  const privateKeyPatternPresent = PRIVATE_KEY_DETECT_PATTERN.test(serialized);
  const secretKeyNamePatternPresent = SECRET_KEY_NAME_DETECT_PATTERN.test(serialized);

  return {
    sanitized_response_bodies: true,
    checked_secret_value_count: secretValues.length,
    secret_values_present_in_artifact: secretValuesPresent,
    authorization_header_pattern_present: bearerTokenPatternPresent,
    key_material_pattern_present: privateKeyPatternPresent,
    secret_marker_pattern_present: secretKeyNamePatternPresent
  };
}

export function hasSecretLikeContent(checks) {
  return Boolean(
    checks.secret_values_present_in_artifact
    || checks.authorization_header_pattern_present
    || checks.key_material_pattern_present
    || checks.secret_marker_pattern_present
  );
}
