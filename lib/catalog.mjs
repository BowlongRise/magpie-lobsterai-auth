import { ANTHROPIC_NPM, GOOGLE_NPM, NPM, PROXY_BASE } from "./constants.mjs";
import { firstString } from "./util.mjs";

const think = (options, defaultLevel) => ({ options, defaultLevel });

const OFF_HIGH_MAX = think(
  [
    { level: "off", openclawLevel: "off" },
    { level: "high", openclawLevel: "high" },
    { level: "max", openclawLevel: "xhigh" },
  ],
  "high",
);

const OFF_HIGH_MAX_DEFAULT_MAX = think(
  [
    { level: "off", openclawLevel: "off" },
    { level: "high", openclawLevel: "high" },
    { level: "max", openclawLevel: "xhigh" },
  ],
  "max",
);

// Kimi K3 always thinks at max. Its UI levels are kept because LobsterAI
// exposes them, but every level is sent to the server as reasoning_effort=max.
const KIMI_K3_THINKING = think(
  [
    { level: "off", openclawLevel: "off" },
    { level: "minimal", openclawLevel: "max" },
    { level: "low", openclawLevel: "max" },
    { level: "medium", openclawLevel: "max" },
    { level: "high", openclawLevel: "max" },
    { level: "xhigh", openclawLevel: "max" },
    { level: "max", openclawLevel: "max" },
  ],
  "high",
);

/**
 * Last-known LobsterAI plan catalog. The authenticated
 * `GET /api/models/available` response replaces this list at runtime.
 * Rates are LobsterAI's cost multipliers, not USD prices.
 */
export const STATIC_MODELS = [
  {
    id: "deepseek-flash",
    name: "DeepSeek-V4.1-Flash",
    context: 400_000,
    output: 32_768,
    image: true,
    rate: 0.05,
    thinking: OFF_HIGH_MAX,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4-Pro",
    context: 1_000_000,
    output: 32_768,
    image: false,
    rate: 0.26,
    thinking: OFF_HIGH_MAX,
  },
  {
    id: "qwen4-max",
    name: "Qwen4-Max",
    context: 0,
    output: 32_768,
    image: true,
    rate: 0.71,
    thinking: OFF_HIGH_MAX,
  },
  {
    id: "qwen3.8-max",
    name: "Qwen3.8-Max",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.91,
    thinking: null,
  },
  {
    id: "qwen3.8-flash",
    name: "Qwen3.8-Flash",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.06,
    thinking: null,
  },
  {
    id: "glm-5.3-flashx",
    name: "GLM-5.3-FlashX",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.15,
    thinking: OFF_HIGH_MAX_DEFAULT_MAX,
  },
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.06,
    thinking: OFF_HIGH_MAX_DEFAULT_MAX,
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    context: 1_000_000,
    output: 32_768,
    image: false,
    rate: 1.08,
    thinking: OFF_HIGH_MAX_DEFAULT_MAX,
  },
  {
    id: "kimi-k3.1-pro",
    name: "Kimi-K3.1-Pro",
    context: 1_048_576,
    output: 32_768,
    image: true,
    rate: 0.88,
    thinking: null,
  },
  {
    id: "kimi-k3.1-pro-highspeed",
    name: "Kimi-K3.1-Pro-Highspeed",
    context: 1_048_576,
    output: 32_768,
    image: true,
    rate: 1.16,
    thinking: null,
  },
  {
    id: "kimi-k2.8-preview",
    name: "Kimi-K2.8-Preview",
    context: 262_144,
    output: 32_768,
    image: true,
    rate: 0.73,
    thinking: null,
  },
  {
    id: "MiniMax-M3.1-Flash",
    name: "MiniMax-M3.1-Flash",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.11,
    thinking: null,
  },
  {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.24,
    thinking: null,
  },
  {
    id: "doubao-seed-2-1-pro-260915",
    name: "Doubao-Seed-2.1-Pro",
    context: 256_000,
    output: 32_768,
    image: true,
    rate: 0.68,
    thinking: null,
  },
  {
    id: "qwen3.8-omni-flash",
    name: "Qwen3.8-Omni-Flash",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.06,
    thinking: null,
  },
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek-V4-Flash-Vision-Exp",
    context: 400_000,
    output: 32_768,
    image: true,
    rate: 0.05,
    thinking: OFF_HIGH_MAX,
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    context: 400_000,
    output: 32_768,
    image: false,
    rate: 0.05,
    thinking: OFF_HIGH_MAX,
  },
  {
    id: "qwen3.7-max",
    name: "Qwen3.7-Max",
    context: 1_000_000,
    output: 32_768,
    image: false,
    rate: 1.33,
    thinking: null,
  },
  {
    id: "qwen3.7-plus",
    name: "Qwen3.7-Plus",
    context: 1_000_000,
    output: 32_768,
    image: true,
    rate: 0.53,
    thinking: null,
  },
  {
    id: "kimi-k3",
    name: "Kimi-K3",
    context: 1_048_576,
    output: 1_048_576,
    image: true,
    video: true,
    rate: 1.35,
    thinking: KIMI_K3_THINKING,
  },
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    context: 1_000_000,
    output: 32_768,
    image: false,
    rate: 1.08,
    thinking: OFF_HIGH_MAX_DEFAULT_MAX,
  },
];

const knownModels = new Map(STATIC_MODELS.map((model) => [model.id, { ...model }]));

