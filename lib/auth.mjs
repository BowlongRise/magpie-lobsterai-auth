import http from "node:http";
import { randomBytes } from "node:crypto";

import {
  CLIENT_VERSION,
  KEYFROM,
  LOGIN_FALLBACK_URL,
  LOGIN_TIMEOUT_MS,
  LOGIN_URL_CACHE_MS,
  LOGIN_URL_LOOKUP,
  SERVER_BASE,
} from "./constants.mjs";
import { firstString, parseJson } from "./util.mjs";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/auth/callback";

let cachedLoginUrl = "";
let cachedLoginUrlAt = 0;

export function appendLoginParams(baseUrl, params) {
  const parsed = new URL(baseUrl);
  if (parsed.hash) {
    const hash = parsed.hash.slice(1);
    const queryStart = hash.indexOf("?");
    const hashPath = queryStart >= 0 ? hash.slice(0, queryStart) : hash;
    const hashQuery = queryStart >= 0 ? hash.slice(queryStart + 1) : "";
    const hashParams = new URLSearchParams(hashQuery);
    for (const [key, value] of Object.entries(params)) {
      hashParams.set(key, value);
    }
    const nextQuery = hashParams.toString();
    parsed.hash = nextQuery ? `${hashPath}?${nextQuery}` : hashPath;
    return parsed.toString();
  }
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function appendCallbackReturnTo(redirectUri, returnTo) {
  const parsed = new URL(redirectUri);
  parsed.searchParams.set("return_to", returnTo);
  return parsed.toString();
}

export async function fetchLoginBaseUrl(fetchImpl = fetch, signal) {
  const now = Date.now();
  if (cachedLoginUrl && now - cachedLoginUrlAt < LOGIN_URL_CACHE_MS) {
    return cachedLoginUrl;
  }
  try {
    const response = await fetchImpl(LOGIN_URL_LOOKUP, {
      headers: { accept: "application/json" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(3_000)])
        : AbortSignal.timeout(3_000),
    });
    const body = parseJson(await response.text());
    const value = firstString(body?.data?.value);
    if (response.ok && body?.code === 0 && value.startsWith("https://")) {
      cachedLoginUrl = value;
      cachedLoginUrlAt = now;
      return value;
    }
  } catch {
    // A local fallback is enough when Overmind is unreachable.
  }
  return LOGIN_FALLBACK_URL;
}

function escapeHtml(value) {
  return String(value).replace(/[<>&"]/g, (char) => {
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === "&") return "&amp;";
    return "&quot;";
  });
}

