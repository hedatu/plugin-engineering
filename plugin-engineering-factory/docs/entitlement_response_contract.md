# Entitlement Response Contract

## Required Fields

```json
{
  "status": "active",
  "plan": "lifetime",
  "product_id": "page-context-to-markdown",
  "license_id": "lic_123",
  "features": ["unlimited_usage"],
  "free_limit": {
    "amount": 10,
    "unit": "actions",
    "scope": "lifetime"
  },
  "usage_remaining": null,
  "expires_at": null,
  "verified_at": "2026-04-21T00:00:00.000Z",
  "message": "License is active."
}
```

## Status Values
- `active`
- `free`
- `invalid`
- `expired`
- `revoked`
- `trial`

## Plan Values
- `free`
- `lifetime`
- `pro`

## Behavior Rules
- `status=free` means the extension must stay on the free tier.
- `status=active` with `plan=lifetime|pro` unlocks paid features.
- `status=invalid|expired|revoked` must not unlock Pro features.
- `usage_remaining` is optional for paid plans, but should be set for free and trial plans when relevant.
- `verified_at` should always reflect the server-side verification timestamp.
