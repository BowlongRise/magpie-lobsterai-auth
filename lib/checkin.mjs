import { randomUUID } from "node:crypto";

import { CLIENT_VERSION, KEYFROM, SERVER_BASE } from "./constants.mjs";
import { authorizedFetch } from "./request.mjs";
import { firstString, parseJson } from "./util.mjs";

const SLOT_PATH = "/api/client-activities/slot";
const PLACEMENT = "desktop_sidebar";
// ActivityContainerApiVersion.NativeDailyCheckInV1 in the LobsterAI client.
const CONTAINER_API_VERSION = 2;
const DAILY_CHECK_IN = "daily_check_in";
const CHECK_IN_ACTION = "check_in";
const FALLBACK_TIMEZONE = "Asia/Shanghai";

// ActivityServerErrorCode in the LobsterAI client.
const ERROR_CODE = {
  notActive: 51101,
  loginRequired: 51102,
  alreadyClaimed: 51104,
  revisionMismatch: 51106,
};

function currentPlatform() {
  const value = typeof process !== "undefined" ? process.platform : "";
  return firstString(value) || "unknown";
}

function activityUrl(path, params = {}) {
  const url = new URL(`${SERVER_BASE}${path}`);
  url.searchParams.set("keyfrom", KEYFROM);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function idempotencyKey() {
  try {
    return randomUUID();
  } catch {
    return `magpie-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * The instant the vendor's day turns, as RFC 3339. LobsterAI's activity reports
 * its own timezone; the daily reward is granted per local calendar day.
 */
export function nextLocalMidnight(timezone = FALLBACK_TIMEZONE, now = Date.now()) {
  const zone = firstString(timezone) || FALLBACK_TIMEZONE;
  const date = new Date(now);
  try {
    const dayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal");
    const parts = Object.fromEntries(dayParts.map((part) => [part.type, part.value]));
    const zoneName =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /GMT([+-])(\d{1,2}):(\d{2})/.exec(zoneName);
    const offsetMinutes = match
      ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
      : 0;
    const localMidnight =
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1) -
      offsetMinutes * 60_000;
    if (Number.isFinite(localMidnight)) return new Date(localMidnight).toISOString();
  } catch {
    // An unknown zone falls through to plain UTC midnight.
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  ).toISOString();
}

function apiData(body, fallback) {
  if (!body || body.code !== 0 || body.data === undefined) {
    const error = new Error(firstString(body?.message, fallback));
    if (body?.code !== undefined) error.code = body.code;
    throw error;
  }
  return body.data;
}

async function callActivity(ctx, url, init) {
  const response = await authorizedFetch(url, init, ctx);
  const body = parseJson(await response.text());
  const kept = response.headers.get("X-Magpie-Sign-In") === "kept";
  if (!kept && (response.status === 401 || response.status === 403)) {
    throw Object.assign(
      new Error(firstString(body?.message, "LobsterAI 登录已过期，请重新登录")),
      { signIn: "expired" },
    );
  }
  if (!response.ok) {
    const error = new Error(
      firstString(body?.message, `LobsterAI 签到请求失败（HTTP ${response.status}）`),
    );
    if (body?.code !== undefined) error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function doneOutcome(context) {
  const state = context?.state ?? {};
  const credit = numberOrUndefined(state.claimedCredits ?? state.rewardCredits);
  const streak = numberOrUndefined(state.claimedDays);
  return {
    outcome: "done",
    ...(credit ? { credit } : {}),
    ...(streak ? { streak } : {}),
    message: "今天已经签到过了",
    until: nextLocalMidnight(state.timezone),
  };
}

function claimedOutcome(data, context) {
  const result = data?.result ?? {};
  const state = data?.context?.state ?? context?.state ?? {};
  const credit = numberOrUndefined(result.creditsGranted ?? state.claimedCredits);
  const streak = numberOrUndefined(result.claimedDays ?? state.claimedDays);
  return {
    outcome: "claimed",
    ...(credit ? { credit } : {}),
    ...(streak ? { streak } : {}),
    message: `已签到${credit ? ` +${credit}` : ""}${streak ? ` · 连续 ${streak} 天` : ""}`,
    until: nextLocalMidnight(state.timezone),
  };
}

function statusFromContext(context) {
  const state = context?.state ?? {};
  if (context?.lifecycleState && context.lifecycleState !== "active") {
    return { outcome: "inactive", message: "签到活动不在进行中" };
  }
  if (context?.loginRequired && context?.authenticated === false) {
    throw Object.assign(new Error("LobsterAI 登录已过期，请重新登录"), {
      signIn: "expired",
    });
  }
  if (state.claimedToday || state.completed) return doneOutcome(context);
  return null;
}

async function readContext(ctx, activityCode, configRevision) {
  const body = await callActivity(
    ctx,
    activityUrl(`/api/client-activities/${encodeURIComponent(activityCode)}/context`, {
      configRevision,
    }),
    { method: "GET", headers: { accept: "application/json" } },
  );
  return apiData(body, "LobsterAI 签到状态读取失败");
}

async function submitCheckIn(ctx, activityCode, context, revision) {
  const body = await callActivity(
    ctx,
    activityUrl(
      `/api/client-activities/${encodeURIComponent(activityCode)}/actions/${CHECK_IN_ACTION}`,
    ),
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        configRevision: Number(context?.configRevision ?? revision) || 0,
        idempotencyKey: idempotencyKey(),
        payload: {},
      }),
    },
  );
  return apiData(body, "LobsterAI 签到失败");
}

/**
 * Claims LobsterAI's daily check-in reward for the signed-in account.
 * Returns magpie's checkin contract: {outcome, credit?, streak?, message?, until?}.
 */
export async function claimDailyCheckIn(ctx) {
  const slot = apiData(
    await callActivity(
      ctx,
      activityUrl(SLOT_PATH, {
        placement: PLACEMENT,
        clientVersion: CLIENT_VERSION,
        containerApiVersion: CONTAINER_API_VERSION,
        platform: currentPlatform(),
      }),
      { method: "GET", headers: { accept: "application/json" } },
    ),
    "LobsterAI 签到活动读取失败",
  );

  const activity = slot?.activity;
  if (slot?.slotState !== "available" || !activity) {
    return { outcome: "inactive", message: "今天没有可领取的签到活动" };
  }
  if (activity.activityType && activity.activityType !== DAILY_CHECK_IN) {
    return { outcome: "inactive", message: "当前活动不是每日签到" };
  }
  const activityCode = firstString(activity.activityCode);
  if (!activityCode) {
    return { outcome: "inactive", message: "签到活动缺少 activityCode" };
  }
  const revision = Number(activity.configRevision) || 0;

  const context = await readContext(ctx, activityCode, revision);
  const early = statusFromContext(context);
  if (early) return early;

  try {
    return claimedOutcome(await submitCheckIn(ctx, activityCode, context, revision), context);
  } catch (error) {
    if (error?.code === ERROR_CODE.alreadyClaimed) {
      const latest = await readContext(ctx, activityCode, revision).catch(() => context);
      return doneOutcome(latest);
    }
    if (error?.code === ERROR_CODE.revisionMismatch) {
      const latest = await readContext(ctx, activityCode, revision);
      const again = statusFromContext(latest);
      if (again) return again;
      return claimedOutcome(await submitCheckIn(ctx, activityCode, latest, revision), latest);
    }
    if (error?.code === ERROR_CODE.notActive) {
      return { outcome: "inactive", message: "签到活动当前不可用" };
    }
    if (error?.code === ERROR_CODE.loginRequired) {
      throw Object.assign(new Error("LobsterAI 登录已过期，请重新登录"), {
        signIn: "expired",
      });
    }
    throw error;
  }
}

export const _checkinInternals = {
  CHECK_IN_ACTION,
  ERROR_CODE,
  PLACEMENT,
  SLOT_PATH,
  activityUrl,
};
