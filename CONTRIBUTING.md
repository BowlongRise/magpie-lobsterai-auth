# 贡献与发布

## 开发

```bash
git clone https://github.com/BowlongRise/magpie-lobsterai-auth.git
cd magpie-lobsterai-auth
magpie plugin add .
npm test
npm run check
```

- `index.mjs` 只放 Magpie 需要的 hook，认证、请求、模型、用量分别在 `lib/` 下。
- 测试用 `node:test`，网络请求全部 mock，不要在测试里写真实 token。
- 改模型映射时同步更新 `lib/catalog.mjs` 里的静态快照。

## 发布

### 手工发布

npm 账号需开启两项认证（Passkey 或安全密钥），发布时在浏览器确认：

```bash
npm publish
```

新包第一次发布会走 npm 的分阶段发布（staged publishing）：注册表先出现一个
`0.0.0-stage` 占位版本，真正的版本通常 1～2 分钟后自动放行。查版本要指定公共源，
否则会打到本机配置的私有源：

```bash
npm view magpie-lobsterai-auth version --registry=https://registry.npmjs.org/
```

### 自动发布（推荐）

`.github/workflows/publish.yml` 在推送 `v*` tag 时通过 GitHub Actions 的 OIDC
（Trusted Publishing）发布，不需要 token 或一次性验证码；版本已存在时自动跳过。

```bash
# 1. 改 package.json 的 version
# 2. 提交并打 tag
git commit -am "chore: release 0.1.1"
git tag v0.1.1
git push origin main --tags
```

首次使用需在 npm 包设置页配置一次 Trusted Publisher：

- Publisher：GitHub Actions
- Organization or user：`BowlongRise`
- Repository：`magpie-lobsterai-auth`
- Workflow filename：`publish.yml`
- Environment：留空

### GitHub Release

`.github/workflows/release.yml` 会在推送 `v*` tag 时，从 `CHANGELOG.md` 抽出对应段落建一个
Release，并附上上一版本到本版本的 compare 链接；已经存在的 Release 会跳过。

历史补建：在 Actions 里手动运行 `release`，`tag` 留空即可为所有缺 Release 的 tag 补齐。
本地可以先看会生成什么：

```bash
GITHUB_REPOSITORY=BowlongRise/magpie-lobsterai-auth node scripts/release.mjs --dry-run
```
