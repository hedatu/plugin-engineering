# Chrome 插件支付站对接说明

本文给插件项目组直接使用。内容只基于当前仓库已经落地的实现，不包含未上线假设。

## 1. 当前线上地址

- 前端站点：`https://pay.915500.xyz`
- API / Supabase Gateway：`https://pay-api.915500.xyz`
- Waffo successUrl：`https://pay.915500.xyz/checkout/success`
- Waffo cancelUrl：`https://pay.915500.xyz/checkout/cancel`
- Waffo webhookUrl：`https://pay-api.915500.xyz/functions/v1/waffo-webhook`

## 2. 插件侧必须遵守的安全边界

- Chrome 插件只能使用 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_ANON_KEY`。
- 插件绝对不能持有：
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WAFFO_PRIVATE_KEY`
  - 任意 Waffo merchant secret
- token 只能保存在 `background/service worker`。
- `content script` 不直接持有 access token / refresh token。
- 会员开通必须以 Waffo webhook 为准。
- `success` 页面不能作为开会员依据。

## 3. 当前产品参数

- `productKey=chatgpt2obsidian`
- 测试一次性套餐：
  - `planKey=one_time_test`
  - `billingType=onetime`
- 终身套餐：
  - `planKey=lifetime`
  - 当前也是走 Waffo test onetime 商品映射

## 4. 插件构建期环境变量

插件侧当前读取这些变量：

```env
SITE_URL=https://pay.915500.xyz
PUBLIC_SUPABASE_URL=https://pay-api.915500.xyz
PUBLIC_SUPABASE_ANON_KEY=<anon-key>
PRODUCT_KEY=chatgpt2obsidian
CHROME_EXTENSION_ID=<your-extension-id>
```

对应代码位置：

- `extensions/main-extension/src/config.ts`

## 5. 当前已实现的插件运行架构

当前扩展骨架已经按下面方式实现：

- `background/index.ts`
  - 保存 session
  - 刷新 session
  - 调用 Edge Functions
  - 缓存 entitlement
  - 生成和保存 `installationId`
- `popup` / `options`
  - 通过 `chrome.runtime.sendMessage(...)` 调 background
- `content`
  - 不直接请求 Supabase，不直接保存敏感 token

当前 session 存储：

- `chrome.storage.local`
  - `membership.installationId`
  - `membership.session`
  - `membership.entitlement.<productKey>`

## 6. 当前 runtime message 协议

当前插件与 background 的消息协议已在 `packages/extension-sdk/src/types.ts` 中固定。

### 6.1 请求类型

```ts
type ExtensionMessageRequest =
  | { type: 'GET_AUTH_STATE' }
  | { type: 'SEND_OTP'; email: string }
  | { type: 'VERIFY_OTP'; email: string; token: string }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_ENTITLEMENT'; productKey: string }
  | { type: 'REGISTER_INSTALLATION'; productKey: string; installationId: string; extensionId?: string; browser?: string; version?: string }
  | { type: 'CREATE_CHECKOUT'; productKey: string; planKey: string; installationId?: string; successUrl?: string; cancelUrl?: string }
  | { type: 'CONSUME_USAGE'; productKey: string; featureKey: string; amount?: number; installationId?: string }
```

### 6.2 通用响应

```ts
type ExtensionMessageResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}
```

### 6.3 关键返回结构

```ts
type SessionSnapshot = {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: { id: string; email: string | null }
}

type CheckoutSessionResponse = {
  checkoutUrl: string
  sessionId: string
  localOrderId: string
}

type InstallationResponse = {
  registered: boolean
  errorCode?: string
  currentInstallations?: number
  maxInstallations?: number
}

type ConsumeUsageResponse = {
  allowed: boolean
  errorCode?: string
  used?: number
  limit?: number
  remaining?: number
  planKey?: string
}
```

## 7. 插件应如何接入

### 7.1 登录

插件当前设计就是邮箱 OTP：

1. UI 发送：

```ts
chrome.runtime.sendMessage({ type: 'SEND_OTP', email })
```

2. 用户收到邮箱验证码后，再发送：

```ts
chrome.runtime.sendMessage({ type: 'VERIFY_OTP', email, token })
```

3. background 保存 session。

注意：

