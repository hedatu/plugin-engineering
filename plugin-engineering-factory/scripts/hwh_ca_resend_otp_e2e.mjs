import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs, writeJson, writeText } from "../src/utils/io.mjs";

let API_BASE = "https://ca-hwh-api.915500.xyz";
let SITE_BASE = "https://ca-hwh.915500.xyz";
const PRODUCT_KEY = "leadfill-one-profile";
const PLAN_KEY = "lifetime";
const FEATURE_KEY = "leadfill_fill_action";
const HWH_REPO = "D:\\code\\支付网站设计模块\\plugin-membership-supabase-waffo-design";
let REPORT_JSON = path.join("migration", "otp_login_e2e_report.california.resend.json");
let REPORT_MD = path.join("migration", "otp_login_e2e_report.california.resend.md");

function redactEmail(email) {
  const [local, domain] = `${email ?? ""}`.split("@");
  if (!local || !domain) {
    return null;
  }
  return `${local.slice(0, 3)}***@${domain}`;
}

function redactUserId(userId) {
  const value = `${userId ?? ""}`;
  if (value.length < 12) {
    return null;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function resolveAnonKey(hwhRepo) {
  const candidates = [];
  const envAnon = process.env.HWH_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (envAnon) {
    candidates.push(envAnon);
  }
  const envPath = path.join(hwhRepo, "apps", "web", ".env.production.local");
  const envRaw = await readTextIfExists(envPath);
  if (envRaw) {
    for (const line of envRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("PUBLIC_SUPABASE_ANON_KEY=")) {
        const value = trimmed.replace(/^PUBLIC_SUPABASE_ANON_KEY=/, "").trim();
        if (value) {
          candidates.push(value);
        }
      }
    }
  }

  const assetsDir = path.join(hwhRepo, "apps", "web", "dist", "assets");
  try {
    const entries = await fs.readdir(assetsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        continue;
      }
      const raw = await fs.readFile(path.join(assetsDir, entry.name), "utf8");
      for (const match of raw.matchAll(/eyJ[a-zA-Z0-9._-]{100,}/g)) {
        if (!candidates.includes(match[0])) {
          candidates.push(match[0]);
        }
      }
    }
  } catch {
    // Dist assets are optional for this diagnostic.
  }

  for (const candidate of candidates) {
    const response = await fetch(`${API_BASE}/auth/v1/settings`, {
      headers: { apikey: candidate }
    });
    if (response.ok) {
      return candidate;
    }
  }
  throw new Error("No working California public anon key candidate found.");
}

async function jsonFetch(url, { method = "GET", headers = {}, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {})
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
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function createMailbox() {
  const domains = await jsonFetch("https://api.mail.tm/domains");
  const domain = domains.data?.["hydra:member"]?.[0]?.domain;
  if (!domain) {
    throw new Error("mail.tm did not return a mailbox domain.");
  }
  const local = `hwh-${Date.now()}-${randomBytes(3).toString("hex")}`.toLowerCase();
  const address = `${local}@${domain}`;
  const password = randomBytes(18).toString("base64url");
  const create = await jsonFetch("https://api.mail.tm/accounts", {
    method: "POST",
    body: { address, password }
  });
  if (!create.ok) {
    throw new Error(`mail.tm account creation failed with ${create.status}.`);
  }
  const token = await jsonFetch("https://api.mail.tm/token", {
    method: "POST",
    body: { address, password }
  });
  if (!token.ok || !token.data?.token) {
    throw new Error(`mail.tm token creation failed with ${token.status}.`);
  }
  return {
    address,
    token: token.data.token
  };
}

async function getLatestMessage(mailbox) {
  const messages = await jsonFetch("https://api.mail.tm/messages", {
    headers: { Authorization: `Bearer ${mailbox.token}` }
  });
  const latest = messages.data?.["hydra:member"]
    ?.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`))?.[0];
  if (!latest?.id) {
    return null;
  }
  const detail = await jsonFetch(`https://api.mail.tm/messages/${latest.id}`, {
    headers: { Authorization: `Bearer ${mailbox.token}` }
  });
  return detail.data
    ? {
        id: latest.id,
        createdAt: detail.data.createdAt,
        subject: detail.data.subject,
        text: detail.data.text || "",
        html: Array.isArray(detail.data.html) ? detail.data.html.join("\n") : `${detail.data.html || ""}`
      }
    : null;
}