function isKimiK3Id(id) {
  const normalized = String(id ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "kimik3" || normalized === "kimik3youdaoinner";
}

export function normalizeThinking(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.options)) return null;
  const options = raw.options
    .filter(
      (option) =>
        option &&
        typeof option === "object" &&
        typeof option.level === "string" &&
        option.level.trim() &&
        typeof option.openclawLevel === "string" &&
        option.openclawLevel.trim(),
    )
    .map((option) => ({
      level: option.level.trim(),
      openclawLevel: option.openclawLevel.trim(),
    }));
  if (options.length === 0) return null;
  const defaultLevel =
    typeof raw.defaultLevel === "string" &&
    options.some((option) => option.level === raw.defaultLevel)
      ? raw.defaultLevel
      : options.find((option) => option.level !== "off")?.level ?? options[0].level;
  return { options, defaultLevel };
}

export function infoFromServerModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = firstString(raw.modelId, raw.id);
  if (!id) return null;
  const prior = knownModels.get(id) ?? {};
  const kimiK3 = isKimiK3Id(id);
  const options = Array.isArray(raw.contextWindowOptions)
    ? raw.contextWindowOptions.filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const largestOption = options.length ? Math.max(...options) : 0;
  const context = kimiK3
    ? 1_048_576
    : largestOption > 0
      ? largestOption
      : Number.isFinite(raw.contextWindow) && raw.contextWindow > 0
        ? raw.contextWindow
        : prior.context ?? 0;
  const output = kimiK3
    ? 1_048_576
    : Number.isFinite(raw.maxTokens) && raw.maxTokens > 0
      ? raw.maxTokens
      : prior.output ?? 32_768;
  const rate =
    typeof raw.costMultiplier === "number"
      ? raw.costMultiplier > 0
        ? raw.costMultiplier
        : undefined
      : prior.rate;
  const thinking =
    normalizeThinking(raw.thinkingConfig) ??
    prior.thinking ??
    (kimiK3 ? KIMI_K3_THINKING : null);
  const info = {
    ...prior,
    id,
    name: firstString(raw.modelName, raw.name, prior.name, id),
    context,
    output,
    image:
      kimiK3 ||
      (raw.supportsImage === true
        ? true
        : raw.supportsImage === false
          ? false
          : prior.image === true),
    video: kimiK3 || raw.supportsVideo === true || prior.video === true,
    reasoning:
      kimiK3 ||
      (raw.supportsThinking === true
        ? true
        : raw.supportsThinking === false
          ? false
          : prior.reasoning !== false),
    toolcall:
      raw.supportsToolCalling === true
        ? true
        : raw.supportsToolCalling === false
          ? false
          : prior.toolcall !== false,
    requestCapabilities: Array.isArray(raw.requestCapabilities)
      ? raw.requestCapabilities.filter((value) => typeof value === "string")
      : prior.requestCapabilities,
    rate: raw.limitedFreeActive === true ? undefined : rate,
    free: raw.limitedFreeActive === true,
    thinking,
    api: firstString(raw.apiFormat, raw.api, prior.api),
    description: firstString(raw.description, prior.description),
  };
  return info;
}

export function rememberServerModels(models) {
  for (const raw of models) {
    const info = infoFromServerModel(raw);
    if (info) {
      knownModels.set(info.id, { ...knownModels.get(info.id), ...info });
    }
  }
}

export function modelInfo(id) {
  const key = firstString(id);
  if (!key) return null;
  return knownModels.get(key) ?? null;
}

export function rememberModelInfo(info) {
  if (!info?.id) return;
  knownModels.set(info.id, { ...knownModels.get(info.id), ...info });
}

export function variantsFromThinking(thinking) {
  if (!thinking?.options?.length) return undefined;
  const variants = {};
  for (const option of thinking.options) {
    variants[option.level] =
      option.level === "off"
        ? { reasoningEffort: "none" }
        : { reasoningEffort: option.openclawLevel || option.level };
  }
  return variants;
}

export function magpieModel(info, base = {}) {
  if (!info) return { ...base };
  const image = info.image === true;
  const video = info.video === true;
  const input = ["text", ...(image ? ["image"] : []), ...(video ? ["video"] : [])];
  const variants = variantsFromThinking(info.thinking);
  const model = {
    ...base,
    name: info.name || info.id,
    limit: {
      context: Number.isFinite(info.context) ? info.context : 0,
      output: Number.isFinite(info.output) ? info.output : 0,
    },
    reasoning: info.reasoning !== false,
    tool_call: info.toolcall !== false,
    attachment: image,
    modalities: { input, output: ["text"] },
    capabilities: {
      temperature: true,
      reasoning: info.reasoning !== false,
      attachment: image,
      toolcall: info.toolcall !== false,
      input: {
        text: true,
        image,
        audio: false,
        video,
        pdf: false,
      },
      output: {
        text: true,
        image: false,
        audio: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
  };
  if (variants) model.variants = variants;
  if (typeof info.rate === "number" && info.rate > 0) model.rate = info.rate;
  if (info.free === true) model.free = true;
  if (info.description) model.description = info.description;
  if (info.api === "anthropic") {
    model.provider = { npm: ANTHROPIC_NPM, api: PROXY_BASE };
  } else if (
    info.api === "gemini" ||
    info.api === "google" ||
    info.api === "google-generative-ai"
  ) {
    model.provider = { npm: GOOGLE_NPM, api: PROXY_BASE };
  } else if (info.api === "openai" || !info.api) {
    // The provider-level NPM already points at the OpenAI-compatible endpoint.
    if (info.api === "openai") model.provider = { npm: NPM, api: PROXY_BASE };
  }
  return model;
}

export function staticConfigModels() {
  return Object.fromEntries(STATIC_MODELS.map((model) => [model.id, magpieModel(model)]));
}
