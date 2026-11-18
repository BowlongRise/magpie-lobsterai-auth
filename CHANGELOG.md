# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-11-18

### 新增

- 请求文本分两层规范化：固定改写已知会被服务端拒绝的句式；另一个插件选项 `hide_dsh`
  默认开启，从系统指令和工具描述里隐去 DeepSeek Harness 名称，可在 Magpie 里关闭。
- 聊天请求补齐桌面端的调用上下文：`traceparent`、`x-lobster-turn-id`、
  `x-lobster-user-message`（用户消息前 200 字符）、`sec-fetch-*`、`accept-language`、
  `priority`。

### 变更

- 客户端标识对齐实测的 LobsterAI 2026.11.16：客户端版本头、能力声明（新增
  `virtual-models-v1`）和 Windows 下的 User-Agent。

### 修复

- 积分卡片每行只显示服务端给的剩余额度，不再出现 `0 / 剩余` 这种假比例；到期日按北京时间计算。

### 文档

- README 增加提示：LobsterAI 明确要求不要通过第三方插件转接账号额度。

## [0.2.2] - 2026-11-17

### 文档

- README 按公开项目重写：徽章、环境要求、隐私说明和常见问题，中英文同步。
- 新增 `CHANGELOG.md`，补齐 0.1.0 以来的版本记录。

## [0.2.1] - 2026-11-17

### 修复

- 积分余额改为合计套餐池与活动赠送：同时读取 `/api/user/profile-summary` 的
  `totalCreditsRemaining` 和 `creditItems`，不再只显示 `/api/user/quota` 里的套餐池。
  账号卡片会按来源分行显示，并带上各自到期日。

## [0.2.0] - 2026-11-17

### 新增

- 实现 Magpie 的 `auth.checkin`：手动 `magpie accounts checkin` 或按天自动领取 LobsterAI
  的每日签到积分，返回本次到账积分、连续天数，以及活动时区次日 0 点的 `until`。

## [0.1.3] - 2026-11-16

### 文档

- 说明与 `magpie-providers-hub` 里 `hub-lobsterai` 渠道的差异。

## [0.1.2] - 2026-11-16

### 变更

- 扩充 npm keywords，改善在 Magpie 插件搜索里的命中率。

## [0.1.1] - 2026-11-16

### 变更

- 发布改为 GitHub Actions + npm Trusted Publishing（OIDC），不再需要 token 或验证码。
- README 简化安装步骤，发布流程移到 `CONTRIBUTING.md`。

## [0.1.0] - 2026-11-16

### 新增

- 首次发布：浏览器登录与回调、Token 手动登录、动态模型列表、`lobsterai_options`
  思考档位与 Kimi K3 请求契约、Token 自动续期、积分用量、多账号、企业账号请求头。

[0.3.0]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BowlongRise/magpie-lobsterai-auth/compare/v0.1.0...v0.1.1
[0.1.0]: https://www.npmjs.com/package/magpie-lobsterai-auth/v/0.1.0
