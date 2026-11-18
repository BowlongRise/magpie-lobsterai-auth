import {
  ACCESS_LEAD_MS,
  CLIENT_CAPABILITIES,
  CLIENT_CAPABILITIES_HEADER,
  CLIENT_VERSION,
  CLIENT_VERSION_HEADER,
  ENTERPRISE_ID_HEADER,
  ENTERPRISE_MODE_HEADER,
  PROVIDER,
  ROTATED_TOKEN_TTL_MS,
  WINDOWS_CLIENT_USER_AGENT,
} from "./constants.mjs";
import { refreshTokens, tokenExpiry } from "./auth.mjs";
import { modelInfo } from "./catalog.mjs";
import { applyIdentity } from "./identity.mjs";
import { asRecord, parseJson } from "./util.mjs";
import { randomBytes } from "node:crypto";

const refreshing = new Map();
const rotated = new Map();

function signedOut(message) {
  return Object.assign(new Error(message), { signIn: "expired" });
}

async function readAuth(getAuth) {
  if (!getAuth) return null;
  try {
    return await getAuth();
  } catch {
    return null;
  }
}

export function accessUsable(access, expires, lead = ACCESS_LEAD_MS) {
  if (typeof access !== "string" || !access) return false;
  const end = Number(expires) || tokenExpiry(access);
  return !end || end - Date.now() > lead;
}

function authState(auth) {
  if (!auth || typeof auth !== "object") return null;
  const access = typeof auth.access === "string" ? auth.access : "";
  const refresh = typeof auth.refresh === "string" ? auth.refresh : "";
  if (!access && !refresh) return null;
  return {
    ...auth,
    access,
    refresh,
    expires: Number(auth.expires) || tokenExpiry(access),
  };
}

function pruneRotated() {
  const now = Date.now();
  for (const [key, value] of rotated) {
    if (value.until <= now) rotated.delete(key);
  }
}

function rememberRotated(refresh, next) {
  pruneRotated();
  rotated.set(refresh, {
    ...next,
    until: Date.now() + ROTATED_TOKEN_TTL_MS,
  });
}

function latestAuth(auth, latest) {
  const base = authState(auth);
  const newer = authState(latest);
  const current =
    base && newer
      ? {
          ...base,
          ...newer,
          access: newer.access || base.access,
          refresh: newer.refresh || base.refresh,
          expires: Number(newer.expires) || Number(base.expires) || tokenExpiry(newer.access || base.access),
        }
      : newer ?? base;
  if (!current?.refresh) return current;
  pruneRotated();
  const rotatedEntry = rotated.get(current.refresh);
  if (rotatedEntry && rotatedEntry.access) {
    return {
      ...current,
      access: rotatedEntry.access,
      refresh: rotatedEntry.refresh,
      expires: Number(rotatedEntry.expires) || tokenExpiry(rotatedEntry.access),
    };
  }
  return current;
}

async function saveAuth(client, auth, next) {
  if (!client?.auth?.set) return;
  try {
    await client.auth.set({
      path: { id: PROVIDER },
      body: {
        ...auth,
        access: next.access,
        refresh: next.refresh,
        expires: next.expires,
      },
    });
  } catch {
    // The in-memory rotated-token cache still keeps this process usable.
  }
}

export async function refreshAuth(auth, { getAuth, client, fetchImpl = fetch } = {}) {
  const current = latestAuth(auth, await readAuth(getAuth));
  if (!current?.refresh) {
    throw signedOut("LobsterAI 账号没有 refresh token，请重新登录");
  }
  const key = current.refresh;
  const pending = refreshing.get(key);
  if (pending) {
    const result = await pending;
    return { ...current, ...result, expires: Number(result.expires) || tokenExpiry(result.access) };
  }
  const promise = (async () => {
    const tokens = await refreshTokens(key, fetchImpl);
    const next = {
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokenExpiry(tokens.access),
    };
    rememberRotated(key, next);
    rememberRotated(tokens.refresh, next);
    return next;
  })();
  refreshing.set(key, promise);
  try {
    const next = await promise;
    if (getAuth) {
      const now = authState(await readAuth(getAuth));
      if (now?.refresh === key) {
        await saveAuth(client, current, next);
      }
    } else {
      await saveAuth(client, current, next);
    }
    return { ...current, ...next };
  } finally {
    refreshing.delete(key);
  }
}

export async function freshAuth(auth, ctx) {
  const latest = await readAuth(ctx.getAuth);
  const current = latestAuth(auth, latest);
  if (!current) throw signedOut("LobsterAI 账号未登录，请重新登录");
  if (accessUsable(current.access, current.expires)) return current;
  return refreshAuth(current, ctx);
}

