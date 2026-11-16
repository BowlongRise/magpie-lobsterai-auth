# magpie-lobsterai-auth

An **unofficial** Magpie / OpenCode provider plugin for **NetEase Youdao LobsterAI**
(有道龙虾).

Provider id: `lobsterai`. After sign-in, models appear as `lobsterai/<model>`.

## Features

- Browser sign-in through LobsterAI's own login page and a one-shot loopback callback.
- Manual access/refresh token sign-in as a fallback.
- Live account model catalog from `GET /api/models/available`.
- LobsterAI `lobsterai_options` thinking levels, including the Kimi K3 contract.
- JWT-aware token renewal through `auth.refresh`.
- Credit usage from `GET /api/user/quota`.
- Multiple accounts through Magpie's account scope.
- Enterprise context headers when the sign-in response names an enterprise.

## Install

```bash
magpie plugin add magpie-lobsterai-auth
```

Or install straight from GitHub, without npm:

```bash
magpie plugin add github:BowlongRise/magpie-lobsterai-auth
```

```bash
magpie plugin login lobsterai
magpie provider test lobsterai
magpie quota
```

## Endpoints

```text
https://lobsterai-server.youdao.com/api/proxy/v1/chat/completions
```

Requests carry the account's Bearer token, LobsterAI client headers and
`x-lobster-session-id`.

## Notes

- Not affiliated with NetEase Youdao.
- LobsterAI's model API is not a documented public API and may change.
- Tokens are stored by Magpie in `plugin-auth.json`; the plugin never reads the
  LobsterAI desktop app's database, cookies or credential files.
- LobsterAI's `yd-fast` / `yd-ultra` entries are server-side virtual presets
  that must be resolved per session, so this plugin lists real models only.

## Development

```bash
git clone https://github.com/BowlongRise/magpie-lobsterai-auth.git
magpie plugin add ./magpie-lobsterai-auth
npm test
npm run check
```

See [CONTRIBUTING.md](https://github.com/BowlongRise/magpie-lobsterai-auth/blob/main/CONTRIBUTING.md)
for the release process.

## License

MIT.
