import test from "node:test";
import assert from "node:assert/strict";

import { claimDailyCheckIn, nextLocalMidnight } from "../lib/checkin.mjs";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

const access = jwt({ sub: "user-1", exp: 2_000_000_000 });

function authState() {
  return {
    type: "oauth",
    access,
    refresh: "refresh-1",
    expires: Date.now() + 3_600_000,
    accountId: "ada@example.com",
  };
}

const activity = {
  activityCode: "daily_check_in_2026",
  configRevision: 3,
  activityType: "daily_check_in",
  placement: "desktop_sidebar",
  timezone: "Asia/Shanghai",
};

function slotBody(available = true) {
  return available
    ? { code: 0, data: { slotState: "available", serverTime: "2026-11-16T00:00:00Z", activity } }
    : { code: 0, data: { slotState: "empty", serverTime: "2026-11-16T00:00:00Z" } };
}

function contextBody({ claimedToday = false, claimedDays = 2, claimedCredits = 0 } = {}) {
  return {
    code: 0,
    data: {
      activityCode: activity.activityCode,
      configRevision: activity.configRevision,
      lifecycleState: "active",
      authenticated: true,
      loginRequired: true,
      serverTime: "2026-11-16T00:00:00Z",
      state: {
        claimedToday,
        completed: claimedToday,
        rewardCredits: 100,
        claimedCredits,
        claimedDays,
        totalDays: 7,
        timezone: "Asia/Shanghai",
      },
      actions: ["check_in"],
    },
  };
}

function harness({ slot = slotBody(), context = contextBody(), action } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method ?? "GET", body: init.body });
    if (target.includes("/api/client-activities/slot")) return Response.json(slot);
    if (target.includes("/actions/check_in")) {
      return Response.json(action ?? { code: 0, data: { result: {}, context: contextBody({ claimedToday: true }) } });
    }
    if (target.includes("/context")) return Response.json(context);
    throw new Error(`unexpected request ${target}`);
  };
  return {
    calls,
    ctx: { getAuth: async () => authState(), fetchImpl },
  };
}

test("a fresh day is claimed and mapped to magpie's checkin contract", async () => {
  const action = {
    code: 0,
    data: {
      replayed: false,
      result: { creditsGranted: 100, claimedDays: 3 },
      context: contextBody({ claimedToday: true, claimedDays: 3, claimedCredits: 100 }),
    },
  };
  const { ctx, calls } = harness({ action });
  const result = await claimDailyCheckIn(ctx);

  assert.equal(result.outcome, "claimed");
  assert.equal(result.credit, 100);
  assert.equal(result.streak, 3);
  assert.match(result.until, /T16:00:00\.000Z$/);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET", "POST"],
  );
  assert.match(calls[0].url, /placement=desktop_sidebar/);
  assert.match(calls[0].url, /containerApiVersion=2/);
  assert.match(calls[0].url, /clientVersion=/);
  assert.deepEqual(JSON.parse(calls[2].body).payload, {});
  assert.equal(JSON.parse(calls[2].body).configRevision, 3);
});

test("an already claimed day is done and never posts", async () => {
  const { ctx, calls } = harness({
    context: contextBody({ claimedToday: true, claimedDays: 4, claimedCredits: 100 }),
  });
  const result = await claimDailyCheckIn(ctx);

  assert.equal(result.outcome, "done");
  assert.equal(result.credit, 100);
  assert.equal(result.streak, 4);
  assert.equal(calls.length, 2);
});

test("already claimed on the server is done, not a failure", async () => {
  const { ctx } = harness({
    action: { code: 51104, message: "already claimed" },
    context: contextBody(),
  });
  const result = await claimDailyCheckIn(ctx);
  assert.equal(result.outcome, "done");
});

test("no activity in the slot is inactive", async () => {
  const { ctx } = harness({ slot: slotBody(false) });
  const result = await claimDailyCheckIn(ctx);
  assert.equal(result.outcome, "inactive");
});

test("a signed-out check-in reports an expired sign-in", async () => {
  const { ctx } = harness({ action: { code: 51102, message: "login required" } });
  await assert.rejects(() => claimDailyCheckIn(ctx), (error) => error.signIn === "expired");
});

test("the reward day turns at local midnight", () => {
  assert.equal(
    nextLocalMidnight("Asia/Shanghai", Date.UTC(2026, 10, 16, 10, 0, 0)),
    "2026-11-16T16:00:00.000Z",
  );
  assert.equal(
    nextLocalMidnight("UTC", Date.UTC(2026, 10, 16, 10, 0, 0)),
    "2026-11-17T00:00:00.000Z",
  );
});
