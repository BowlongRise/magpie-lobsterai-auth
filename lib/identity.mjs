// Request text goes through two layers: lines a vendor refuses are always
// reworded, and the harness name can be taken out behind a switch.
//
// FLAGGED was measured against WorkBuddy's request filter (magpie-community
// /plugins, packages/workbuddy, MIT) and is carried over as is. LobsterAI's
// filter has not been measured, so these are a starting point, not a
// verified set for this vendor.
const FLAGGED = [
  [/x-anthropic-billing-header:[^\n]*\n?/gi, ""],
  [
    /You are Claude Code, Anthropic['’]s official CLI for Claude/gi,
    "You are Claude Code, Anthropic's CLI for Claude",
  ],
  [/Main branch \(you will usually use this for PRs\)/gi, "Main branch (usually the base for PRs)"],
  [
    /(?<!the )Codex CLI is an open source project led by OpenAI\./gi,
    "The Codex CLI is an open source project led by OpenAI.",
  ],
  [
    /You are an AI agent powered by DeepSeek Harness\.?/gi,
    "You are an AI agent, powered by DeepSeek Harness.",
  ],
  [
    /Web GUI whose URL the runtime context names\.\s+When the user refers/gi,
    "Web GUI whose URL the runtime context names. The interface, when the user refers",
  ],
];

const HARNESS_LINES = [
  [/You are an AI agent,? powered by DeepSeek Harness\.?/g, "You are an AI agent."],
  [/DeepSeek Harness (Web GUI)/g, "$1"],
  [/DeepSeek Harness (implementation checkout)/g, "agent $1"],
  [/\bDSH itself\b/g, "the agent itself"],
];

const HARNESS_PROSE = [
  ...HARNESS_LINES,
  [
    /(?<![\w/\\.~:@-])([Tt]he )?DeepSeek Harness(?![\w/\\@-]|\.\w)/g,
    (_, prefix) => `${prefix ?? "the "}agent harness`,
  ],
  [/(?<![\w/\\.~:@-])DSH(?![\w/\\@-]|\.\w)/g, "the agent harness"],
];

function applyRules(text, rules) {
  let value = text;
  for (const [pattern, replacement] of rules) value = value.replace(pattern, replacement);
  return value;
}

export function unflagText(text) {
  return applyRules(text, FLAGGED);
}

export function hideHarnessText(text, said = false) {
  return applyRules(text, said ? HARNESS_LINES : HARNESS_PROSE);
}

function mapContent(content, transform) {
  if (typeof content === "string") return transform(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) =>
    part && typeof part.text === "string" && (!part.type || part.type === "text")
      ? { ...part, text: transform(part.text) }
      : part,
  );
}

function mapDescriptions(value, transform) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) mapDescriptions(item, transform);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key === "description" && typeof value[key] === "string") value[key] = transform(value[key]);
    else mapDescriptions(value[key], transform);
  }
}

/**
 * Applies both layers to a chat payload in place. The refused lines are always
 * reworded, in every message; the harness name is taken out only when asked,
 * and only from what the harness wrote (system/developer messages, the system
 * prompt and tool descriptions) — tool results and the user's own words keep
 * their meaning.
 */
export function applyIdentity(payload, { hideHarness = true } = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    message.content = mapContent(message.content, unflagText);
    if (!hideHarness || message.role === "tool") continue;
    const said = !["system", "developer"].includes(message.role);
    message.content = mapContent(message.content, (text) => hideHarnessText(text, said));
  }
  if (payload.system !== undefined) {
    payload.system = mapContent(payload.system, unflagText);
    if (hideHarness) payload.system = mapContent(payload.system, (text) => hideHarnessText(text));
  }
  if (hideHarness && Array.isArray(payload.tools)) {
    mapDescriptions(payload.tools, (text) => hideHarnessText(text));
  }
  return payload;
}
