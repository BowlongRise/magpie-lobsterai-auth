export const PROVIDER = "lobsterai";
export const PROVIDER_NAME = "LobsterAI";

export const SERVER_BASE = "https://lobsterai-server.youdao.com";
export const PROXY_BASE = `${SERVER_BASE}/api/proxy/v1`;
export const LOGIN_FALLBACK_URL = "https://lobsterai.youdao.com/portal#/login";
export const LOGIN_URL_LOOKUP =
  "https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/login-url";
export const ICON_URL =
  "https://raw.githubusercontent.com/netease-youdao/LobsterAI/main/public/logo.png";

// LobsterAI 2026.11.13 is the client this plugin was checked against.
// The server uses these values for diagnostics and feature negotiation.
export const CLIENT_VERSION = "2026.11.13";
export const CLIENT_CAPABILITIES = [
  "kimi-k3-agentic-v1",
  "thinking-level-control-v1",
  "upstream-error-details-v1",
  "context-window-selection-v1",
].join(",");

export const CLIENT_CAPABILITIES_HEADER = "X-LobsterAI-Client-Capabilities";
export const CLIENT_VERSION_HEADER = "X-LobsterAI-Client-Version";
export const ENTERPRISE_MODE_HEADER = "X-LobsterAI-Account-Mode";
export const ENTERPRISE_ID_HEADER = "X-LobsterAI-Enterprise-Id";
export const KEYFROM = "magpie";
export const NPM = "@ai-sdk/openai-compatible";
export const ANTHROPIC_NPM = "@ai-sdk/anthropic";
export const GOOGLE_NPM = "@ai-sdk/google";

export const MAX_CONCURRENCY = 4;
export const ACCESS_LEAD_MS = 2 * 60 * 1000;
export const REFRESH_LEAD_MS = 5 * 60 * 1000;
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
export const LOGIN_URL_CACHE_MS = 10 * 60 * 1000;
export const ROTATED_TOKEN_TTL_MS = 60 * 1000;
export const MAX_SESSION_HEADER_LENGTH = 128;
