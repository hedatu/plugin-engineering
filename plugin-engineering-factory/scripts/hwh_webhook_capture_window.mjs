import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { nowIso, parseArgs, writeJson } from "../src/utils/io.mjs";
import { assertMatchesSchema } from "../src/utils/schema.mjs";
import { collectServerInventory, DEFAULT_SERVER_INVENTORY_ROOT } from "../src/server/inventory.mjs";

const execFileAsync = promisify(execFile);
const ENDPOINT = "https://ca-hwh-api.915500.xyz/functions/v1/waffo-webhook";

function bashQuote(value) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizeLogLine(line) {
  const cleaned = stripAnsi(line).replace(/\r/g, "");
  return cleaned.replace(/^[^|]*\|\s?/, "");
}

async function runSshCommand(target, remoteCommand, { timeoutMs = 30_000, allowTimeoutExit = false } = {}) {
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "IdentitiesOnly=yes",
  ];

  const remoteTarget = target.currentLocalAliasPresent
    ? target.sshAlias
    : `${target.sshUser}@${target.ipAddress}`;

  if (!target.currentLocalAliasPresent) {
    sshArgs.push("-i", target.keyPath);
  }

  sshArgs.push(remoteTarget, `bash -lc ${bashQuote(remoteCommand)}`);

  try {
    const result = await execFileAsync("ssh", sshArgs, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });

    return {
      code: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    if (allowTimeoutExit && typeof error?.code === "number" && error.code === 124) {
      return {
        code: 124,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }

    throw error;
  }
}

function buildPsqlJsonCommand(sql) {
  return [
    "cd /opt/supabase-core",
    "sql=$(cat <<'SQL'",
    sql,
    "SQL",
    ")",
    "docker compose exec -T db psql -U postgres -d postgres -P pager=off -A -t -c \"$sql\"",
  ].join("\n");
}

async function queryRemoteJson(target, sql) {
  const result = await runSshCommand(target, buildPsqlJsonCommand(sql), { timeoutMs: 40_000 });
  const raw = result.stdout.trim();
  return raw ? JSON.parse(raw) : null;
}

function countBraces(value) {
  const opens = (value.match(/{/g) || []).length;
  const closes = (value.match(/}/g) || []).length;
  return opens - closes;
}

function collectBlocks(logText) {
  const markers = new Map([
    ["waffo_webhook_inbound", "inbound"],
    ["waffo_webhook_verified", "verified"],
    ["waffo_webhook_rejected", "rejected"],
    ["waffo_webhook_verification_event", "verification_event"],
  ]);

  const blocks = [];
  let active = null;

  for (const rawLine of logText.split(/\n/)) {
    const line = normalizeLogLine(rawLine).trimEnd();
    if (!line) {
      continue;
    }

    if (!active) {
      const found = [...markers.entries()].find(([marker]) => line.includes(marker));
      if (!found) {
        continue;
      }

      const [marker, type] = found;
      active = {
        type,
        marker,
        lines: [line],
        braceDepth: countBraces(line),
      };

      if (active.braceDepth <= 0) {
        blocks.push(active);
        active = null;
      }

      continue;
    }

    active.lines.push(line);
    active.braceDepth += countBraces(line);
    if (active.braceDepth <= 0) {
      blocks.push(active);
      active = null;
    }
  }

  return blocks;
}