- 这一步当前线上还存在 blocker。
- self-hosted Supabase Auth 的 SMTP 仍在修复中。
- 所以“真实邮箱收到 OTP 并登录成功”目前是未验证。

### 7.2 刷新会员状态

登录后调用：

```ts
chrome.runtime.sendMessage({
  type: 'REFRESH_ENTITLEMENT',
  productKey: 'chatgpt2obsidian',
})
```

后台会调用：

- `POST /functions/v1/get-entitlement`

要求：

- 必须带用户 JWT
- 必须带 `apikey`

当前函数返回：

- 当前用户
- 当前 product
- 当前 plan
- entitlement 状态
- features
- quotas
- usage
- subscription 摘要
- 最近订单列表

### 7.3 注册安装实例

登录且拿到 entitlement 后，插件应立即绑定一次安装实例：

```ts
chrome.runtime.sendMessage({
  type: 'REGISTER_INSTALLATION',
  productKey: 'chatgpt2obsidian',
  installationId,
  extensionId: chrome.runtime.id,
  browser: 'chrome',
  version: chrome.runtime.getManifest().version,
})
```

服务端会校验：

- 当前用户对该 product 的有效权益
- 当前激活安装数是否超过 `max_installations`

超限时会返回：

- `registered: false`
- `errorCode: 'MAX_INSTALLATIONS_EXCEEDED'`

### 7.4 创建支付链接

插件升级按钮应调用：

```ts
chrome.runtime.sendMessage({
  type: 'CREATE_CHECKOUT',
  productKey: 'chatgpt2obsidian',
  planKey: 'one_time_test',
})
```

background 会请求：

- `POST /functions/v1/create-checkout-session`

该函数必须要求 JWT，匿名调用当前已验证会返回：

- `401 LOGIN_REQUIRED`

服务端会自动写入并透传这些 metadata：

- `userId`
- `productKey`
- `planKey`
- `localOrderId`
- `source`
- `installationId`

当前 `source` 固定写为：

- `chrome_extension`

成功返回：

```json
{
  "checkoutUrl": "<waffo checkout url>",
  "sessionId": "<waffo session id>",
  "localOrderId": "<local order id>"
}
```

插件拿到 `checkoutUrl` 后只负责：

- 在新标签页打开 Waffo 支付页

插件不要做：

- 不要自己判定支付成功
- 不要根据跳转到 `successUrl` 就本地开通

### 7.5 支付成功后的正确动作

正确链路是：

1. 用户完成 Waffo 支付
2. Waffo 调用 webhook
3. `waffo-webhook` 验签通过后更新：
   - `processed_webhooks`
   - `webhook_events`
   - `orders`
   - `payments`
   - `entitlements`
4. 插件或前端 success 页面再轮询 `get-entitlement`
5. entitlement 变为 `active` 后，插件再解锁功能

## 8. 当前 Edge Function 接口约定

### 8.1 `get-entitlement`

- 路径：`POST https://pay-api.915500.xyz/functions/v1/get-entitlement`
- 认证：需要 JWT
- body：

```json
{
  "productKey": "chatgpt2obsidian"
}
```

- 常见错误：
  - `401 LOGIN_REQUIRED`
  - `400 MISSING_PRODUCT_KEY`
  - `404 PRODUCT_NOT_FOUND`

### 8.2 `register-installation`

- 路径：`POST https://pay-api.915500.xyz/functions/v1/register-installation`
- 认证：需要 JWT
- body：

```json
{
  "productKey": "chatgpt2obsidian",
  "installationId": "<uuid>",
  "extensionId": "<chrome-extension-id>",
  "browser": "chrome",
  "version": "1.0.0"
}
```

- 常见结果：
  - `200 registered=true`
  - `403 MAX_INSTALLATIONS_EXCEEDED`
  - `401 LOGIN_REQUIRED`

### 8.3 `consume-usage`

- 路径：`POST https://pay-api.915500.xyz/functions/v1/consume-usage`
- 认证：需要 JWT
- body：

```json
{
  "productKey": "chatgpt2obsidian",
  "featureKey": "batch_export",
  "amount": 1,
  "installationId": "<uuid>"
}
```

- 常见错误：
  - `401 LOGIN_REQUIRED`
  - `403 INSTALLATION_NOT_REGISTERED`
  - `403 FEATURE_NOT_ENABLED`
  - `429 QUOTA_EXCEEDED`