export function requestHeaders(access, initHeaders, auth) {
  const headers = new Headers(initHeaders);
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  headers.delete("api-key");
  headers.set("authorization", `Bearer ${access}`);
  headers.set(CLIENT_CAPABILITIES_HEADER, CLIENT_CAPABILITIES);
  headers.set(CLIENT_VERSION_HEADER, CLIENT_VERSION);
  if (process.platform === "win32") headers.set("user-agent", WINDOWS_CLIENT_USER_AGENT);
  if (auth?.enterpriseId) {
    headers.set(ENTERPRISE_MODE_HEADER, "enterprise");
    headers.set(ENTERPRISE_ID_HEADER, String(auth.enterpriseId));
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return headers;
}

export function normalizeModelId(id) {
  return String(id ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isKimiK3(id) {
  const normalized = normalizeModelId(id);
  return normalized === "kimik3" || normalized === "kimik3youdaoinner";
}

export function resolveThinkingLevel(thinking, requested) {
  const options = thinking?.options ?? [];
  const wanted = String(requested ?? "").trim().toLowerCase();
  if (wanted === "none" || wanted === "off") {
    return options.find((option) => option.level === "off")?.level ?? "off";
  }
  if (wanted) {
    const byLevel = options.find((option) => option.level.toLowerCase() === wanted);
    if (byLevel) return byLevel.level;
    const byOpenClaw = options.find(
      (option) => String(option.openclawLevel ?? "").toLowerCase() === wanted,
    );
    if (byOpenClaw) return byOpenClaw.level;
  }
  return (
    thinking?.defaultLevel ??
    options.find((option) => option.level !== "off")?.level ??
    options[0]?.level
  );
}

const KIMI_K3_FIXED_SAMPLING_FIELDS = [
  "temperature",
  "top_p",
  "n",
  "presence_penalty",
  "frequency_penalty",
];

export function applyKimiK3Contract(payload) {
  if (!asRecord(payload)) return payload;
  delete payload.thinking;
  delete payload.reasoningEffort;
  delete payload.lobsterai_options;
  for (const field of KIMI_K3_FIXED_SAMPLING_FIELDS) delete payload[field];
  delete payload.stream_options;
  if (payload.max_completion_tokens !== undefined && payload.max_tokens === undefined) {
    payload.max_tokens = payload.max_completion_tokens;
  }
  delete payload.max_completion_tokens;
  payload.reasoning_effort = "max";

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (
        asRecord(message) &&
        message.role === "assistant" &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0 &&
        !("reasoning_content" in message)
      ) {
        message.reasoning_content = "";
      }
    }
  }
  return payload;
}

export function adaptRequestBody(text, modelId, hideDsh = true) {
  if (typeof text !== "string" || !text.trim()) return text;
  const payload = parseJson(text);
  if (!asRecord(payload)) return text;
  applyIdentity(payload, { hideHarness: hideDsh });
  const info = modelInfo(modelId ?? payload.model);
  const kimiK3 = isKimiK3(modelId ?? payload.model);
  if (kimiK3) {
    applyKimiK3Contract(payload);
    return JSON.stringify(payload);
  }
  const thinking = info?.thinking ?? null;
  const supportsRequestOptions =
    !Array.isArray(info?.requestCapabilities) ||
    info.requestCapabilities.includes("thinking-level-control-v1");
  const requested =
    payload.reasoning_effort ??
    payload.reasoningEffort ??
    payload.reasoning?.effort ??
    payload.lobsterai_options?.thinking?.level;

  if (thinking && supportsRequestOptions) {
    const level = resolveThinkingLevel(thinking, requested);
    payload.lobsterai_options = {
      version: 1,
      thinking: { level },
    };
    delete payload.reasoning_effort;
    delete payload.reasoningEffort;
  }

  return JSON.stringify(payload);
}

function requestInitWithBody(init, bodyText) {
  const next = { ...init };
  if (bodyText !== undefined) next.body = bodyText;
  return next;
}

// The desktop sends a W3C trace context with every chat: the trace id is also
// the turn id, and the user's message rides along URL-encoded.
function lastUserMessage(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const content = message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
          : "";
    if (text.trim()) return text.trim();
  }
  return "";
}

export function applyClientTrace(headers, bodyText) {
  if (typeof bodyText !== "string" || !bodyText.trim()) return headers;
  const payload = parseJson(bodyText);
  if (!asRecord(payload) || !Array.isArray(payload.messages)) return headers;
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  headers.set("traceparent", `00-${traceId}-${spanId}-01`);
  headers.set("x-lobster-turn-id", traceId);
  const said = lastUserMessage(payload);
  if (said) {
    // The desktop keeps the first 200 characters of the turn's user message.
    const clipped = Array.from(said).slice(0, 200).join("");
    headers.set("x-lobster-user-message", encodeURIComponent(clipped));
  }
  if (!headers.has("accept-language")) headers.set("accept-language", "zh-CN");
  headers.set("sec-fetch-site", "none");
  headers.set("sec-fetch-mode", "no-cors");
  headers.set("sec-fetch-dest", "empty");
  headers.set("priority", "u=4, i");
  return headers;
}

export async function authorizedFetch(input, init = {}, ctx) {
  const url = input instanceof Request ? input.url : String(input);
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const baseInit =
    input instanceof Request
      ? {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: input.signal,
          ...init,
        }
      : { ...init };

  let auth = await readAuth(ctx.getAuth);
  if (!authState(auth)) throw signedOut("LobsterAI 账号未登录，请重新登录");
  auth = await freshAuth(auth, ctx);

  let bodyText;
  if (typeof baseInit.body === "string") {
    bodyText = adaptRequestBody(baseInit.body, undefined, ctx.hideDsh?.() ?? true);
  } else if (baseInit.body instanceof Uint8Array) {
    const text = new TextDecoder().decode(baseInit.body);
    const adapted = adaptRequestBody(text, undefined, ctx.hideDsh?.() ?? true);
    bodyText = adapted === text ? baseInit.body : adapted;
  }

  const send = (token) => {
    const next = requestInitWithBody(baseInit, bodyText);
    next.headers = applyClientTrace(
      requestHeaders(token, baseInit.headers, auth),
      bodyText,
    );
    return fetchImpl(url, next);
  };

  let response = await send(auth.access);
  if (response.status !== 401) return response;

  let next;
  try {
    next = await refreshAuth(auth, ctx);
  } catch (error) {
    if (error?.signIn === "expired") throw error;
    const headers = new Headers(response.headers);
    headers.set("X-Magpie-Sign-In", "kept");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  response = await send(next.access);
  return response;
}

export const _requestInternals = {
  authState,
  latestAuth,
  signedOut,
};
