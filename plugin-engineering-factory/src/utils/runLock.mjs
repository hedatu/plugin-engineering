import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, nowIso, readJson } from "./io.mjs";

export class RunLockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RunLockError";
    this.code = "RUN_LOCK_UNAVAILABLE";
    this.details = details;
  }
}

export function runLockPath(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  return path.join(path.dirname(absoluteRunDir), ".locks", `${path.basename(absoluteRunDir)}.lock.json`);
}

async function readExistingLock(lockPath) {
  try {
    return await readJson(lockPath);
  } catch {
    return null;
  }
}

export async function acquireRunLock({ runDir, owner }) {
  const lockPath = runLockPath(runDir);
  await ensureDir(path.dirname(lockPath));
  const payload = {
    run_dir: path.resolve(runDir),
    owner,
    pid: process.pid,
    hostname: os.hostname(),
    acquired_at: nowIso()
  };

  let handle = null;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    const existing = await readExistingLock(lockPath);
    throw new RunLockError(
      `Run lock is already held for ${path.resolve(runDir)}.`,
      {
        lock_path: lockPath,
        existing_owner: existing?.owner ?? "unknown",
        existing_pid: existing?.pid ?? null,
        acquired_at: existing?.acquired_at ?? ""
      }
    );
  } finally {
    await handle?.close?.().catch(() => {});
  }

  return {
    lockPath,
    payload,
    async release() {
      await fs.rm(lockPath, { force: true });
    }
  };
}
