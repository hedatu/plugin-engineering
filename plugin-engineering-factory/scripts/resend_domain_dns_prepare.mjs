import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs, writeJson, writeText } from "../src/utils/io.mjs";

const TARGET_DOMAIN = "notify.915500.xyz";
const TARGET_SENDER = "no-reply@notify.915500.xyz";
const REPORT_JSON = path.join("migration", "resend_domain_status.california.json");
const REPORT_MD = path.join("migration", "resend_domain_status.california.md");
const REQUIRED_KEYS = [
  "RESEND_API_KEY",
  "CF_API_TOKEN",
  "CF_ZONE_NAME",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_SENDER",
  "RESEND_DOMAIN"
];

function parseEnvLine(line) {
  const trimmed = `${line ?? ""}`.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    return null;
  }
  const separatorIndex = trimmed.indexOf("=");
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

async function readEnvFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed) {
      values[parsed.key] = parsed.value;
    }
  }
  return values;
}

function redactEmail(email) {
  const [local, domain] = `${email ?? ""}`.split("@");
  if (!local || !domain) {
    return null;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

function redactHost(host) {
  const labels = `${host ?? ""}`.split(".");
  if (labels.length >= 3) {
    return `${labels[0].slice(0, 3)}***.${labels.slice(-2).join(".")}`;
  }
  return host ? `${host.slice(0, 3)}***` : null;
}

async function apiFetch(url, {
  token,
  method = "GET",
  body = null
} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.errors?.[0]?.message || response.statusText;
    throw new Error(`${method} ${url} failed with ${response.status}: ${message}`);
  }
  return data;
}

function unwrapData(value) {
  return value?.data ?? value;
}

function getListData(value) {
  return Array.isArray(value?.data) ? value.data : Array.isArray(value) ? value : [];
}

async function resendRequest(pathname, options) {
  return apiFetch(`https://api.resend.com${pathname}`, options);
}

async function cloudflareRequest(pathname, options) {
  const data = await apiFetch(`https://api.cloudflare.com/client/v4${pathname}`, options);
  if (data?.success === false) {
    const message = data?.errors?.map((error) => error.message).join("; ") || "Cloudflare API error";
    throw new Error(message);
  }
  return data;
}

function normalizeRecordName({ name, domain, zoneName }) {
  const raw = `${name ?? ""}`.trim().replace(/\.$/, "");
  if (!raw || raw === "@") {
    return domain;
  }
  if (raw === domain || raw.endsWith(`.${domain}`)) {
    return raw;
  }
  if (raw === zoneName || raw.endsWith(`.${zoneName}`)) {
    return raw;
  }
  if (raw.includes(".")) {
    return `${raw}.${zoneName}`;
  }
  return `${raw}.${domain}`;
}

function normalizeContent(value) {
  let output = `${value ?? ""}`.trim();
  if (
    (output.startsWith("\"") && output.endsWith("\""))
    || (output.startsWith("'") && output.endsWith("'"))
  ) {
    output = output.slice(1, -1);
  }
  return output;
}

function extractResendRecords(domainData) {
  const unwrapped = unwrapData(domainData);
  return unwrapped?.records
    || unwrapped?.dns_records
    || unwrapped?.domain?.records
    || [];
}

function recordToCloudflarePayload(record, { domain, zoneName }) {
  const type = `${record.type ?? record.record ?? ""}`.toUpperCase();
  const name = normalizeRecordName({ name: record.name, domain, zoneName });
  const content = normalizeContent(record.value ?? record.content ?? record.data);
  if (!type || !name || !content) {
    return null;
  }
  if (!name.endsWith(`.${domain}`) && name !== domain) {
    return null;
  }
  const payload = {
    type,
    name,
    content,
    ttl: 1,
    comment: "HWH California Resend SMTP verification"
  };
  if (record.priority !== undefined && record.priority !== null && type === "MX") {
    payload.priority = Number(record.priority);
  }
  if (["A", "AAAA", "CNAME"].includes(type)) {
    payload.proxied = false;
  }
  return payload;
}

async function upsertCloudflareRecord({ zoneId, cfToken, payload }) {
  const query = new URLSearchParams({
    type: payload.type,
    name: payload.name
  });
  const existingResponse = await cloudflareRequest(`/zones/${zoneId}/dns_records?${query.toString()}`, {
    token: cfToken
  });
  const existing = existingResponse.result || [];
  const exact = existing.find((record) => normalizeContent(record.content) === normalizeContent(payload.content));
  if (exact) {
    return {
      action: "exists",
      name: payload.name,
      type: payload.type
    };
  }

  const updateTarget = existing[0];
  if (updateTarget) {
    await cloudflareRequest(`/zones/${zoneId}/dns_records/${updateTarget.id}`, {
      token: cfToken,
      method: "PATCH",
      body: payload
    });
    return {
      action: "updated",
      name: payload.name,
      type: payload.type
    };
  }

  await cloudflareRequest(`/zones/${zoneId}/dns_records`, {
    token: cfToken,
    method: "POST",
    body: payload
  });
  return {
    action: "created",
    name: payload.name,
    type: payload.type
  };
}

async function cleanupDuplicateSuffixRecords({ zoneId, cfToken, domain }) {
  const duplicateDomain = domain.replace(/\.915500\.xyz$/, `.notify.915500.xyz`);
  if (duplicateDomain === domain) {
    return [];
  }
  const deleted = [];
  const query = new URLSearchParams({
    name: duplicateDomain
  });
  const apexResponse = await cloudflareRequest(`/zones/${zoneId}/dns_records?${query.toString()}`, {
    token: cfToken
  });
  const wildcardQuery = new URLSearchParams({
    per_page: "100"
  });
  const recordsResponse = await cloudflareRequest(`/zones/${zoneId}/dns_records?${wildcardQuery.toString()}`, {
    token: cfToken
  });
  const candidates = [
    ...(apexResponse.result || []),
    ...(recordsResponse.result || []).filter((record) => `${record.name}`.endsWith(`.${duplicateDomain}`))
  ];
  const unique = new Map();
  for (const record of candidates) {
    unique.set(record.id, record);
  }
  for (const record of unique.values()) {
    if (["TXT", "MX", "CNAME"].includes(record.type)) {
      await cloudflareRequest(`/zones/${zoneId}/dns_records/${record.id}`, {
        token: cfToken,
        method: "DELETE"
      });
      deleted.push({
        action: "deleted_duplicate_suffix_record",
        name: record.name,
        type: record.type
      });
    }
  }
  return deleted;
}

async function findOrCreateResendDomain({ resendToken, domain }) {
  const domains = getListData(await resendRequest("/domains", { token: resendToken }));
  const existing = domains.find((item) => item.name === domain);
  if (existing) {
    return {
      domain: existing,
      created: false
    };
  }
  const created = unwrapData(await resendRequest("/domains", {
    token: resendToken,
    method: "POST",
    body: { name: domain }
  }));
  return {
    domain: created,
    created: true
  };
}

async function retrieveResendDomain({ resendToken, domain }) {
  if (!domain?.id) {
    return domain;
  }
  const retrieved = await resendRequest(`/domains/${domain.id}`, { token: resendToken });
  return unwrapData(retrieved);
}

async function verifyResendDomain({ resendToken, domain }) {
  if (!domain?.id) {
    return null;
  }
  try {
    return await resendRequest(`/domains/${domain.id}/verify`, {
      token: resendToken,
      method: "POST"
    });
  } catch (error) {
    return { error: error.message };
  }
}

async function pollResendVerification({ resendToken, domain, timeoutSeconds }) {
  const startedAt = Date.now();
  let latest = domain;
  while (Date.now() - startedAt < timeoutSeconds * 1000) {
    latest = await retrieveResendDomain({ resendToken, domain: latest });
    if (latest?.status === "verified") {
      return {
        verified: true,
        domain: latest,
        elapsed_seconds: Math.round((Date.now() - startedAt) / 1000)
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  latest = await retrieveResendDomain({ resendToken, domain: latest });
  return {
    verified: latest?.status === "verified",
    domain: latest,
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000)
  };
}

async function buildFailureReport({ envValues, missingKeys, blockers }) {
  const now = new Date().toISOString();
  return {
    generated_at: now,
    domain: envValues.RESEND_DOMAIN || TARGET_DOMAIN,
    sender: redactEmail(envValues.SMTP_SENDER),
    provider: "resend",
    resend_domain_exists: false,
    resend_domain_verified: false,
    cloudflare_records_upserted: [],
    dmarc_present: false,
    smtp_parameters_expected: {
      host: "smtp.resend.com",
      port: 2587,
      user: "resend",
      sender: TARGET_SENDER
    },
    missing_fields: missingKeys,
    blockers
  };
}

async function writeReports(report) {
  await writeJson(REPORT_JSON, report);
  const upserted = report.cloudflare_records_upserted?.length
    ? report.cloudflare_records_upserted.map((record) => `- ${record.action}: ${record.type} ${record.name}`).join("\n")
    : "- none";
  const blockers = report.blockers?.length
    ? report.blockers.map((blocker) => `- \`${blocker}\``).join("\n")
    : "- none";
  const md = `# Resend Domain Status - California

- Domain: \`${report.domain}\`
- Sender: \`${report.sender || "<redacted>"}\`
- Resend domain exists: \`${report.resend_domain_exists}\`
- Resend domain verified: \`${report.resend_domain_verified}\`
- DMARC present: \`${report.dmarc_present}\`

## Cloudflare Upserts

${upserted}

## Current SMTP Target

- Expected host: \`${report.smtp_parameters_expected?.host || "smtp.resend.com"}\`
- Expected port: \`${report.smtp_parameters_expected?.port || 2587}\`
- Expected user: \`${report.smtp_parameters_expected?.user || "resend"}\`
- Expected sender: \`${report.smtp_parameters_expected?.sender || TARGET_SENDER}\`

## Blockers

${blockers}
`;
  await writeText(REPORT_MD, md);
}

async function main() {
  const args = parseArgs(process.argv);
  const envFile = args["env-file"] ? path.resolve(`${args["env-file"]}`) : null;
  const pollSeconds = Number(args["poll-seconds"] || 300);
  if (!envFile) {
    throw new Error("--env-file is required");
  }

  const envValues = await readEnvFile(envFile);
  const missingKeys = REQUIRED_KEYS.filter((key) => !`${envValues[key] ?? ""}`.trim());
  if (missingKeys.length > 0) {
    const report = await buildFailureReport({
      envValues,
      missingKeys,
      blockers: ["missing_required_secure_env_fields"]
    });
    await writeReports(report);
    console.log(JSON.stringify({
      status: "blocked",
      missing_fields: missingKeys
    }, null, 2));
    return;
  }

  const blockers = [];
  const domain = `${envValues.RESEND_DOMAIN}`.trim();
  const sender = `${envValues.SMTP_SENDER}`.trim();
  if (domain !== TARGET_DOMAIN) {
    blockers.push("secure_env_resend_domain_mismatch");
  }
  if (sender !== TARGET_SENDER) {
    blockers.push("secure_env_smtp_sender_mismatch");
  }
  if (`${envValues.SMTP_HOST}`.trim() !== "smtp.resend.com") {
    blockers.push("secure_env_smtp_host_not_resend");
  }
  if (Number(envValues.SMTP_PORT) !== 2587) {
    blockers.push("secure_env_smtp_port_not_2587");
  }
  if (`${envValues.SMTP_USER}`.trim() !== "resend") {
    blockers.push("secure_env_smtp_user_not_resend");
  }
  if (`${envValues.SMTP_PASSWORD}` !== `${envValues.RESEND_API_KEY}`) {
    blockers.push("secure_env_smtp_password_does_not_match_resend_api_key");
  }
  if (blockers.length > 0) {
    const report = await buildFailureReport({
      envValues,
      missingKeys: [],
      blockers
    });
    await writeReports(report);
    console.log(JSON.stringify({
      status: "blocked",
      blockers
    }, null, 2));
    return;
  }

  const { domain: initialDomain, created } = await findOrCreateResendDomain({
    resendToken: envValues.RESEND_API_KEY,
    domain
  });
  let resendDomain = await retrieveResendDomain({
    resendToken: envValues.RESEND_API_KEY,
    domain: initialDomain
  });
  const records = extractResendRecords(resendDomain);

  const zoneResponse = await cloudflareRequest(`/zones?name=${encodeURIComponent(envValues.CF_ZONE_NAME)}`, {
    token: envValues.CF_API_TOKEN
  });
  const zone = zoneResponse.result?.find((item) => item.name === envValues.CF_ZONE_NAME);
  if (!zone?.id) {
    throw new Error("Cloudflare zone was not found for CF_ZONE_NAME");
  }

  const cleanupResults = args["cleanup-duplicate-suffix"]
    ? await cleanupDuplicateSuffixRecords({
        zoneId: zone.id,
        cfToken: envValues.CF_API_TOKEN,
        domain
      })
    : [];

  const upsertResults = [];
  for (const record of records) {
    const payload = recordToCloudflarePayload(record, {
      domain,
      zoneName: envValues.CF_ZONE_NAME
    });
    if (!payload) {
      upsertResults.push({
        action: "skipped_unusable_record",
        name: `${record.name ?? "<missing>"}`,
        type: `${record.type ?? record.record ?? "<missing>"}`
      });
      continue;
    }
    upsertResults.push(await upsertCloudflareRecord({
      zoneId: zone.id,
      cfToken: envValues.CF_API_TOKEN,
      payload
    }));
  }

  const dmarcName = `_dmarc.${domain}`;
  const dmarcQuery = new URLSearchParams({
    type: "TXT",
    name: dmarcName
  });
  const dmarcResponse = await cloudflareRequest(`/zones/${zone.id}/dns_records?${dmarcQuery.toString()}`, {
    token: envValues.CF_API_TOKEN
  });
  const dmarcPresent = (dmarcResponse.result || []).length > 0;

  await verifyResendDomain({
    resendToken: envValues.RESEND_API_KEY,
    domain: resendDomain
  });
  const pollResult = await pollResendVerification({
    resendToken: envValues.RESEND_API_KEY,
    domain: resendDomain,
    timeoutSeconds: pollSeconds
  });
  resendDomain = pollResult.domain;

  const finalBlockers = [];
  if (resendDomain?.status !== "verified") {
    finalBlockers.push("resend_domain_not_verified");
  }
  if (!dmarcPresent) {
    finalBlockers.push("dmarc_record_not_detected");
  }

  const report = {
    generated_at: new Date().toISOString(),
    provider: "resend",
    environment: "california_staging_ca_hwh",
    domain,
    sender,
    resend_domain_exists: true,
    resend_domain_created_this_run: created,
    resend_domain_status: resendDomain?.status || "unknown",
    resend_domain_verified: resendDomain?.status === "verified",
    resend_poll_elapsed_seconds: pollResult.elapsed_seconds,
    cloudflare_zone_name: envValues.CF_ZONE_NAME,
    cloudflare_records_upserted: [...cleanupResults, ...upsertResults],
    cloudflare_records_upserted_count: upsertResults.filter((record) => ["created", "updated", "exists"].includes(record.action)).length,
    dmarc_present: dmarcPresent,
    dmarc_suggested_record: dmarcPresent
      ? null
      : {
          type: "TXT",
          name: dmarcName,
          value: "v=DMARC1; p=none; rua=mailto:dmarc@notify.915500.xyz"
        },
    smtp_parameters_expected: {
      host: "smtp.resend.com",
      port: 2587,
      user: "resend",
      sender: TARGET_SENDER
    },
    blockers: finalBlockers
  };
  await writeReports(report);
  console.log(JSON.stringify({
    status: finalBlockers.length ? "blocked" : "ready",
    domain,
    resend_domain_verified: report.resend_domain_verified,
    cloudflare_records_upserted_count: report.cloudflare_records_upserted_count,
    dmarc_present: dmarcPresent,
    blockers: finalBlockers
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
