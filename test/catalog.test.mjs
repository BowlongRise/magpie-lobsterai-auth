import test from "node:test";
import assert from "node:assert/strict";

import {
  STATIC_MODELS,
  infoFromServerModel,
  magpieModel,
  modelInfo,
  variantsFromThinking,
} from "../lib/catalog.mjs";

test("static catalog covers the current plan models", () => {
  assert.equal(STATIC_MODELS.length, 21);
  assert.equal(modelInfo("deepseek-flash").name, "DeepSeek-V4.1-Flash");
  assert.equal(modelInfo("kimi-k3").output, 1_048_576);
});

test("server metadata replaces the static entry", () => {
  const info = infoFromServerModel({
    modelId: "test-dynamic-model",
    modelName: "Dynamic Test Model",
    contextWindow: 123456,
    maxTokens: 4096,
    supportsImage: false,
    supportsThinking: true,
    costMultiplier: 0.5,
    thinkingConfig: {
      options: [
        { level: "off", openclawLevel: "off" },
        { level: "medium", openclawLevel: "medium" },
        { level: "max", openclawLevel: "xhigh" },
      ],
      defaultLevel: "medium",
    },
    apiFormat: "openai",
  });
  assert.equal(info.name, "Dynamic Test Model");
  assert.equal(info.context, 123456);
  assert.equal(info.output, 4096);
  assert.equal(info.image, false);
  assert.equal(info.rate, 0.5);
  assert.equal(info.thinking.defaultLevel, "medium");
});

test("Magpie model carries limits, images, variants and rate", () => {
  const model = magpieModel(modelInfo("glm-5.3-flash"));
  assert.equal(model.limit.context, 1_000_000);
  assert.equal(model.limit.output, 32_768);
  assert.equal(model.attachment, true);
  assert.equal(model.capabilities.toolcall, true);
  assert.deepEqual(model.capabilities.input.image, true);
  assert.equal(model.rate, 0.06);
  assert.equal(model.variants.max.reasoningEffort, "xhigh");
  assert.equal(model.variants.off.reasoningEffort, "none");
});

test("Kimi K3 variants all route to max on the wire", () => {
  const variants = variantsFromThinking(modelInfo("kimi-k3").thinking);
  assert.equal(variants.low.reasoningEffort, "max");
  assert.equal(variants.xhigh.reasoningEffort, "max");
  assert.equal(variants.max.reasoningEffort, "max");
});

test("Kimi K3 keeps its runtime limits even if the server omits them", () => {
  const info = infoFromServerModel({
    modelId: "kimi-k3-YoudaoInner",
    supportsImage: false,
    supportsVideo: false,
    supportsThinking: false,
    contextWindow: 1,
    maxTokens: 1,
  });
  assert.equal(info.context, 1_048_576);
  assert.equal(info.output, 1_048_576);
  assert.equal(info.image, true);
  assert.equal(info.video, true);
  assert.equal(info.reasoning, true);
});