function callbackHtml(ok, message) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>LobsterAI 登录</title>
<style>
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f4;color:#14120b;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid rgba(20,18,11,.08);border-radius:12px;padding:28px 32px;max-width:440px;box-shadow:0 18px 50px rgba(20,18,11,.08)}
h1{font-size:19px;margin:0 0 8px;color:${ok ? "#15803d" : "#b91c1c"}}p{margin:0;color:#666}
</style></head><body><div class="card"><h1>${ok ? "登录成功" : "登录失败"}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function sendHtml(response, status, ok, message) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(callbackHtml(ok, message));
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export async function startCallbackServer({ timeoutMs = LOGIN_TIMEOUT_MS, signal } = {}) {
  const state = randomBytes(24).toString("base64url");
  let settled = false;
  let resolveCode;
  let rejectCode;
  let timer;

  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // The host may cancel before callback() is called; avoid an unhandled
  // rejection while still letting callback() observe the failure.
  codePromise.catch(() => {});

  const server = http.createServer((request, response) => {
    if (request.method !== "GET") {
      sendHtml(response, 405, false, "登录回调只接受 GET 请求。");
      return;
    }
    const url = new URL(request.url || "/", `http://${CALLBACK_HOST}`);
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const code = firstString(url.searchParams.get("code"));
    const returnedState = firstString(url.searchParams.get("state"));
    if (!code) {
      sendHtml(response, 400, false, "登录回调缺少授权码，请重新登录。");
      settleError(new Error("LobsterAI 登录回调缺少授权码"));
      return;
    }
    if (returnedState !== state) {
      sendHtml(response, 400, false, "登录状态校验失败，请重新登录。");
      settleError(new Error("LobsterAI 登录回调 state 不匹配"));
      return;
    }
    sendHtml(response, 200, true, "登录已完成，可以关闭此页面并返回 Magpie。");
    settleCode(code);
  });

  const close = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await Promise.race([
      closeServer(server),
      new Promise((resolve) => {
        setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, 100);
      }),
    ]);
  };

  const settleCode = (code) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    resolveCode(code);
    void close();
  };

  const settleError = (error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    rejectCode(error);
    void close();
  };

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, CALLBACK_HOST);
  }).catch((error) => {
    throw new Error(`无法启动 LobsterAI 本地登录回调：${error.message}`);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("LobsterAI 本地登录回调没有可用端口");
  }

  const redirectUri = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
  timer = setTimeout(() => {
    settleError(new Error("LobsterAI 登录超时，请重新登录"));
  }, timeoutMs);

  const onAbort = () => {
    settleError(signal.reason ?? new Error("LobsterAI 登录已取消"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  return {
    redirectUri,
    state,
    code() {
      return codePromise;
    },
    async close() {
      signal?.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        rejectCode(new Error("LobsterAI 登录已取消"));
      }
      await close();
    },
  };
}

export async function beginBrowserLogin({ fetchImpl = fetch, signal } = {}) {
  const callback = await startCallbackServer({ signal });
  try {
    const loginBase = await fetchLoginBaseUrl(fetchImpl, signal);
    const returnTo = appendLoginParams(loginBase, {
      source: "electron",
      electronLogin: "success",
    });
    const redirectWithReturn = appendCallbackReturnTo(callback.redirectUri, returnTo);
    const url = appendLoginParams(loginBase, {
      source: "electron",
      redirect_uri: redirectWithReturn,
      state: callback.state,
    });
    return {
      url,
      async waitForCode(callbackSignal) {
        if (!callbackSignal) return callback.code();
        return Promise.race([
          callback.code(),
          new Promise((_, reject) => {
            if (callbackSignal.aborted) {
              reject(callbackSignal.reason ?? new Error("LobsterAI 登录已取消"));
              return;
            }
            callbackSignal.addEventListener(
              "abort",
              () => reject(callbackSignal.reason ?? new Error("LobsterAI 登录已取消")),
              { once: true },
            );
          }),
        ]);
      },
      close: callback.close,
    };
  } catch (error) {
    await callback.close();
    throw error;
  }
}

async function readApiResponse(response) {
  const text = await response.text();
  return { text, body: parseJson(text) };
}

function bodyWithAttribution(extra) {
  return {
    ...extra,
    keyfrom: KEYFROM,
    firstKeyfrom: KEYFROM,
    latestKeyfrom: KEYFROM,
    version: CLIENT_VERSION,
  };
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const response = await fetchImpl(`${SERVER_BASE}/api/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(bodyWithAttribution({ authCode: code })),
    signal: AbortSignal.timeout(30_000),
  });
  const { text, body } = await readApiResponse(response);
  if (!response.ok || !body || body.code !== 0 || !body.data) {
    throw new Error(
      firstString(body?.message, response.statusText, `HTTP ${response.status}`) ||
        text ||
        "LobsterAI 登录交换失败",
    );
  }
  const access = firstString(body.data.accessToken);
  const refresh = firstString(body.data.refreshToken);
  if (!access || !refresh) {
    throw new Error("LobsterAI 登录响应缺少 accessToken 或 refreshToken");
  }
  return {
    access,
    refresh,
    user: body.data.user && typeof body.data.user === "object" ? body.data.user : {},
    quota: body.data.quota && typeof body.data.quota === "object" ? body.data.quota : {},
    enterprise: enterpriseFromPayload(body.data),
  };
}

export async function refreshTokens(refreshToken, fetchImpl = fetch) {
  if (!refreshToken) {
    throw Object.assign(new Error("LobsterAI 账号没有可用的 refresh token，请重新登录"), {
      signIn: "expired",
      invalidGrant: true,
    });
  }
  const response = await fetchImpl(`${SERVER_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(bodyWithAttribution({ refreshToken })),
    signal: AbortSignal.timeout(30_000),
  });
  const { text, body } = await readApiResponse(response);
  const code = Number(body?.code);
  const terminal =
    response.status === 401 || code === 40100 || code === 40101;
  if (!response.ok || !body || body.code !== 0 || !body.data) {
    const error = new Error(
      firstString(body?.message, response.statusText, `HTTP ${response.status}`) ||
        text ||
        "LobsterAI Token 续期失败",
    );
    if (terminal) {
      error.signIn = "expired";
      error.invalidGrant = true;
    }
    throw error;
  }
  const access = firstString(body.data.accessToken);
  const nextRefresh = firstString(body.data.refreshToken) || refreshToken;
  if (!access) throw new Error("LobsterAI Token 续期响应缺少 accessToken");
  return { access, refresh: nextRefresh };
}

export function decodeJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const text = Buffer.from(padded, "base64").toString("utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function tokenExpiry(token) {
  const claims = decodeJwt(token);
  const exp = Number(claims?.exp);
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

function enterpriseIdFrom(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const text = value.trim();
    return text === "0" ? "" : text;
  }
  return "";
}

export function enterpriseFromPayload(payload) {
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return null;
    seen.add(value);
    const enterpriseId = enterpriseIdFrom(
      value.enterpriseId ?? value.enterprise_id ?? value.tenantId ?? value.tenant_id,
    );
    const mode =
      typeof value.accountMode === "string" ? value.accountMode.toLowerCase() : "";
    if (
      enterpriseId &&
      (mode === "enterprise" ||
        typeof value.enterpriseName === "string" ||
        typeof value.role === "string")
    ) {
      return {
        enterpriseId,
        accountMode: "enterprise",
        ...(firstString(value.enterpriseName) ? { enterpriseName: firstString(value.enterpriseName) } : {}),
      };
    }
    for (const key of [
      "enterpriseContext",
      "accountContext",
      "organizationContext",
      "context",
      "user",
      "data",
    ]) {
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(payload);
}

export function accountFromAccess(access, user = {}) {
  const claims = decodeJwt(access) ?? {};
  const accountId = firstString(
    user.email,
    claims.email,
    user.nickname,
    claims.nickname,
    user.name,
    claims.name,
    user.yid,
    claims.yid,
    user.userId,
    claims.user_id,
    claims.sub,
    user.id,
    "LobsterAI",
  );
  const uid = firstString(
    user.yid,
    claims.yid,
    user.userId,
    claims.user_id,
    claims.sub,
    user.id,
  );
  return {
    accountId,
    uid,
    email: firstString(user.email, claims.email),
    name: firstString(user.nickname, user.name, claims.nickname, claims.name),
    enterpriseId: enterpriseIdFrom(
      user.enterpriseId ?? claims.enterpriseId ?? claims.enterprise_id,
    ),
    expires: tokenExpiry(access),
  };
}
