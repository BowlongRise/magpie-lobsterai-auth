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

export function normalizeQuota(raw, auth = {}) {
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

  const limit = windows[0]?.limit ?? 0;
  const used = windows[0]?.amount ?? 0;
  const remaining =
    Number.isFinite(data.creditsRemaining) && data.creditsRemaining >= 0
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
    windows,
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
