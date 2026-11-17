import fs from "node:fs";
import path from "node:path";

const CHANGELOG_PATH = path.resolve(process.cwd(), "CHANGELOG.md");
const API = "https://api.github.com";

/**
 * Reads CHANGELOG.md and returns one entry per "## [version] - date" section,
 * in file order, with the heading removed from the body.
 */
export function parseChangelog(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+\[([^\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      if (current) entries.push(current);
      current = { version: heading[1].trim(), date: heading[2], lines: [] };
      continue;
    }
    if (/^##\s/.test(line)) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) entries.push(current);
  return entries.map((entry) => {
    const body = [...entry.lines];
    while (body.length > 0 && (/^\s*$/.test(body[body.length - 1]) || /^\[[^\]]+\]:\s+\S+$/.test(body[body.length - 1]))) {
      body.pop();
    }
    return {
      version: entry.version,
      date: entry.date,
      body: body.join("\n").trim(),
    };
  });
}

function versionParts(version) {
  return String(version)
    .split("-")[0]
    .split(".")
    .map((part) => Number(part) || 0);
}

export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Builds the release body: the CHANGELOG section plus a compare link. */
export function releaseBody(entry, previousVersion, repository) {
  const parts = [entry.body.trim()];
  if (previousVersion && repository) {
    parts.push(
      `**完整改动**：https://github.com/${repository}/compare/v${previousVersion}...v${entry.version}`,
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

async function api(token, pathname, init = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "magpie-lobsterai-auth-release",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const onlyTag = (process.env.TAG ?? "").trim().replace(/^v/, "");

  if (!repository) throw new Error("GITHUB_REPOSITORY is not set");
  if (!token && !dryRun) throw new Error("GITHUB_TOKEN is not set");

  const entries = parseChangelog(fs.readFileSync(CHANGELOG_PATH, "utf8")).sort((a, b) =>
    compareVersions(a.version, b.version),
  );
  if (entries.length === 0) throw new Error("CHANGELOG.md has no version sections");

  let tags;
  let released;
  if (dryRun) {
    tags = entries.map((entry) => `v${entry.version}`);
    released = new Set();
  } else {
    tags = (await api(token, `/repos/${repository}/tags?per_page=100`)).map((tag) => tag.name);
    released = new Set(
      (await api(token, `/repos/${repository}/releases?per_page=100`)).map(
        (release) => release.tag_name,
      ),
    );
  }

  const known = new Set(tags);
  const newest = entries[entries.length - 1]?.version;
  const targets = entries.filter((entry) => {
    const tag = `v${entry.version}`;
    if (!known.has(tag)) return false;
    if (onlyTag && entry.version !== onlyTag) return false;
    return !released.has(tag);
  });

  if (targets.length === 0) {
    console.log("every tag already has a release");
    return;
  }

  for (const entry of targets) {
    const index = entries.findIndex((item) => item.version === entry.version);
    const previous = index > 0 ? entries[index - 1].version : undefined;
    const body = releaseBody(entry, previous, repository);
    if (dryRun) {
      console.log(`--- v${entry.version} (${entry.date})\n${body}\n`);
      continue;
    }
    await api(token, `/repos/${repository}/releases`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: `v${entry.version}`,
        name: `v${entry.version}`,
        body,
        draft: false,
        prerelease: false,
        make_latest: entry.version === newest ? "true" : "false",
      }),
    });
    console.log(`released v${entry.version}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("release.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
