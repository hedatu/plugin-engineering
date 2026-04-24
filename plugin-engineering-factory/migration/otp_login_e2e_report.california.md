# California OTP Login E2E

- Generated at: `2026-04-22T21:14:46.1861567+08:00`
- Result: `verified`

## Flow

1. `SEND_OTP` to a fresh `mail.tm` mailbox
2. OTP email delivered successfully
3. `VERIFY_OTP` returned HTTP `200`
4. Supabase session created successfully
5. `get-entitlement` returned the LeadFill free plan with remaining quota
6. `register-installation` returned `registered=true`
7. `consume-usage` allowed 10 free fills
8. The 11th call returned `QUOTA_EXCEEDED`

## Notes

- California staging currently sends OTP through the temporary old-server SMTP relay
- Login email delivery is real and no longer blocked by the old `supabase-mail:2500` failure mode
