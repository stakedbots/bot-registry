# x-publish

Posts the launch thread to **@stakedbots** on X. Thread copy lives in
`thread.mjs`; images in `media/`.

## Credentials

Read at runtime from Proton Pass (vault `Claude`, item **`X API stakedbots`**) —
nothing secret is committed:

| Proton field | Value                                   |
|--------------|-----------------------------------------|
| `username`   | API Key (OAuth 1.0a consumer key)       |
| `password`   | API Secret (consumer secret)            |
| `note`       | two lines: `ACCESS_TOKEN=…` / `ACCESS_TOKEN_SECRET=…` |

The X app must have **Read and Write** permission; the Access Token must be
regenerated *after* setting that, or it won't carry write scope.

## Usage

```bash
cd scripts/x-publish
npm install                 # twitter-api-v2 + twitter-text (gitignored)

node publish.mjs --dry-run    # validate creds + char counts, post nothing
node publish.mjs --first-only # post only tweet 1 (smoke test)
node publish.mjs              # post the full 7-tweet thread
```

`--dry-run` calls `v2.me()` so it also confirms the token authenticates and the
handle is correct before any live post.