async function waitForNewMessage(mailbox, latestBefore, timeoutSeconds = 120) {
  const started = Date.now();
  while (Date.now() - started < timeoutSeconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const candidate = await getLatestMessage(mailbox);
    if (!candidate) {
      continue;
    }
    if (!latestBefore || candidate.id !== latestBefore.id || candidate.createdAt !== latestBefore.createdAt) {
      return candidate;
    }
  }
  return null;
}

function extractOtpCode(message) {
  const body = `${message?.text || ""}\n${message?.html || ""}`;
  const preferred = body.match(/enter the code:\s*(\d{6})/i);
  if (preferred?.[1]) {
    return preferred[1];
  }
  const fallback = body.match(/\b(\d{6})\b/);
  return fallback?.[1] || null;
}

function extractLinkHosts(message) {
  const body = `${message?.text || ""}\n${message?.html || ""}`;
  const hosts = new Set();
  for (const match of body.matchAll(/https?:\/\/([^/"'<>\s)]+)/gi)) {
    hosts.add(match[1].toLowerCase());
  }
  return [...hosts].sort();
}

async function writeReport(report) {
  await writeJson(REPORT_JSON, report);
  const blockers = report.blockers?.length
    ? report.blockers.map((blocker) => `- \`${blocker}\``).join("\n")
    : "- none";
  const md = `# California Resend OTP E2E

- Provider: \`resend\`
- SEND_OTP: \`${report.send_otp_status}\`
- Email delivered: \`${report.email_delivered}\`
- VERIFY_OTP: \`${report.verify_otp_status}\`
- Session created: \`${report.session_created}\`
- get-entitlement: \`${report.get_entitlement_status}\`
- register-installation: \`${report.register_installation_status}\`
- create-checkout-session: \`${report.create_checkout_status}\`
- consume-usage free: \`${report.consume_usage_free_status}\`
- quota exceeded on 11th attempt: \`${report.quota_exceeded_status}\`

## Link Hosts

${report.email_link_hosts?.map((host) => `- \`${host}\``).join("\n") || "- none"}

## Blockers

${blockers}
`;
  await writeText(REPORT_MD, md);
}

async function main() {
  const args = parseArgs(process.argv);
  API_BASE = args["api-base"] ? `${args["api-base"]}`.replace(/\/+$/, "") : API_BASE;
  SITE_BASE = args["site-base"] ? `${args["site-base"]}`.replace(/\/+$/, "") : SITE_BASE;
  REPORT_JSON = args["report-json"] ? path.resolve(`${args["report-json"]}`) : REPORT_JSON;
  REPORT_MD = args["report-md"] ? path.resolve(`${args["report-md"]}`) : REPORT_MD;
  const hwhRepo = args["hwh-repo"] ? path.resolve(`${args["hwh-repo"]}`) : HWH_REPO;
  const environment = args.environment ? `${args.environment}` : "california_staging_ca_hwh";
  const expectedHosts = [...new Set([
    new URL(SITE_BASE).hostname,
    new URL(API_BASE).hostname
  ])];
  const startedAt = new Date().toISOString();
  const report = {
    generated_at: startedAt,
    provider: "resend",
    environment,
    api_base: API_BASE,
    site_base: SITE_BASE,
    smtp_sender: "no-reply@notify.915500.xyz",
    test_mailbox_redacted: null,
    send_otp_status: "not_run",
    send_otp_http_status: null,
    email_delivered: false,
    email_subject_present: false,
    email_link_hosts: [],
    email_link_hosts_expected: expectedHosts,
    redirected_to_weiwang: false,
    verify_otp_status: "not_run",
    verify_otp_http_status: null,
    session_created: false,
    user_id_redacted: null,
    get_entitlement_status: "not_run",
    get_entitlement_plan_key: null,
    get_entitlement_feature_enabled: null,
    register_installation_status: "not_run",
    register_installation_registered: false,
    installation_id_present: false,
    create_checkout_status: "not_run",
    checkout_session_id: null,
    checkout_url_domain: null,
    checkout_success_url_expected: `${SITE_BASE}/checkout/success`,
    checkout_cancel_url_expected: `${SITE_BASE}/checkout/cancel`,
    checkout_mode_expected: "test",
    consume_usage_free_status: "not_run",
    consume_usage_allowed_attempts: 0,
    quota_exceeded_status: "not_run",
    failure_phase: null,
    blockers: []
  };

  try {
    const anon = await resolveAnonKey(hwhRepo);
    const mailbox = await createMailbox();
    report.test_mailbox_redacted = redactEmail(mailbox.address);
    const latestBefore = await getLatestMessage(mailbox);

    const sendOtp = await jsonFetch(`${API_BASE}/auth/v1/otp`, {
      method: "POST",
      headers: {
        apikey: anon,
        Origin: SITE_BASE,
        Referer: `${SITE_BASE}/login`
      },
      body: {
        email: mailbox.address,
        create_user: true
      }
    });
    report.send_otp_http_status = sendOtp.status;
    report.send_otp_status = sendOtp.ok ? "verified" : "failed";
    if (!sendOtp.ok) {
      throw new Error("SEND_OTP failed");
    }

    const message = await waitForNewMessage(mailbox, latestBefore, 150);
    if (!message) {
      report.failure_phase = "email_delivery";
      throw new Error("No new OTP email delivered.");
    }
    report.email_delivered = true;
    report.email_subject_present = Boolean(message.subject);
    report.email_link_hosts = extractLinkHosts(message);
    report.redirected_to_weiwang = report.email_link_hosts.some((host) => host.includes("weiwang"));
    if (report.redirected_to_weiwang) {
      report.blockers.push("otp_email_redirected_to_weiwang");
      throw new Error("OTP email contains a weiwang redirect host.");
    }

    const code = extractOtpCode(message);
    if (!code) {
      report.failure_phase = "otp_code_parse";
      throw new Error("OTP code not found in delivered email.");
    }

    const verify = await jsonFetch(`${API_BASE}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: anon,
        Origin: SITE_BASE,
        Referer: `${SITE_BASE}/login`
      },
      body: {
        email: mailbox.address,
        token: code,
        type: "email"
      }
    });
    report.verify_otp_http_status = verify.status;
    report.verify_otp_status = verify.ok && verify.data?.access_token ? "verified" : "failed";
    report.session_created = Boolean(verify.data?.access_token);
    report.user_id_redacted = redactUserId(verify.data?.user?.id);
    if (!report.session_created) {
      report.failure_phase = "verify_otp";
      throw new Error("VERIFY_OTP did not return a session.");
    }

    const authHeaders = {
      apikey: anon,
      Authorization: `Bearer ${verify.data.access_token}`
    };

    const entitlement = await jsonFetch(`${API_BASE}/functions/v1/get-entitlement`, {
      method: "POST",
      headers: authHeaders,
      body: { productKey: PRODUCT_KEY }
    });
    report.get_entitlement_status = entitlement.ok ? "verified" : "failed";
    report.get_entitlement_plan_key = entitlement.data?.planKey || entitlement.data?.plan?.planKey || null;
    report.get_entitlement_feature_enabled = Boolean(
      entitlement.data?.features?.[FEATURE_KEY]?.enabled
      ?? entitlement.data?.features?.[FEATURE_KEY]
      ?? entitlement.data?.featureEnabled
      ?? false
    );
    if (!entitlement.ok) {
      report.failure_phase = "get_entitlement";
      throw new Error("get-entitlement failed.");
    }

    const installationId = randomUUID();
    const installation = await jsonFetch(`${API_BASE}/functions/v1/register-installation`, {
      method: "POST",
      headers: authHeaders,
      body: {
        productKey: PRODUCT_KEY,
        installationId,
        extensionId: "dnnpkaefmlhacigijccbhemgaenjbcpk",
        browser: "chrome",
        version: "0.2.0"
      }
    });
    report.installation_id_present = true;
    report.register_installation_status = installation.ok ? "verified" : "failed";
    report.register_installation_registered = installation.data?.registered === true;
    if (!installation.ok) {
      report.failure_phase = "register_installation";
      throw new Error("register-installation failed.");
    }

    if (args["checkout-smoke"]) {
      const checkout = await jsonFetch(`${API_BASE}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: authHeaders,
        body: {
          productKey: PRODUCT_KEY,
          planKey: PLAN_KEY,
          installationId,
          source: "web"
        }
      });
      report.create_checkout_status = checkout.ok ? "verified" : "failed";
      report.checkout_session_id = checkout.data?.sessionId || checkout.data?.checkoutSessionId || null;
      try {
        report.checkout_url_domain = checkout.data?.checkoutUrl ? new URL(checkout.data.checkoutUrl).hostname : null;
      } catch {
        report.checkout_url_domain = "invalid_url";
      }
      if (!checkout.ok) {
        report.failure_phase = "create_checkout_session";
        throw new Error("create-checkout-session failed.");
      }
    } else {
      report.create_checkout_status = "skipped";
    }

    let quotaExceeded = false;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const consume = await jsonFetch(`${API_BASE}/functions/v1/consume-usage`, {
        method: "POST",
        headers: authHeaders,
        body: {
          productKey: PRODUCT_KEY,
          featureKey: FEATURE_KEY,
          amount: 1,
          installationId
        }
      });
      const errorCode = `${consume.data?.errorCode || consume.data?.code || consume.data?.error || ""}`;
      const allowed = consume.ok && consume.data?.allowed !== false && errorCode !== "QUOTA_EXCEEDED";
      if (attempt <= 10 && allowed) {
        report.consume_usage_allowed_attempts += 1;
      }
      if (attempt === 11 && (!allowed || errorCode === "QUOTA_EXCEEDED")) {
        quotaExceeded = true;
      }
    }
    report.consume_usage_free_status = report.consume_usage_allowed_attempts === 10 ? "verified" : "failed";
    report.quota_exceeded_status = quotaExceeded ? "verified" : "failed";
    if (report.consume_usage_free_status !== "verified" || report.quota_exceeded_status !== "verified") {
      report.failure_phase = "consume_usage_free_quota";
      throw new Error("consume-usage free quota regression failed.");
    }

    report.blockers = [];
  } catch (error) {
    report.blockers = [...new Set([...(report.blockers || []), report.failure_phase || "otp_e2e_failed"])];
    report.error_summary = error.message;
  } finally {
    report.completed_at = new Date().toISOString();
    await writeReport(report);
    console.log(JSON.stringify({
      send_otp_status: report.send_otp_status,
      email_delivered: report.email_delivered,
      verify_otp_status: report.verify_otp_status,
      session_created: report.session_created,
      get_entitlement_status: report.get_entitlement_status,
      register_installation_status: report.register_installation_status,
      create_checkout_status: report.create_checkout_status,
      consume_usage_free_status: report.consume_usage_free_status,
      quota_exceeded_status: report.quota_exceeded_status,
      blockers: report.blockers
    }, null, 2));
    if (report.blockers.length > 0) {
      process.exitCode = 1;
    }
  }
}

main();
