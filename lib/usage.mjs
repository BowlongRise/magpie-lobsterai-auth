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
function creditItemWindow(item) {
  const credits = Number(item?.creditsRemaining);
  if (!Number.isFinite(credits) || credits <= 0) return null;
  const label = firstString(item.label, item.labelEn, item.type, "Credits");
  const expiresAt = toIso(item.expiresAt);
  return {
    name: expiresAt ? `${label} · ${expiresAt.slice(5, 10)} 到期` : label,
    used: 0,
    amount: 0,
    limit: credits,
    unit: "credits",
    display: `${compactNumber(credits)} credits`,
    ...(expiresAt ? { resetsAt: expiresAt } : {}),
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
