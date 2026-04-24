function assertVersionString(value) {
  const text = `${value ?? ""}`.trim();
  if (!/^\d+(?:\.\d+){0,3}$/.test(text)) {
    throw new Error(`Invalid Chrome extension version: ${value}`);
  }
  return text;
}

export function parseChromeExtensionVersion(value) {
  const text = assertVersionString(value);
  const parts = text.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid Chrome extension version: ${value}`);
  }
  return {
    text,
    parts
  };
}

export function formatChromeExtensionVersion(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 4) {
    throw new Error(`Invalid Chrome extension version parts: ${JSON.stringify(parts)}`);
  }
  const normalized = parts.map((part) => {
    if (!Number.isInteger(part) || part < 0) {
      throw new Error(`Invalid Chrome extension version part: ${part}`);
    }
    return `${part}`;
  });
  return normalized.join(".");
}

export function compareChromeExtensionVersions(left, right) {
  const leftParts = parseChromeExtensionVersion(left).parts;
  const rightParts = parseChromeExtensionVersion(right).parts;
  const length = Math.max(leftParts.length, rightParts.length, 4);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

export function bumpChromeExtensionVersion(currentVersion, strategy = "patch") {
  const { parts } = parseChromeExtensionVersion(currentVersion);
  if (strategy !== "patch") {
    throw new Error(`Unsupported Chrome extension version bump strategy: ${strategy}`);
  }

  if (parts.length === 1) {
    return formatChromeExtensionVersion([parts[0], 0, 1]);
  }
  if (parts.length === 2) {
    return formatChromeExtensionVersion([parts[0], parts[1], 1]);
  }

  const next = [...parts];
  next[next.length - 1] += 1;
  return formatChromeExtensionVersion(next);
}

export function resolveAutoChromeExtensionVersion({
  sourceVersion,
  currentSandboxItemVersion,
  strategy = "patch"
}) {
  const source = parseChromeExtensionVersion(sourceVersion).text;
  const current = currentSandboxItemVersion
    ? parseChromeExtensionVersion(currentSandboxItemVersion).text
    : null;

  if (!current) {
    return {
      targetVersion: source,
      strategyUsed: "retain_existing_uploadable_version"
    };
  }

  if (compareChromeExtensionVersions(source, current) > 0) {
    return {
      targetVersion: source,
      strategyUsed: "retain_existing_uploadable_version"
    };
  }

  return {
    targetVersion: bumpChromeExtensionVersion(current, strategy),
    strategyUsed: strategy
  };
}

export function ensureChromeExtensionVersionGreaterThan(targetVersion, minimumVersion) {
  if (compareChromeExtensionVersions(targetVersion, minimumVersion) <= 0) {
    throw new Error(`Target Chrome extension version ${targetVersion} must be greater than ${minimumVersion}.`);
  }
  return parseChromeExtensionVersion(targetVersion).text;
}

