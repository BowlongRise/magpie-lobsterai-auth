import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptRequestBody,
  applyKimiK3Contract,
  isKimiK3,
  requestHeaders,
  applyClientTrace,
  resolveThinkingLevel,
} from "../lib/request.mjs";
import { modelInfo, rememberServerModels } from "../lib/catalog.mjs";
import { WINDOWS_CLIENT_USER_AGENT } from "../lib/constants.mjs";

test("sets the observed desktop user agent on Windows", () => {
  const headers = requestHeaders("test-token");
  if (process.platform === "win32") assert.equal(headers.get("user-agent"), WINDOWS_CLIENT_USER_AGENT);
  else assert.equal(headers.has("user-agent"), false);
});

test("chat requests carry the desktop trace context and user message", () => {
  const headers = applyClientTrace(
    new Headers({ accept: "application/json" }),
    JSON.stringify({
      model: "deepseek-flash",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "你好" },
      ],
    }),
  );
  const trace = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(headers.get("traceparent"));
  assert.ok(trace, "traceparent has the W3C shape");
  assert.equal(headers.get("x-lobster-turn-id"), trace[1]);
  assert.equal(headers.get("x-lobster-user-message"), "%E4%BD%A0%E5%A5%BD");
  assert.equal(headers.get("sec-fetch-site"), "none");
});

test("hides DeepSeek Harness in instructions while preserving paths and tool results", () => {
  const input = {
    model: "kimi-k3",
    messages: [
      { role: "system", content: "You are an AI agent powered by DeepSeek Harness. Use /root/DSH/ and DSH.md." },
      { role: "user", content: "Tell me about DeepSeek Harness" },
      { role: "tool", content: "DeepSeek Harness" },
    ],
    tools: [{ function: { name: "read", description: "Read for DeepSeek Harness" } }],
  };
  const output = JSON.parse(adaptRequestBody(JSON.stringify(input)));
  assert.equal(output.messages[0].content, "You are an AI agent. Use /root/DSH/ and DSH.md.");
  assert.equal(output.messages[1].content, input.messages[1].content);
  assert.equal(output.messages[2].content, input.messages[2].content);
  assert.equal(output.tools[0].function.description, "Read for the agent harness");
  const unhidden = JSON.parse(adaptRequestBody(JSON.stringify(input), undefined, false));
  assert.equal(
    unhidden.messages[0].content,
    "You are an AI agent, powered by DeepSeek Harness. Use /root/DSH/ and DSH.md.",
  );
  assert.equal(unhidden.messages[2].content, input.messages[2].content);
});

test("always rewords the measured lines, even with the hide switch off", () => {
  const input = {
    model: "deepseek-flash",
    messages: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "x-anthropic-billing-header: abc\nCodex CLI is an open source project led by OpenAI." },
      { role: "tool", content: "the Codex CLI is an open source project led by OpenAI." },
    ],
  };
  const output = JSON.parse(adaptRequestBody(JSON.stringify(input), undefined, false));
  assert.equal(output.messages[0].content, "You are Claude Code, Anthropic's CLI for Claude.");
  assert.equal(output.messages[1].content, "The Codex CLI is an open source project led by OpenAI.");
  assert.equal(output.messages[2].content, input.messages[2].content);
});

test("thinking effort is folded into lobsterai_options", () => {
  const text = JSON.stringify({
    model: "deepseek-flash",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  });
  const out = JSON.parse(adaptRequestBody(text, "deepseek-flash"));
  assert.deepEqual(out.lobsterai_options, {
    version: 1,
    thinking: { level: "max" },
  });
  assert.equal("reasoning_effort" in out, false);
});

test("a missing effort uses the model default", () => {
  const out = JSON.parse(
    adaptRequestBody(JSON.stringify({ model: "glm-5.3-flash" }), "glm-5.3-flash"),
  );
  assert.deepEqual(out.lobsterai_options.thinking, { level: "max" });
});

test("Kimi K3 sends its fixed contract", () => {
  const payload = {
    model: "kimi-k3",
    temperature: 0.7,
    top_p: 0.9,
    max_completion_tokens: 1234,
    stream_options: { include_usage: true },
    thinking: { type: "enabled" },
    messages: [
      {
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "x", arguments: "{}" } }],
      },
    ],
  };
  applyKimiK3Contract(payload);
  assert.equal(payload.reasoning_effort, "max");
  assert.equal(payload.max_tokens, 1234);
  assert.equal("max_completion_tokens" in payload, false);
  assert.equal("temperature" in payload, false);
  assert.equal("top_p" in payload, false);
  assert.equal("stream_options" in payload, false);
  assert.equal("lobsterai_options" in payload, false);
  assert.equal(payload.messages[0].reasoning_content, "");
  assert.equal(isKimiK3("kimi-k3-YoudaoInner"), true);
  assert.equal(isKimiK3("Kimi-K3"), true);
});

test("Kimi K3 never sends lobsterai_options", () => {
  const out = JSON.parse(
    adaptRequestBody(
      JSON.stringify({ model: "kimi-k3", reasoning_effort: "max" }),
      "kimi-k3",
    ),
  );
  assert.equal("lobsterai_options" in out, false);
  assert.equal(out.reasoning_effort, "max");
});

test("lobsterai_options follows the server request capability", () => {
  rememberServerModels([
    {
      modelId: "test-with-options",
      modelName: "With options",
      supportsThinking: true,
      requestCapabilities: ["thinking-level-control-v1"],
      thinkingConfig: {
        options: [{ level: "high", openclawLevel: "high" }],
        defaultLevel: "high",
      },
    },
    {
      modelId: "test-without-options",
      modelName: "Without options",
      supportsThinking: true,
      requestCapabilities: [],
      thinkingConfig: {
        options: [{ level: "high", openclawLevel: "high" }],
        defaultLevel: "high",
      },
    },
  ]);
  const withOptions = JSON.parse(
    adaptRequestBody(
      JSON.stringify({ model: "test-with-options", reasoning_effort: "high" }),
      "test-with-options",
    ),
  );
  assert.deepEqual(withOptions.lobsterai_options, {
    version: 1,
    thinking: { level: "high" },
  });
  assert.equal("reasoning_effort" in withOptions, false);

  const withoutOptions = JSON.parse(
    adaptRequestBody(
      JSON.stringify({ model: "test-without-options", reasoning_effort: "high" }),
      "test-without-options",
    ),
  );
  assert.equal("lobsterai_options" in withoutOptions, false);
  assert.equal(withoutOptions.reasoning_effort, "high");
});

test("thinking level resolution accepts server and OpenClaw spellings", () => {
  const thinking = modelInfo("deepseek-flash").thinking;
  assert.equal(resolveThinkingLevel(thinking, "xhigh"), "max");
  assert.equal(resolveThinkingLevel(thinking, "max"), "max");
  assert.equal(resolveThinkingLevel(thinking, "none"), "off");
  assert.equal(resolveThinkingLevel(thinking, undefined), "high");
});

test("enterprise accounts send LobsterAI context headers", () => {
  const headers = requestHeaders("access", undefined, {
    enterpriseId: "1001",
  });
  assert.equal(headers.get("X-LobsterAI-Account-Mode"), "enterprise");
  assert.equal(headers.get("X-LobsterAI-Enterprise-Id"), "1001");
  assert.equal(headers.get("Authorization"), "Bearer access");
});
