# HWH Product Config Checklist

Use this before any public commercial launch.

## Product setup

- [ ] Create `productKey=leadfill-one-profile`
- [ ] Create `planKey=lifetime`
- [ ] Configure `$19 lifetime` as a one-time price
- [ ] Map the plan to the Waffo product
- [ ] Configure `successUrl`
- [ ] Configure `cancelUrl`
- [ ] Configure `webhookUrl`
- [ ] Configure `featureKey=leadfill_fill_action`
- [ ] Configure free quota `10`
- [ ] Configure `max_installations`
- [ ] Configure Pro entitlement features
- [ ] Configure support email

## Validation

- [ ] Test email OTP after SMTP is fixed
- [ ] Test `create-checkout-session`
- [ ] Test webhook delivery
- [ ] Test `get-entitlement` active state
- [ ] Test `consume-usage`
- [ ] Confirm success page does not unlock locally

## Legacy warning

- `chatgpt2obsidian` is legacy test-only and must not remain the LeadFill production key.
- The extension must not ship service-role keys, private merchant keys, or webhook secrets.
