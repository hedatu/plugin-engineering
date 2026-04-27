import {
  MEMBERSHIP_STORAGE_KEYS,
  createError,
  createSanitizedSessionSnapshot,
  hasConfiguredPublicValue,
  nowIso
} from "./paySiteConfig.js";

async function fetchJsonWithTimeout(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeSession(body) {
  const session = body?.session ?? body ?? {};
  const user = session.user ?? body?.user ?? {};
  return {
    accessToken: session.access_token ?? session.accessToken ?? null,
    refreshToken: session.refresh_token ?? session.refreshToken ?? null,
    expiresAt: session.expires_at ?? session.expiresAt ?? null,
    user: {
      id: user.id ?? null,
      email: user.email ?? null
    },
    verifiedAt: nowIso()
  };
}

function loginUnavailableError() {
  return createError(
    "Email login is not available yet. Please try again later.",
    "EMAIL_LOGIN_NOT_AVAILABLE"
  );
}

export function createAuthFlow({
  config,
  storage = chrome.storage.local,
  fetchImpl = fetch
}) {
  async function getStoredSession() {
    const debug = await storage.get(MEMBERSHIP_STORAGE_KEYS.debugSession);
    if (config.checkoutMode === "test" && debug?.[MEMBERSHIP_STORAGE_KEYS.debugSession]) {
      return debug[MEMBERSHIP_STORAGE_KEYS.debugSession];
    }
    const stored = await storage.get(MEMBERSHIP_STORAGE_KEYS.session);
    return stored?.[MEMBERSHIP_STORAGE_KEYS.session] ?? null;
  }

  async function saveSession(session) {
    await storage.set({
      [MEMBERSHIP_STORAGE_KEYS.session]: session
    });
    return session;
  }

  async function clearSession() {
    await storage.remove(MEMBERSHIP_STORAGE_KEYS.session);
  }

  async function ensureValidSession() {
    const session = await getStoredSession();
    if (!session?.accessToken) {
      throw createError("Login is required.", "LOGIN_REQUIRED", 401);
    }
    return session;
  }

  async function refreshSessionIfNeeded() {
    const session = await getStoredSession();
    if (!session?.refreshToken) {
      return session;
    }
    const expiresAt = Number(session.expiresAt ?? 0) * 1000;
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
      return session;
    }
    if (!hasConfiguredPublicValue(config.publicSupabaseAnonKey)) {
      return session;
    }
    const response = await fetchJsonWithTimeout(
      fetchImpl,
      `${config.publicSupabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.publicSupabaseAnonKey
        },
        body: JSON.stringify({
          refresh_token: session.refreshToken
        })
      }
    );
    if (!response.ok) {
      await clearSession();
      throw createError(
        response.body?.code ?? response.body?.message ?? "Session refresh failed.",
        response.body?.code ?? "SESSION_REFRESH_FAILED",
        response.status
      );
    }
    const nextSession = normalizeSession(response.body);
    await saveSession(nextSession);
    return nextSession;
  }

  async function sendOtp(email) {
    if (!hasConfiguredPublicValue(config.publicSupabaseAnonKey)) {
      throw loginUnavailableError();
    }
    const response = await fetchJsonWithTimeout(
      fetchImpl,
      `${config.publicSupabaseUrl.replace(/\/$/, "")}/auth/v1/otp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.publicSupabaseAnonKey
        },
        body: JSON.stringify({
          email,
          create_user: true
        })
      }
    ).catch(() => ({ ok: false, status: 0, body: {} }));
    if (!response.ok) {
      throw loginUnavailableError();
    }
    return {
      email,
      sent: true
    };
  }

  async function verifyOtp(email, token) {
    if (!hasConfiguredPublicValue(config.publicSupabaseAnonKey)) {
      throw loginUnavailableError();
    }
    const response = await fetchJsonWithTimeout(
      fetchImpl,
      `${config.publicSupabaseUrl.replace(/\/$/, "")}/auth/v1/verify`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.publicSupabaseAnonKey
        },
        body: JSON.stringify({
          email,
          token,
          type: "email"
        })
      }
    ).catch(() => ({ ok: false, status: 0, body: {} }));
    if (!response.ok) {
      throw loginUnavailableError();
    }
    const session = normalizeSession(response.body);
    await saveSession(session);
    return createSanitizedSessionSnapshot(session);
  }

  async function signOut() {
    const session = await getStoredSession();
    if (session?.accessToken && hasConfiguredPublicValue(config.publicSupabaseAnonKey)) {
      await fetchJsonWithTimeout(
        fetchImpl,
        `${config.publicSupabaseUrl.replace(/\/$/, "")}/auth/v1/logout`,
        {
          method: "POST",
          headers: {
            apikey: config.publicSupabaseAnonKey,
            authorization: `Bearer ${session.accessToken}`
          }
        },
        10_000
      ).catch(() => null);
    }
    await clearSession();
    return {
      signedOut: true
    };
  }

  return {
    getStoredSession,
    saveSession,
    clearSession,
    ensureValidSession,
    refreshSessionIfNeeded,
    sendOtp,
    verifyOtp,
    signOut,
    getSanitizedSessionSnapshot: async () => createSanitizedSessionSnapshot(await getStoredSession())
  };
}