function extractString(blockText, key) {
  const match = blockText.match(new RegExp(`${key}:\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

function extractBoolean(blockText, key) {
  const match = blockText.match(new RegExp(`${key}:\\s*(true|false)`, "m"));
  if (!match) {
    return null;
  }
  return match[1] === "true";
}

function extractInboundBlock(block) {
  const text = block.lines.join("\n");
  return {
    timestamp: extractString(text, "received_at") ?? nowIso(),
    method: extractString(text, "method") ?? "POST",
    signature_header_present: extractBoolean(text, "signature_header_present") ?? false,
    source_ip: extractString(text, "source_ip"),
  };
}

function extractEventBlock(block) {
  const text = block.lines.join("\n");
  return {
    event_type: extractString(text, "event_type") ?? extractString(text, "eventType"),
    event_id: extractString(text, "event_id") ?? extractString(text, "eventId"),
    reason: extractString(text, "reason"),
  };
}

function mergeRequestRows(requests, rows) {
  const byEventId = new Map(rows.filter((row) => row.event_id).map((row) => [row.event_id, row]));

  for (const request of requests) {
    if (!request.event_id) {
      continue;
    }

    const row = byEventId.get(request.event_id);
    if (!row) {
      continue;
    }

    request.localOrderId = row.localOrderId ?? request.localOrderId;
    request.productKey = row.productKey ?? request.productKey;
    request.signature_valid = row.signature_valid ?? request.signature_valid;
    request.processing_error = row.processing_error ?? request.processing_error;

    if (row.processing_error) {
      request.handled_status = "processing_error";
      request.status = "200 RECORDED_PROCESSING_ERROR";
    } else if (row.signature_valid) {
      request.handled_status = request.handled_status === "generic_verification_ping"
        ? request.handled_status
        : "processed";
      request.status = request.status === "pending" ? "200 OK" : request.status;
    }
  }
}

function buildRequests(logText, webhookRows) {
  const blocks = collectBlocks(logText);
  const requests = [];

  for (const block of blocks) {
    if (block.type === "inbound") {
      const inbound = extractInboundBlock(block);
      requests.push({
        timestamp: inbound.timestamp,
        method: inbound.method,
        status: "pending",
        signature_header_present: inbound.signature_header_present,
        event_type: null,
        event_id: null,
        localOrderId: null,
        productKey: null,
        signature_valid: null,
        handled_status: "pending",
        processing_error: null,
        source_ip: inbound.source_ip,
      });
      continue;
    }

    const eventData = extractEventBlock(block);
    const target = [...requests].reverse().find((request) => request.handled_status === "pending");
    if (!target) {
      continue;
    }

    if (eventData.event_type) {
      target.event_type = eventData.event_type;
    }
    if (eventData.event_id) {
      target.event_id = eventData.event_id;
    }

    if (block.type === "verified") {
      target.signature_valid = true;
      target.status = "200 OK";
      target.handled_status = "verified";
    } else if (block.type === "rejected") {
      target.signature_valid = false;
      target.status = "401 INVALID_SIGNATURE";
      target.handled_status = eventData.reason?.includes("SIGNATURE") ? "invalid_signature" : "rejected";
    } else if (block.type === "verification_event") {
      target.handled_status = "generic_verification_ping";
      target.status = "200 OK";
    }
  }

  mergeRequestRows(requests, webhookRows);
  return requests;
}

async function main() {
  const args = parseArgs(process.argv);
  const minutes = Number.parseInt(String(args.minutes ?? "10"), 10);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error("Use --minutes <1-60>.");
  }

  const projectRoot = process.cwd();
  const { actualServers } = await collectServerInventory({
    inventoryRoot: args["inventory-root"] || DEFAULT_SERVER_INVENTORY_ROOT,
    projectRoot,
  });

  const target = actualServers.california;
  if (!target?.ipAddress || !target?.keyPath) {
    throw new Error("California server SSH target could not be resolved from server inventory.");
  }

  const captureStartedAt = nowIso();
  const dbBefore = await queryRemoteJson(target, `
    select json_build_object(
      'processed_webhooks', (select count(*) from public.processed_webhooks),
      'webhook_events', (select count(*) from public.webhook_events),
      'orders', (select count(*) from public.orders),
      'payments', (select count(*) from public.payments),
      'entitlements', (select count(*) from public.entitlements)
    )::text;
  `);

  const caddyfile = await runSshCommand(target, "sudo cat /etc/caddy/Caddyfile", { timeoutMs: 20_000 });
  const caddyAccessLogsConfigured = /ca-hwh-api\.915500\.xyz\s*\{[\s\S]*?\blog\b/m.test(caddyfile.stdout);
  const seconds = minutes * 60;
  const logResult = await runSshCommand(
    target,
    `cd /opt/supabase-core && timeout ${seconds}s docker compose logs -f --since 3s functions 2>&1`,
    { timeoutMs: (seconds + 30) * 1000, allowTimeoutExit: true },
  );

  const captureCompletedAt = nowIso();
  const webhookRows = await queryRemoteJson(target, `
    select coalesce(
      json_agg(
        json_build_object(
          'received_at', to_char(received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'event_type', event_type,
          'event_id', event_id,
          'signature_valid', signature_valid,
          'processing_error', processing_error,
          'localOrderId', coalesce(raw_payload->'data'->'orderMetadata'->>'localOrderId', raw_payload->'data'->>'localOrderId'),
          'productKey', coalesce(raw_payload->'data'->'orderMetadata'->>'productKey', raw_payload->'data'->>'productKey')
        )
        order by received_at
      ),
      '[]'::json
    )::text
    from public.processed_webhooks
    where received_at >= timestamptz '${captureStartedAt}';
  `);

  const dbAfter = await queryRemoteJson(target, `
    select json_build_object(
      'processed_webhooks', (select count(*) from public.processed_webhooks),
      'webhook_events', (select count(*) from public.webhook_events),
      'orders', (select count(*) from public.orders),
      'payments', (select count(*) from public.payments),
      'entitlements', (select count(*) from public.entitlements)
    )::text;
  `);

  const capturedRequests = buildRequests(logResult.stdout, webhookRows ?? []);
  const blockers = [];
  if (!caddyAccessLogsConfigured) {
    blockers.push("Caddy access logs are not configured for ca-hwh-api. Request capture relies on edge function logs.")
  }
  if (capturedRequests.length === 0) {
    blockers.push("No webhook requests were observed during the capture window.")
  }

  const report = {
    generated_at: nowIso(),
    server_id: "california",
    endpoint: ENDPOINT,
    capture_started_at: captureStartedAt,
    capture_completed_at: captureCompletedAt,
    duration_minutes: minutes,
    log_sources: {
      functions: "docker compose logs -f functions",
      caddy_access_logs_configured: caddyAccessLogsConfigured,
      caddy_note: caddyAccessLogsConfigured
        ? "Caddy access logs detected."
        : "No explicit log directive in /etc/caddy/Caddyfile for ca-hwh-api.915500.xyz.",
      kong_note: "Kong was not tailed separately because edge function logs already capture routed webhook requests.",
    },
    db_before: dbBefore,
    db_after: dbAfter,
    captured_request_count: capturedRequests.length,
    captured_requests: capturedRequests,
    blockers,
  };

  const schemaPath = path.join(projectRoot, "schemas", "webhook_capture_window.schema.json");
  await assertMatchesSchema({
    data: report,
    schemaPath,
    label: "migration/webhook_capture_window.ca-hwh.json",
  });

  await writeJson(path.join(projectRoot, "migration", "webhook_capture_window.ca-hwh.json"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
