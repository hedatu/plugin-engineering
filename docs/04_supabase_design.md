# 04. Supabase 对接细节

## 1. Supabase 的职责

Supabase 在本项目中承担后端底座：

- Auth：邮箱 OTP 登录。
- Postgres：产品、套餐、订单、会员、额度、安装记录。
- Edge Functions：支付会话创建、Webhook、权益查询、额度扣减。
- Storage：可选，用于保存导出文件、头像、日志附件。
- RLS：限制用户只能读取自己的数据。

## 2. Auth 设计

### 登录方式

第一版使用邮箱 OTP：

- 网站登录：`supabase.auth.signInWithOtp({ email })`
- 插件登录：同样使用 OTP，或者打开网站登录页。
- 验证：`supabase.auth.verifyOtp({ email, token, type: 'email' })`

### 插件 session 存储

- access token：由 background/service worker 持有。
- refresh token：存 `chrome.storage.local`，刷新时由 background 使用。
- content script：不直接接触 token，只通过 message passing 请求 background。

### profiles 同步

触发器：当 `auth.users` 新增用户时，自动插入 `public.profiles`。

## 3. 数据库核心表

详见 `supabase/schema.sql`。

核心表：

| 表 | 作用 |
|---|---|
| `profiles` | 用户资料，与 `auth.users` 对应 |
| `products` | 插件产品，例如 chatgpt2obsidian |
| `plans` | 套餐配置，含 feature flags 和 quotas |
| `checkout_sessions` | 本地结账会话记录 |
| `orders` | Waffo 订单 |
| `payments` | 支付记录 |
| `subscriptions` | 订阅状态 |
| `entitlements` | 用户对某产品的权益 |
| `usage_counters` | 每日/月度额度使用 |
| `installations` | 插件安装设备记录 |
| `webhook_events` | Webhook 原始事件与处理状态 |
| `admin_audit_logs` | 管理动作审计，可后续启用 |

## 4. Edge Functions

### 4.1 `create-checkout-session`

- JWT：需要。
- 用途：创建 Waffo 托管结账会话。
- 输入：`productKey`, `planKey`, `installationId`, `successUrl`。
- 输出：`checkoutUrl`, `sessionId`, `expiresAt`。
- 安全：使用 service role 查询和写入订单表；Waffo 私钥只存在环境变量。

### 4.2 `waffo-webhook`

- JWT：不要用 Supabase JWT 校验，但必须手动验证 Waffo 签名。
- 部署时可使用 `--no-verify-jwt`。
- 用途：接收 Waffo 的订单/订阅/退款事件。
- 输入：原始 JSON body + `X-Waffo-Signature`。
- 输出：尽快返回 200。
- 安全：RSA-SHA256 验签，timestamp 5 分钟容忍，event 去重。

### 4.3 `get-entitlement`

- JWT：需要。
- 用途：网站/插件读取当前会员状态。
- 输入：`productKey`。
- 输出：user、product、plan、status、features、quotas、usage、subscription。

### 4.4 `consume-usage`

- JWT：需要。
- 用途：执行插件功能前扣减额度。
- 输入：`productKey`, `featureKey`, `amount=1`, `installationId`。
- 输出：allowed、remaining、errorCode。
- 要求：原子扣减，不能并发超用。

### 4.5 `register-installation`

- JWT：需要。
- 用途：绑定插件安装记录，限制安装数量。
- 输入：`productKey`, `installationId`, `extensionId`, `browser`, `version`。
- 输出：registered、maxInstallations、currentInstallations。

## 5. RLS 策略

### 可公开读

- `products`：只读 active 产品。
- `plans`：只读 active 且 public 的套餐。

### 用户可读自己的

- `profiles`：只能读/改自己的 profile。
- `entitlements`：只能读自己的权益。
- `usage_counters`：只能读自己的使用量。
- `installations`：只能读自己的安装记录。
- `orders/payments/subscriptions`：可读自己的账单摘要，敏感字段可隐藏。

### 只能 service role 写

- `orders`
- `payments`
- `subscriptions`
- `entitlements`
- `webhook_events`
- 任何 `status` 变更

## 6. 环境变量

见 `.env.example`。

生产环境至少需要：

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WAFFO_MERCHANT_ID=
WAFFO_PRIVATE_KEY=
WAFFO_WEBHOOK_PUBLIC_KEY_TEST=
WAFFO_WEBHOOK_PUBLIC_KEY_PROD=
WAFFO_ENV=production
SITE_URL=https://yourproduct.com
ALLOWED_ORIGINS=https://yourproduct.com,chrome-extension://<extension-id>
```

## 7. 本地开发建议

1. 使用 Supabase CLI 启动本地数据库。
2. 执行 `schema.sql`。
3. 用 Waffo Test 模式。
4. 本地 webhook 用 ngrok 暴露。
5. 插件开发用 unpacked extension。
6. 开发时使用 test product ID，不要混用 production product ID。

## 8. 多插件扩展方式

新增一个插件时只需要：

1. 在 `products` 新增一条：
   - `product_key = 'youtube-comment-collector'`
2. 在 `plans` 新增对应套餐。
3. 在 Waffo 创建对应商品。
4. 在插件配置里写：
   - `PRODUCT_KEY='youtube-comment-collector'`
5. 复用相同的 Edge Functions。

不要为每个插件复制一套数据库和支付回调。

