# 03. Waffo Pancake 鏀粯瀵规帴鏂规

## 1. 闆嗘垚鍘熷垯

1. 鍓嶇鍜屾彃浠朵笉鐩存帴璋冪敤 Waffo 绉侀挜鎺ュ彛銆?2. `create-checkout-session` 鍙兘璧?Supabase Edge Function銆?3. 浼氬憳寮€閫氬彧浠?`waffo-webhook` 涓哄噯锛屼笉浠?success 椤典负鍑嗐€?4. webhook 蹇呴』淇濈暀 raw body銆侀獙绛俱€佹椂闂寸獥鏍￠獙銆佸幓閲嶅拰骞傜瓑銆?5. Test / Production 閰嶇疆涓ユ牸鍒嗙銆?
## 2. 濂楅鏄犲皠

鏈湴 `plans` 琛ㄩ渶瑕佷繚瀛橈細

| 瀛楁 | 璇存槑 |
|---|---|
| `product_key` | 鏈湴浜у搧 key |
| `plan_key` | 鏈湴濂楅 key |
| `waffo_product_id_test` | Waffo Test product ID |
| `waffo_product_id_prod` | Waffo Production product ID |
| `waffo_plan_id_test` | Waffo Test plan ID |
| `waffo_plan_id_prod` | Waffo Production plan ID |
| `waffo_price_id_test` | Waffo Test price ID |
| `waffo_price_id_prod` | Waffo Production price ID |

## 3. 鍒涘缓 checkout session

### 鍓嶇璇锋眰

```http
POST /functions/v1/create-checkout-session
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
  "productKey": "chatgpt2obsidian",
  "planKey": "pro_monthly",
  "installationId": "ins_...",
  "successUrl": "https://hwh.915500.xyz/checkout/success",
  "cancelUrl": "https://hwh.915500.xyz/checkout/cancel",
  "source": "web"
}
```

### 鏈嶅姟绔鐞?
1. 鏍￠獙 Supabase JWT銆?2. 鏌ヨ鏈湴 `products` / `plans`銆?3. 鍒涘缓鏈湴 `checkout_sessions` 璁板綍銆?4. 璋冪敤 Waffo 鍒涘缓 checkout session銆?5. 杩斿洖 `checkoutUrl`銆乣sessionId`銆乣expiresAt`銆?
### 蹇呭甫 metadata

```json
{
  "localCheckoutSessionId": "uuid",
  "localOrderId": "ord_20260421_xxx",
  "userId": "auth-user-uuid",
  "productKey": "chatgpt2obsidian",
  "planKey": "pro_monthly",
  "installationId": "ins_xxx",
  "source": "web",
  "environment": "test"
}
```

姝ゅ锛?
- 濡傛帴鍙ｆ敮鎸侊紝闄勫甫 `merchantProvidedBuyerIdentity = userId`銆?- 榛樿 `successUrl` 涓?`https://hwh.915500.xyz/checkout/success`銆?- 榛樿 `cancelUrl` 涓?`https://hwh.915500.xyz/checkout/cancel`銆?
## 4. webhook 澶勭悊

### 蹇呴』澶勭悊鐨勮姹?
1. 璇诲彇 raw body銆?2. 璇诲彇 `X-Waffo-Signature`銆?3. 楠岃瘉绛惧悕鍜屾椂闂寸獥銆?4. 鏍规嵁 payload `mode` 鍖哄垎 test / prod銆?5. 鎸?`mode + eventType + eventId` 鍘婚噸銆?6. 鐩存帴娑堣垂 webhook payload 鍐呯殑璁㈠崟銆佹敮浠樸€乵etadata銆乥uyer identity 瀛楁銆?7. 灏嗙粨鏋滃啓鍏ワ細
   - `orders`
   - `payments`
   - `entitlements`
   - `processed_webhooks`

### 鍏稿瀷浜嬩欢

- `order.completed`
- `subscription.activated`
- `subscription.payment_succeeded`
- `subscription.canceling`
- `subscription.uncanceled`
- `subscription.updated`
- `subscription.past_due`
- `subscription.canceled`
- `refund.succeeded`
- `refund.failed`

## 5. success 椤甸潰绾︽潫

`/checkout/success` 椤甸潰鍙仛涓変欢浜嬶細

1. 灞曠ず鈥滄敮浠樼粨鏋滅‘璁や腑鈥濄€?2. 杞 `get-entitlement`銆?3. 灞曠ず褰撳墠 entitlement 鐘舵€併€?
绂佹浜嬮」锛?
- 涓嶅厑璁告牴鎹?URL 鍙傛暟鐩存帴寮€浼氬憳銆?- 涓嶅厑璁告妸 success 椤甸潰瑙嗕负寮€閫氭垚鍔熶緷鎹€?- 涓嶅厑璁哥粫杩?webhook 鐩存帴鍐?`entitlements`銆?

