# California Staging DNS Instructions

- Generated at: `2026-04-22T21:14:46.1861567+08:00`
- Current status: `not_configured`
- Automatic DNS change in this turn: `false`

## Required A Records

- `ca-pay.915500.xyz -> 134.199.226.198`
- `ca-pay-api.915500.xyz -> 134.199.226.198`

## Why These Are Needed

- `ca-pay.915500.xyz` is the California staging pay-site hostname
- `ca-pay-api.915500.xyz` is the California staging Auth / Kong / Functions hostname
- Waffo webhook verification needs a real public HTTPS domain and cannot rely on local `hosts` overrides

## What Is Already Ready

- Caddy is configured on California for both staging hostnames
- Internal TLS is enabled for local validation now
- Local `curl --resolve ... -k` tests already work against California

## What Still Blocks Public Webhook E2E

- No public DNS record exists yet for `ca-pay.915500.xyz`
- No public DNS record exists yet for `ca-pay-api.915500.xyz`
- Waffo webhook should not be pointed to California until these hostnames resolve publicly
