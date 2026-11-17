import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQuota } from "../lib/usage.mjs";

test("daily free quota becomes one window", () => {
  const usage = normalizeQuota(
    {
      planName: "Free",
      subscriptionStatus: "free",
      dailyCreditsLimit: 1000,
      dailyCreditsUsed: 250,
    },
    { email: "ada@example.com" },
  );
  assert.equal(usage.plan, "Free");
  assert.equal(usage.user, "ada@example.com");
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0].name, "Daily credits");
  assert.equal(usage.windows[0].used, 25);
  assert.equal(usage.balance, "750 credits");
});

test("team quota and monthly quota are separate windows", () => {
  const usage = normalizeQuota({
    planName: "团队版",
    subscriptionStatus: "enterprise",
    limit: 8000,
    used: 1200,
    monthlyCreditsLimit: 1000,
    monthlyCreditsUsed: 50,
  });
  assert.deepEqual(
    usage.windows.map((window) => window.name),
    ["Team credits", "Monthly credits"],
  );
  assert.equal(usage.windows[0].used, 15);
  assert.equal(usage.windows[1].used, 5);
});

test("unknown quota produces no invented usage", () => {
  const usage = normalizeQuota({ subscriptionStatus: "free" });
  assert.equal(usage.windows.length, 0);
  assert.equal("balance" in usage, false);
  assert.equal(usage.signIn, "kept");
});

test("campaign credits from profile-summary make up the real balance", () => {
  const usage = normalizeQuota(
    {
      planName: "免费",
      subscriptionStatus: "free",
      freeCreditsTotal: 300,
      freeCreditsUsed: 0,
      freeCreditsRemaining: 300,
    },
    {},
    {
      totalCreditsRemaining: 500,
      creditItems: [
        {
          type: "free",
          label: "新用户赠送",
          creditsRemaining: 300,
          expiresAt: "2026-11-30T13:38:15",
        },
        {
          type: "campaign",
          label: "每日登录奖励",
          creditsRemaining: 100,
          expiresAt: "2026-12-16T13:47:13",
        },
        {
          type: "campaign",
          label: "每日登录奖励",
          creditsRemaining: 100,
          expiresAt: "2026-12-17T14:57:43",
        },
      ],
    },
  );

  assert.equal(usage.balance, "500 credits");
  assert.deepEqual(
    usage.windows.map((window) => window.limit),
    [300, 100, 100],
  );
  assert.equal(usage.windows[1].name, "每日登录奖励 · 12-16 到期");
});

test("a missing profile falls back to the plan quota", () => {
  const usage = normalizeQuota({
    planName: "免费",
    subscriptionStatus: "free",
    freeCreditsTotal: 300,
    freeCreditsUsed: 30,
  });
  assert.equal(usage.balance, "270 credits");
  assert.deepEqual(
    usage.windows.map((window) => window.name),
    ["Free credits"],
  );
});
