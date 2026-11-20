import test from "node:test";
import assert from "node:assert/strict";

import {
  accountFromAccess,
  appendCallbackReturnTo,
  appendLoginParams,
  beginManualBrowserLogin,
  decodeJwt,
  enterpriseFromPayload,
  parseCallbackInput,
  refreshTokens,
  tokenExpiry,
} from "../lib/auth.mjs";
import { LobsterAIAuthPlugin } from "../index.mjs";

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

test("manual browser login builds a hash-routed login URL without binding a port", async () => {
  const flow = await beginManualBrowserLogin({
    fetchImpl: async () =>
      Response.json({ code: 0, data: { value: "https://lobsterai.youdao.com/portal#/login" } }),
  });
  assert.ok(flow.state.length >= 16);
  const parsed = new URL(flow.url);
  assert.equal(parsed.origin, "https://lobsterai.youdao.com");
  assert.ok(parsed.hash.startsWith("#/login?"));
  const hashParams = new URLSearchParams(parsed.hash.slice("#/login?".length));
  assert.equal(hashParams.get("source"), "electron");
  assert.equal(hashParams.get("state"), flow.state);
  const redirectUri = new URL(hashParams.get("redirect_uri"));
  assert.equal(redirectUri.hostname, "127.0.0.1");
  assert.equal(redirectUri.pathname, "/auth/callback");
  const port = Number(redirectUri.port);
  assert.ok(port >= 30_000 && port < 60_000, `expected high port, got ${port}`);
});

test("parseCallbackInput extracts code from callback URL, query string, or bare code", () => {
  assert.equal(
    parseCallbackInput(
      '  "http://127.0.0.1:42961/auth/callback?return_to=https%3A%2F%2Flobsterai.youdao.com%2Fportal&code=auth-123&state=st-ok"  ',
      "st-ok",
    ),
    "auth-123",
  );
  assert.equal(parseCallbackInput("?code=auth-456&state=st-ok", "st-ok"), "auth-456");
  assert.equal(parseCallbackInput("code=auth-789", "st-ok"), "auth-789");
  assert.equal(parseCallbackInput("  raw-code-xyz  ", "st-ok"), "raw-code-xyz");
});

test("parseCallbackInput rejects mismatched state, login URL, missing code, and empty input", () => {
  assert.throws(() => parseCallbackInput("", "st-ok"), /回调地址或授权码/);
  assert.throws(
    () => parseCallbackInput("http://127.0.0.1:42961/auth/callback?code=auth-123&state=wrong", "st-ok"),
    /state 不匹配/,
  );
  assert.throws(
    () =>
      parseCallbackInput(
        "https://lobsterai.youdao.com/portal#/login?source=electron&redirect_uri=http%3A%2F%2F127.0.0.1%3A42961%2Fauth%2Fcallback&state=st-ok",
        "st-ok",
      ),
    /登录页链接/,
  );
  assert.throws(
    () => parseCallbackInput("http://127.0.0.1:42961/auth/callback?state=st-ok", "st-ok"),
    /缺少授权码/,
  );
  assert.throws(() => parseCallbackInput("not a code with spaces", "st-ok"), /无法识别/);
});

test("manual callback login method uses method=code and exchanges pasted callback URL", async () => {
  const originalFetch = globalThis.fetch;
  const exchanged = [];
  const access = jwt({ email: "ada@example.com", sub: "user-2", exp: 2_000_000_000 });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("overmind")) {
      return Response.json({ code: 0, data: { value: "https://lobsterai.youdao.com/portal#/login" } });
    }
    if (target.endsWith("/api/auth/exchange")) {
      exchanged.push(JSON.parse(init.body));
      return Response.json({
        code: 0,
        data: { accessToken: access, refreshToken: "ref-2", user: { email: "ada@example.com" }, quota: {} },
      });
    }
    throw new Error(`unexpected fetch ${target}`);
  };
  try {
    const plugin = await LobsterAIAuthPlugin();
    const manual = plugin.auth.methods.find((m) => m.label.includes("粘贴回调地址"));
    assert.ok(manual, "manual callback login method should exist");
    const auth = await manual.authorize();
    assert.equal(auth.method, "code");
    const hash = new URL(auth.url).hash;
    const state = new URLSearchParams(hash.slice(hash.indexOf("?") + 1)).get("state");
    const bad = await auth.callback(`http://127.0.0.1:42961/auth/callback?code=c1&state=wrong`);
    assert.equal(bad.type, "failed");
    assert.match(bad.error, /state 不匹配/);
    const ok = await auth.callback(`http://127.0.0.1:42961/auth/callback?return_to=x&code=c-ok&state=${state}`);
    assert.equal(ok.type, "success");
    assert.equal(ok.access, access);
    assert.equal(ok.refresh, "ref-2");
    assert.equal(ok.accountId, "ada@example.com");
    assert.equal(exchanged.length, 1);
    assert.equal(exchanged[0].authCode, "c-ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
