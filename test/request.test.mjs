import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptRequestBody,
  applyKimiK3Contract,
  isKimiK3,
  requestHeaders,
  resolveThinkingLevel,
} from "../lib/request.mjs";
import { modelInfo, rememberServerModels } from "../lib/catalog.mjs";

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
