# Staging Domain Plan

## Goal
Test the California environment before production DNS cutover.

## Option 1: Temporary Public Subdomains
- `ca-pay.915500.xyz`
- `ca-pay-api.915500.xyz`

### Pros
- Publicly routable, so Waffo webhook tests can target a real reachable domain.
- Does not require editing local hosts files on every operator machine.
- Lets OTP emails and webhook payloads exercise a realistic production-like URL shape.

### Cons
- Requires adding temporary DNS records.
- Requires temporary TLS issuance for the staging subdomains.

## Option 2: Local Hosts Override
- Map `pay.915500.xyz` and `pay-api.915500.xyz` to the California IP in local hosts files.

### Pros
- No public DNS change required.
- Useful for operator-only browser checks.

### Cons
- Not suitable for third-party callbacks that need public reachability.
- Waffo webhook testing is weaker or impossible if the provider must reach the endpoint over the public Internet.
- Operator-specific and easy to misconfigure.

## Recommended Option
- Prefer temporary public subdomains.
- Reason: Waffo webhook verification is a required gate and works better with a real public test endpoint.
- Do not point the production domains at California until the cutover gate passes and the user approves.
- This bootstrap round did not change DNS and did not request production certificates.
