import {
  KEYFROM,
  LOGIN_TIMEOUT_MS,
  MAX_CONCURRENCY,
  MAX_SESSION_HEADER_LENGTH,
  NPM,
  PROXY_BASE,
  PROVIDER,
  PROVIDER_NAME,
  REFRESH_LEAD_MS,
  SERVER_BASE,
} from "./lib/constants.mjs";
import {
  accountFromAccess,
  beginBrowserLogin,
  enterpriseFromPayload,
  exchangeCode,
  refreshTokens,
  tokenExpiry,
} from "./lib/auth.mjs";
import {
  infoFromServerModel,
  magpieModel,
  modelInfo,
  rememberServerModels,
  staticConfigModels,
} from "./lib/catalog.mjs";
import { authorizedFetch, requestHeaders } from "./lib/request.mjs";
import { claimDailyCheckIn } from "./lib/checkin.mjs";
import { isExpiredCode, normalizeQuota } from "./lib/usage.mjs";
import { firstString, parseJson } from "./lib/util.mjs";

const MODELS_PATH = "/api/models/available";
const QUOTA_PATH = "/api/user/quota";
const PROFILE_PATH = "/api/user/profile-summary";
const VIRTUAL_MODELS = new Set(["yd-fast", "yd-ultra"]);

function withQuery(path) {
  const url = new URL(`${SERVER_BASE}${path}`);
  url.searchParams.set("keyfrom", KEYFROM);
  return url.toString();
}

function sessionHeader(value) {
  const raw = firstString(value);
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, MAX_SESSION_HEADER_LENGTH);
}

async function responseJson(response) {
  return parseJson(await response.text());
}