返回的 `allowed=false` 时，插件必须阻止本地功能执行。

### 8.4 `create-checkout-session`

- 路径：`POST https://pay-api.915500.xyz/functions/v1/create-checkout-session`
- 认证：需要 JWT
- body：

```json
{
  "productKey": "chatgpt2obsidian",
  "planKey": "one_time_test",
  "installationId": "<uuid>",
  "source": "chrome_extension"
}
```

- 常见错误：
  - `401 LOGIN_REQUIRED`
  - `404 PLAN_NOT_FOUND`
  - `400 FREE_PLAN_NOT_PURCHASABLE`
  - `500 WAFFO_PRODUCT_ID_NOT_CONFIGURED`
  - `502 WAFFO_CREATE_SESSION_FAILED`

## 9. 插件升级按钮的推荐实现

推荐按钮逻辑：

1. 未登录：
   - 先引导用户 OTP 登录
2. 已登录但 entitlement 不是 `active`：
   - 允许点击 Upgrade
   - 调 `CREATE_CHECKOUT`
   - 打开返回的 `checkoutUrl`
3. 支付完成后：
   - 回到插件
   - 调 `REFRESH_ENTITLEMENT`
4. 如果 entitlement 已变成 `active`：
   - 再显示高级功能

示例：

```ts
const result = await chrome.runtime.sendMessage({
  type: 'CREATE_CHECKOUT',
  productKey: 'chatgpt2obsidian',
  planKey: 'one_time_test',
})

if (!result.ok) {
  if (result.error === 'LOGIN_REQUIRED') {
    openLogin()
    return
  }

  showError(result.error ?? 'CREATE_CHECKOUT_FAILED')
  return
}

window.open(result.data.checkoutUrl, '_blank', 'noopener,noreferrer')
```

## 10. 当前状态给插件组的明确说明

### 已完成

- 支付站已上线：`https://pay.915500.xyz`
- API / webhook 已上线：`https://pay-api.915500.xyz`
- 自建 Supabase gateway 已恢复
- `waffo-webhook` 已部署
- 无签名 webhook 会返回 `401 INVALID_SIGNATURE`
- 匿名调用 `create-checkout-session` 会返回 `401 LOGIN_REQUIRED`
- 插件 background 已具备：
  - OTP 登录消息
  - entitlement 查询
  - installation 注册
  - checkout 创建
  - usage 扣减

### 未验证

- 真实 OTP 邮件送达
- 真实前端 / 插件登录完成
- 真实 `create-checkout-session` 成功拿到 Waffo checkoutUrl
- 真实 Waffo Test webhook 入站
- 真实支付后 entitlement 变为 `active`

### 当前 blocker

- self-hosted Supabase Auth 的 SMTP 还未切换到真实可达配置
- 所以插件组当前可以先对接消息协议和 UI 流程
- 但“真实登录 -> 真实支付 -> webhook 开会员”的完整闭环还不能宣称已验证

## 11. 插件组实施建议

- 先直接复用当前 `background/index.ts` 的消息分发模式。
- 所有与 Supabase / Edge Functions 的通信统一走 background。
- content script 只向 background 发消息，不直接发 API 请求。
- Upgrade 按钮直接调用 `CREATE_CHECKOUT`，不要在 content script 内拼 API。
- 支付成功后只刷新 entitlement，不要本地写死“已开通”。
- 额度功能必须在真正执行前调用 `CONSUME_USAGE`。

## 12. 对接负责人需要知道的文件

- 插件配置：`extensions/main-extension/src/config.ts`
- 插件后台：`extensions/main-extension/src/background/index.ts`
- 插件消息工具：`extensions/main-extension/src/shared/runtime.ts`
- 消息类型：`packages/extension-sdk/src/types.ts`
- 设计说明：`docs/05_chrome_extension_design.md`
- 支付创建：`supabase/functions/create-checkout-session/index.ts`
- 权益查询：`supabase/functions/get-entitlement/index.ts`
- 安装绑定：`supabase/functions/register-installation/index.ts`
- 额度扣减：`supabase/functions/consume-usage/index.ts`
- Webhook：`supabase/functions/waffo-webhook/index.ts`
