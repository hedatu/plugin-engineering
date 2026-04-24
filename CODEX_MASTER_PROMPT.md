# Codex Master Prompt：实现 Supabase + Cloudflare + Waffo 的插件会员系统

你是资深全栈工程师、Supabase 架构师、Chrome Extension MV3 工程师。请基于当前仓库实现一个“浏览器插件会员系统”，用于一个网站 + 一个 Chrome 插件，并保留后续扩展到多插件商城的能力。

## 一、总体目标

实现以下完整闭环：

1. 用户安装 Chrome 插件。
2. 用户通过邮箱 OTP 登录。
3. 用户在网站或插件中查看会员状态。
4. 用户点击升级，由服务端创建 Waffo Pancake checkout session。
5. 用户在 Waffo 托管结账页支付。
6. Waffo webhook 回调 Supabase Edge Function。
7. 服务端验签、去重、落库、开通会员。
8. 网站和插件刷新会员状态。
9. 插件执行功能前调用 `consume-usage` 校验并扣减额度。

## 二、部署分工

- Cloudflare Pages：托管网站前端
- Supabase：Auth、Postgres、Edge Functions、RLS
- Waffo Pancake：支付、托管结账、webhook
- Chrome Web Store：分发插件包

Chrome 插件的 popup / options / background / content scripts 属于扩展包，不托管在 Cloudflare Pages。

## 三、技术栈

- TypeScript
- React + Vite
- Tailwind CSS
- Supabase JS SDK
- Supabase Edge Functions（Deno）
- PostgreSQL SQL migration
- Chrome Extension Manifest V3

## 四、目录结构

```text
apps/web/
  src/
  public/
extensions/main-extension/
  manifest.json
  src/background/index.ts
  src/options/App.tsx
  src/popup/App.tsx
  src/content/index.ts
packages/extension-sdk/
  src/auth.ts
  src/entitlements.ts
  src/usage.ts
  src/types.ts
supabase/
  schema.sql
  functions/
    _shared/cors.ts
    create-checkout-session/index.ts
    waffo-webhook/index.ts
    get-entitlement/index.ts
    consume-usage/index.ts
    register-installation/index.ts
```

## 五、网站页面

必须实现：

- `/`
- `/pricing`
- `/login`
- `/account`
- `/checkout/success`
- `/checkout/cancel`
- `/privacy`
- `/terms`

网站功能：

- 邮箱 OTP 登录
- 定价页展示 `free` / `pro_monthly` / `lifetime`
- 点击套餐调用 `create-checkout-session`
- 用户中心展示当前套餐、权益状态、额度和订单信息
- `/checkout/success` 页面只轮询 `get-entitlement`
- success 页面不能直接开会员

## 六、Supabase 数据库

基于 `supabase/schema.sql` 实现数据库。

必须包含：

- `profiles`
- `products`
- `plans`
- `checkout_sessions`
- `orders`
- `payments`
- `subscriptions`
- `entitlements`
- `usage_counters`
- `installations`
- `webhook_events`
- `processed_webhooks`

要求：

- 开启 RLS
- products / plans 可公开读取 active 数据
- 用户只能读取自己的 profile / entitlements / usage / installations / orders
- billing / webhook / entitlements 写入只能由 service role 完成
- 实现原子扣减额度 SQL function

## 七、Supabase Edge Functions

### 1. `create-checkout-session`

- 必须校验 Supabase JWT
- 输入：`productKey`、`planKey`、`installationId`、`successUrl`、`cancelUrl`
- 只能由服务端创建 Waffo checkout
- metadata 至少包含：
  - `localCheckoutSessionId`
  - `localOrderId`
  - `userId`
  - `productKey`
  - `planKey`
  - `installationId`
  - `source`
  - `environment`
- 如果接口支持，附带 `merchantProvidedBuyerIdentity`

### 2. `waffo-webhook`

- 部署时允许 `--no-verify-jwt`
- 必须读取 raw body
- 必须验证 `X-Waffo-Signature`
- 使用 RSA-SHA256
- timestamp 超过 5 分钟拒绝
- 根据 payload `mode` 区分 test / prod
- 使用 `mode + eventType + eventId` 去重
- 支付成功后更新 `orders`、`payments`、`entitlements`、`processed_webhooks`

### 3. `get-entitlement`

- 必须校验 Supabase JWT
- 输入：`productKey`
- 返回当前套餐、功能、额度、使用量和订阅状态

### 4. `consume-usage`

- 必须校验 Supabase JWT
- 输入：`productKey`、`featureKey`、`amount`、`installationId`
- 检查 entitlement、feature、quota 并原子扣减

### 5. `register-installation`

- 必须校验 Supabase JWT
- 输入：`productKey`、`installationId`、`extensionId`、`browser`、`version`
- 根据套餐限制安装数

## 八、Chrome 插件

必须实现：

### options 页面

- 登录
- 显示当前用户
- 查询 entitlement
- 发起升级
- 管理账号

### popup 页面

- 展示会员状态
- 展示剩余额度
- 提供 `single_export` / `batch_export`

### background/service worker

- 保存和刷新 Supabase session
- 统一调用 Edge Functions
- 管理敏感 token
- content script 不直接持有 token

## 九、Waffo 对接要求

- 必须使用服务端创建 checkout session
- 不使用前端 Store Slug 直连模式
- Test / Production 完全隔离
- success 页面只轮询，不直接开会员
- 会员开通唯一依据是 webhook

## 十、环境变量

生成 `.env.example`，但不要提交任何真实值。

至少包括：

```text
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SITE_URL=https://hwh.915500.xyz
ALLOWED_ORIGINS=https://hwh.915500.xyz,https://pay.915500.xyz,chrome-extension://your-extension-id
WAFFO_ENV=test
WAFFO_MERCHANT_ID=
WAFFO_PRIVATE_KEY=
WAFFO_WEBHOOK_PUBLIC_KEY_TEST=
WAFFO_WEBHOOK_PUBLIC_KEY_PROD=
WAFFO_CHECKOUT_SUCCESS_URL=https://hwh.915500.xyz/checkout/success
WAFFO_CHECKOUT_CANCEL_URL=https://hwh.915500.xyz/checkout/cancel
```
