import test from "node:test";
import assert from "node:assert/strict";

import {
  accountFromAccess,
  appendCallbackReturnTo,
  appendLoginParams,
  decodeJwt,
  enterpriseFromPayload,
  refreshTokens,
  tokenExpiry,
} from "../lib/auth.mjs";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

test("login params go inside a hash route", () => {
  assert.equal(
    appendLoginParams("https://lobsterai.youdao.com/portal#/login", {
      source: "electron",
      state: "abc",
    }),
    "https://lobsterai.youdao.com/portal#/login?source=electron&state=abc",
  );
  assert.equal(
    appendLoginParams("https://example.com/login?foo=bar", { source: "electron" }),
    "https://example.com/login?foo=bar&source=electron",
  );
});

test("callback return_to is nested in the redirect URI", () => {
  assert.equal(
    appendCallbackReturnTo("http://127.0.0.1:43210/auth/callback", "https://lobsterai.youdao.com/portal#/login"),
    "http://127.0.0.1:43210/auth/callback?return_to=https%3A%2F%2Flobsterai.youdao.com%2Fportal%23%2Flogin",
  );
});

test("JWT claims provide the account name and expiry", () => {
  const access = jwt({ email: "ada@example.com", sub: "user-1", exp: 2_000_000_000 });
  assert.equal(decodeJwt(access).email, "ada@example.com");
  assert.equal(tokenExpiry(access), 2_000_000_000_000);
  assert.deepEqual(accountFromAccess(access), {
    accountId: "ada@example.com",
    uid: "user-1",
    email: "ada@example.com",
    name: "",
    enterpriseId: "",
    expires: 2_000_000_000_000,
  });
});

test("enterprise context is found in the login payload", () => {
  assert.deepEqual(
    enterpriseFromPayload({
      data: {
        accountMode: "enterprise",
        user: { enterpriseId: 1001, enterpriseName: "Acme", role: "member" },
      },
    }),
    {
      enterpriseId: "1001",
      accountMode: "enterprise",
      enterpriseName: "Acme",
    },
  );
  assert.equal(enterpriseFromPayload({ data: { accountMode: "personal" } }), null);
});

test("refresh rotates both tokens", async () => {
  const calls = [];
  const result = await refreshTokens("old-refresh", async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({
      code: 0,
      data: { accessToken: jwt({ exp: 2_000_000_100 }), refreshToken: "new-refresh" },
    });
  });
  assert.equal(result.refresh, "new-refresh");
  assert.equal(calls[0].url, "https://lobsterai-server.youdao.com/api/auth/refresh");
  assert.equal(calls[0].body.refreshToken, "old-refresh");
  assert.equal(calls[0].body.keyfrom, "magpie");
});

test("a rejected refresh is a terminal sign-in failure", async () => {
  await assert.rejects(
    () =>
      refreshTokens("spent", async () =>
        Response.json({ code: 40100, message: "登录已过期" }, { status: 401 }),
      ),
    (error) => error.signIn === "expired",
  );
});