// Campaign credits (daily check-in, new-user gift) live in profile-summary's
// creditItems; /api/user/quota only carries the plan's own pool.
async function readCreditProfile(ctx) {
  try {
    const response = await authorizedFetch(
      withQuery(PROFILE_PATH),
      { method: "GET", headers: { accept: "application/json" } },
      ctx,
    );
    const body = await responseJson(response);
    if (!response.ok || !body || body.code !== 0 || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

function authFailure(message) {
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

function accountLabel(account, enterprise) {
  if (!enterprise?.enterpriseId) return account.accountId;
  return `${account.accountId} · ${enterprise.enterpriseName || enterprise.enterpriseId}`;
}

async function validatePastedTokens(access, refresh) {
  let nextAccess = access;
  let nextRefresh = refresh;
  let modelResponse = await fetch(withQuery(MODELS_PATH), {
    headers: requestHeaders(nextAccess),
    signal: AbortSignal.timeout(30_000),
  });
  if (modelResponse.status === 401 && nextRefresh) {
    const rotated = await refreshTokens(nextRefresh);
    nextAccess = rotated.access;
    nextRefresh = rotated.refresh;
    modelResponse = await fetch(withQuery(MODELS_PATH), {
      headers: requestHeaders(nextAccess),
      signal: AbortSignal.timeout(30_000),
    });
  }
  const body = await responseJson(modelResponse);
  if (!modelResponse.ok || !body || body.code !== 0) {
    throw new Error(
      firstString(body?.message, `LobsterAI Token 验证失败（HTTP ${modelResponse.status}）`),
    );
  }
  let profile = null;
  try {
    const profileResponse = await fetch(withQuery(PROFILE_PATH), {
      headers: requestHeaders(nextAccess),
      signal: AbortSignal.timeout(15_000),
    });
    if (profileResponse.ok) {
      const profileBody = await responseJson(profileResponse);
      if (profileBody?.code === 0) profile = profileBody.data ?? null;
    }
  } catch {
    // The account can still be used without the optional profile read.
  }
  const account = accountFromAccess(
    nextAccess,
    profile && typeof profile === "object" && profile.user && typeof profile.user === "object"
      ? profile.user
      : {},
  );
  const enterprise =
    enterpriseFromPayload(profile) ??
    (account.enterpriseId
      ? { enterpriseId: account.enterpriseId, accountMode: "enterprise" }
      : null);
  return {
    type: "success",
    access: nextAccess,
    refresh: nextRefresh,
    expires: account.expires || tokenExpiry(nextAccess),
    accountId: accountLabel(account, enterprise),
    ...(account.uid ? { uid: account.uid } : {}),
    ...(account.email ? { email: account.email } : {}),
    ...(account.name ? { name: account.name } : {}),
    ...(enterprise ?? {}),
  };
}

export async function LobsterAIAuthPlugin({ client, magpie } = {}) {
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      const was = cfg.provider[PROVIDER] ?? {};
      cfg.provider[PROVIDER] = {
        name: PROVIDER_NAME,
        npm: NPM,
        api: PROXY_BASE,
        ...was,
        models: {
          ...staticConfigModels(),
          ...(was.models ?? {}),
        },
      };
    },

    auth: {
      provider: PROVIDER,
      icon: "https://raw.githubusercontent.com/netease-youdao/LobsterAI/main/public/logo.png",
      maxConcurrency: MAX_CONCURRENCY,
      refreshLead: REFRESH_LEAD_MS,
      rotating: true,

      options: [{
        key: "hide_dsh",
        label: "Hide DeepSeek Harness's name",
        description: "Remove DeepSeek Harness names from system instructions and tool descriptions. This does not prevent account restrictions.",
        default: true,
        labels: { zh: "隐去 DeepSeek Harness 的名字" },
        descriptions: { zh: "从系统指令和工具描述中隐去 DeepSeek Harness 名称；不能保证避免账号受限。" },
      }],

      methods: [
        {
          type: "oauth",
          label: "LobsterAI 账号（浏览器登录）",
          async authorize(_inputs, { signal } = {}) {
            try {
              const flow = await beginBrowserLogin({ signal });
              return {
                url: flow.url,
                instructions: "请在浏览器中登录 LobsterAI；完成后会自动返回 Magpie。",
                method: "auto",
                async callback(_code, callbackOptions = {}) {
                  try {
                    const code = await flow.waitForCode(callbackOptions.signal);
                    const data = await exchangeCode(code);
                    const account = accountFromAccess(data.access, data.user);
                    const enterprise =
                      data.enterprise ??
                      (account.enterpriseId
                        ? { enterpriseId: account.enterpriseId, accountMode: "enterprise" }
                        : null);
                    return {
                      type: "success",
                      access: data.access,
                      refresh: data.refresh,
                      expires: account.expires || tokenExpiry(data.access),
                      accountId: accountLabel(account, enterprise),
                      ...(account.uid ? { uid: account.uid } : {}),
                      ...(account.email ? { email: account.email } : {}),
                      ...(account.name ? { name: account.name } : {}),
                      ...(enterprise ?? {}),
                      quota: data.quota,
                    };
                  } catch (error) {
                    return {
                      type: "failed",
                      error: error instanceof Error ? error.message : String(error),
                    };
                  } finally {
                    await flow.close();
                  }
                },
              };
            } catch (error) {
              return {
                type: "failed",
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        },
        {
          type: "oauth",
          label: "LobsterAI Token（高级）",
          prompts: [
            {
              type: "password",
              key: "access",
              message: "Access Token",
              placeholder: "eyJ...",
              validate: (value) => (firstString(value) ? undefined : "请输入 Access Token"),
            },
            {
              type: "password",
              key: "refresh",
              message: "Refresh Token（可选）",
              placeholder: "没有可留空",
            },
          ],
          async authorize(inputs = {}) {
            const access = firstString(inputs.access);
            const refresh = firstString(inputs.refresh);
            if (!access) {
              return { type: "failed", error: "请输入 Access Token" };
            }
            let validated;
            try {
              validated = await validatePastedTokens(access, refresh);
            } catch (error) {
              return {
                type: "failed",
                error: error instanceof Error ? error.message : String(error),
              };
            }
            return {
              url: "",
              instructions: "Token 已验证，确认后完成登录。",
              method: "auto",
              async callback() {
                return validated;
              },
            };
          },
        },
      ],

      async loader(getAuth) {
        const auth = await readAuth(getAuth);
        if (!auth?.access && !auth?.refresh) return {};
        const ctx = { getAuth, client, fetchImpl: fetch, hideDsh: () => magpie?.option?.(PROVIDER, "hide_dsh") !== false };
        return {
          baseURL: PROXY_BASE,
          apiKey: "lobsterai",
          async fetch(input, init = {}) {
            return authorizedFetch(input, init, ctx);
          },
        };
      },

      async refresh(auth) {
        if (auth?.type !== "oauth" || !auth.refresh) return undefined;
        const next = await refreshTokens(auth.refresh);
        return {
          access: next.access,
          refresh: next.refresh,
          expires: tokenExpiry(next.access),
        };
      },

      // magpie's own hook: claims LobsterAI's daily check-in credits, once a day
      // per account while Settings › Usage › Plugins has it on.
      async checkin(getAuth) {
        const auth = await readAuth(getAuth);
        if (!auth?.access && !auth?.refresh) {
          return { outcome: "failed", message: "LobsterAI 未登录", signIn: "expired" };
        }
        try {
          return await claimDailyCheckIn({ getAuth, client, fetchImpl: fetch });
        } catch (error) {
          return {
            outcome: "failed",
            message: error instanceof Error ? error.message : String(error),
            ...(error?.signIn === "expired" ? { signIn: "expired" } : {}),
          };
        }
      },

      async usage(getAuth) {
        const auth = await readAuth(getAuth);
        if (!auth?.access && !auth?.refresh) {
          return { error: "LobsterAI 未登录", windows: [], signIn: "kept" };
        }
        try {
          const response = await authorizedFetch(
            withQuery(QUOTA_PATH),
            { method: "GET", headers: { accept: "application/json" } },
            { getAuth, client, fetchImpl: fetch },
          );
          const latest = await readAuth(getAuth);
          const renewed = Boolean(latest?.access && latest.access !== auth.access);
          const body = await responseJson(response);
          const kept = response.headers.get("X-Magpie-Sign-In") === "kept";
          const profile = await readCreditProfile({ getAuth, client, fetchImpl: fetch });
          if (!kept && (response.status === 401 || isExpiredCode(body?.code))) {
            return {
              error: firstString(body?.message, "LobsterAI 登录已过期，请重新登录"),
              windows: [],
              signIn: renewed ? "renewed" : "expired",
            };
          }
          if (!response.ok || !body || body.code !== 0 || !body.data) {
            return {
              error: firstString(body?.message, `LobsterAI 额度读取失败（HTTP ${response.status}）`),
              windows: [],
              signIn: renewed ? "renewed" : "kept",
            };
          }
          return {
            ...normalizeQuota(body.data, latest ?? auth, profile),
            signIn: renewed ? "renewed" : "kept",
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            windows: [],
            ...(error?.signIn === "expired" ? { signIn: "expired" } : { signIn: "kept" }),
          };
        }
      },
    },

    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        const have = provider?.models ?? {};
        if (!auth?.access && !auth?.refresh) return have;
        try {
          const response = await authorizedFetch(
            withQuery(MODELS_PATH),
            { method: "GET", headers: { accept: "application/json" } },
            { getAuth: async () => auth, client, fetchImpl: fetch },
          );
          const body = await responseJson(response);
          const kept = response.headers.get("X-Magpie-Sign-In") === "kept";
          if (!kept && (response.status === 401 || isExpiredCode(body?.code))) {
            throw authFailure(
              firstString(body?.message, "LobsterAI 登录已过期，请重新登录"),
            );
          }
          if (!response.ok || !body || body.code !== 0 || !Array.isArray(body.data)) {
            return have;
          }
          const accessible = body.data.filter(
            (model) =>
              model?.accessible !== false &&
              !VIRTUAL_MODELS.has(String(model?.modelId ?? model?.id ?? "")),
          );
          if (accessible.length === 0) return have;
          rememberServerModels(accessible);
          const out = {};
          for (const raw of accessible) {
            const info = infoFromServerModel(raw);
            if (!info) continue;
            out[info.id] = magpieModel(info, have[info.id]);
          }
          return Object.keys(out).length > 0 ? out : have;
        } catch (error) {
          if (error?.signIn === "expired") throw error;
          return have;
        }
      },
    },

    "chat.headers": async (input, output) => {
      const providerId = input?.model?.providerID ?? input?.provider?.info?.id;
      if (providerId !== PROVIDER && providerId !== `${PROVIDER}-plugin`) return;
      const id = sessionHeader(input?.sessionID);
      if (id) {
        output.headers ??= {};
        output.headers["x-lobster-session-id"] = id;
      }
    },
  };
}

export const _internal = {
  LOGIN_TIMEOUT_MS,
  MODELS_PATH,
  QUOTA_PATH,
  accountFromAccess,
  beginBrowserLogin,
  claimDailyCheckIn,
  exchangeCode,
  modelInfo,
  normalizeQuota,
  parseJson,
  refreshTokens,
  sessionHeader,
  tokenExpiry,
  validatePastedTokens,
  withQuery,
};
