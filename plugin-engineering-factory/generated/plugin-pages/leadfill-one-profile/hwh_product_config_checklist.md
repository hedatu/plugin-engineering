# HWH Product Config Checklist

Product: LeadFill One Profile
Product key target: leadfill-one-profile
Current pay-site product key: leadfill-one-profile
Target plan key: lifetime
Current configured plan key: lifetime
Price: $19 lifetime

- [ ] Create HWH productKey=leadfill-one-profile
- [ ] Create HWH planKey=lifetime
- [ ] Configure $19 lifetime as a one-time price
- [ ] Map the plan to the Waffo product and checkout
- [ ] Configure successUrl=https://pay.915500.xyz/checkout/success
- [ ] Configure cancelUrl=https://pay.915500.xyz/checkout/cancel
- [ ] Configure webhookUrl for entitlement updates
- [ ] Configure featureKey=leadfill_fill_action
- [ ] Configure free quota=10
- [ ] Configure max_installations
- [ ] Configure active entitlement feature set for Pro
- [ ] Configure support email and support route
- [ ] Test email OTP login once SMTP is fixed
- [ ] Test create-checkout-session
- [ ] Test Waffo webhook delivery
- [ ] Test get-entitlement active state
- [ ] Test consume-usage quota behavior

Notes:

- Legacy test-only product keys must not remain the production key for LeadFill.
- The extension must never ship service-role keys, private merchant keys, or webhook secrets.
- successUrl is not allowed to unlock the extension locally.
