import { compactNumber, firstString, toIso } from "./util.mjs";

function windowFrom(name, usedValue, limitValue, unit = "credits", resetsAt) {
  const used = Number(usedValue);
  const limit = Number(limitValue);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const safeUsed = Number.isFinite(used) ? used : 0;
  return {
    name,
    used: (safeUsed / limit) * 100,
    amount: safeUsed,
    limit,
    unit,
    display: `${compactNumber(safeUsed)} / ${compactNumber(limit)} ${unit}`,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

// LobsterAI grants campaign credits (the daily check-in, the new-user gift) as
// separate items: /api/user/quota only reports the plan's own pool, while
// /api/user/profile-summary lists every item and the total across them.
// LobsterAI writes its timestamps without a zone, in Beijing time.
function parseLobsterTime(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}+08:00`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function localDay(date) {
  if (!date) return undefined;
  try {
    const text = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    return text.slice(5);
  } catch {
    return undefined;
  }
}

// An item only says what is left, so it is a balance-shaped window: no used or
// limit, which would otherwise read as "0 used of <remaining>".
function creditItemWindow(item) {
  const credits = Number(item?.creditsRemaining);
  if (!Number.isFinite(credits) || credits <= 0) return null;
  const label = firstString(item.label, item.labelEn, item.type, "Credits");
  const expires = parseLobsterTime(item.expiresAt);
  const day = localDay(expires);
  return {
    name: day ? `${label} · ${day} 到期` : label,
    balance: credits,
    unit: "credits",
    display: `${compactNumber(credits)} credits`,
    ...(expires ? { resetsAt: expires.toISOString() } : {}),
  };
}

export function normalizeQuota(raw, auth = {}, profile = null) {
  const data = raw && typeof raw === "object" ? raw : {};
  const resetsAt = toIso(
    data.periodEndExclusive ??
      data.periodEnd ??
      data.nextResetAt ??
      data.resetAt ??
      data.expireAt,
  );
  const until = toIso(
    data.subscriptionEndAt ??
      data.subscriptionExpireAt ??
      data.periodEndExclusive ??
      data.expireAt,
  );
  const windows = [];

  const candidates = [
    ["Team credits", data.limit, data.used],
    ["Free credits", data.freeCreditsTotal, data.freeCreditsUsed],
    ["Monthly credits", data.monthlyCreditsLimit, data.monthlyCreditsUsed],
    ["Daily credits", data.dailyCreditsLimit, data.dailyCreditsUsed],
    ["Credits", data.creditsLimit, data.creditsUsed],
  ];
  for (const [name, limit, used] of candidates) {
    const window = windowFrom(name, used, limit, "credits", resetsAt);
    if (window) windows.push(window);
  }

  const items = Array.isArray(profile?.creditItems) ? profile.creditItems : [];
  const itemWindows = items.map(creditItemWindow).filter(Boolean);
  const allWindows = itemWindows.length > 0 ? itemWindows : windows;

  const limit = allWindows[0]?.limit ?? 0;
  const used = allWindows[0]?.amount ?? 0;
  const profileTotal = Number(profile?.totalCreditsRemaining);
  const remaining =
    Number.isFinite(profileTotal) && profileTotal >= 0
      ? profileTotal
      : Number.isFinite(data.creditsRemaining) && data.creditsRemaining >= 0
        ? data.creditsRemaining
        : limit > 0
          ? Math.max(0, limit - used)
          : undefined;

  const plan = firstString(
    data.planName,
    data.plan,
    data.subscriptionStatus === "enterprise"
      ? "Team"
      : data.subscriptionStatus === "active"
        ? "Standard"
        : "Free",
  );

  return {
    plan,
    user: firstString(data.userName, data.user, auth.email, auth.accountId),
    until,
    windows: allWindows,
    ...(remaining !== undefined
      ? { balance: `${compactNumber(remaining)} credits` }
      : {}),
    signIn: "kept",
  };
}

export function isExpiredCode(code) {
  const value = Number(code);
  return value === 40100 || value === 40101;
}
