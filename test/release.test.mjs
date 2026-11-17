import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, parseChangelog, releaseBody } from "../scripts/release.mjs";

const changelog = `# 更新日志

格式参考 Keep a Changelog。

## [0.2.2] - 2026-11-17

### 文档

- README 按公开项目重写。

## [0.2.1] - 2026-11-17

### 修复

- 积分余额改为合计套餐池与活动赠送。

[0.2.1]: https://example.com/compare
`;

test("the changelog yields one entry per version, newest first", () => {
  const entries = parseChangelog(changelog);
  assert.deepEqual(
    entries.map((entry) => entry.version),
    ["0.2.2", "0.2.1"],
  );
  assert.equal(entries[0].date, "2026-11-17");
  assert.match(entries[0].body, /^- README 按公开项目重写。$/m);
  assert.doesNotMatch(entries[0].body, /## \[0\.2\.2\]/);
});

test("trailing link definitions stay out of the release body", () => {
  const entries = parseChangelog(changelog);
  const last = entries[entries.length - 1];
  assert.match(last.body, /积分余额/);
  assert.doesNotMatch(last.body, /\[0\.2\.1\]: https:\/\/example\.com\/compare/);
});

test("versions sort numerically, not as strings", () => {
  const sorted = ["0.1.10", "0.2.1", "0.1.9"].sort(compareVersions);
  assert.deepEqual(sorted, ["0.1.9", "0.1.10", "0.2.1"]);
});

test("a release body carries the section and the compare link", () => {
  const [entry] = parseChangelog(changelog);
  const body = releaseBody(entry, "0.2.1", "BowlongRise/magpie-lobsterai-auth");
  assert.match(body, /README 按公开项目重写/);
  assert.match(
    body,
    /\*\*完整改动\*\*：https:\/\/github\.com\/BowlongRise\/magpie-lobsterai-auth\/compare\/v0\.2\.1\.\.\.v0\.2\.2/,
  );
});
