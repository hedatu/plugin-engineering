# 01. PRD：浏览器插件会员系统

## 1. 产品定位

建立一个可复用的“浏览器插件会员底座”：

- 一个网站对应一个插件产品。
- 多个插件后续可以共享同一套会员、授权、支付和额度体系。
- 用户通过邮箱 OTP 登录。
- 支持 Waffo Pancake 托管支付。
- 支持 Chrome 插件按会员状态开放或限制功能。

## 2. MVP 范围

### 网站页面

- `/`
- `/pricing`
- `/login`
- `/account`
- `/checkout/success`
- `/checkout/cancel`
- `/privacy`
- `/terms`

### Supabase

- 邮箱 OTP 登录
- 产品、套餐、订单、订阅、权益、使用量、安装记录
- Edge Functions
  - `create-checkout-session`
  - `waffo-webhook`
  - `get-entitlement`
  - `consume-usage`
  - `register-installation`

### 支付

- Waffo 托管结账页
- 一次性 lifetime
- 月付订阅
- 以 webhook 为准自动开通或撤销权益

### Chrome 插件

- options 页面登录
- popup 页面展示会员状态
- 执行功能前由服务端扣减额度
- batch 功能仅限 `pro` / `lifetime`

## 3. 核心流程

### 免费用户流程

1. 用户安装插件。
2. 插件生成 `installation_id`。
3. 用户在 options 页面完成邮箱 OTP 登录。
4. 插件调用 `get-entitlement`。
5. 服务端返回 `free` 权益。
6. 用户可以使用受限免费功能。

### 付费升级流程

1. 用户在网站或插件中点击升级。
2. 前端请求 `create-checkout-session`。
3. Supabase Edge Function 创建本地 checkout session。
4. Edge Function 调用 Waffo 创建托管支付会话。
5. 用户在 Waffo 完成支付。
6. Waffo 回调 `waffo-webhook`。
7. 服务端验签、时间窗校验、去重、幂等处理。
8. 服务端写入 `orders`、`payments`、`entitlements`、`processed_webhooks`。
9. 用户回到 `/checkout/success` 后，只轮询 `get-entitlement`，不直接开会员。

### 额度扣减流程

1. 用户点击插件功能。
2. background/service worker 调用 `consume-usage`。
3. 服务端检查登录状态、产品权限、套餐功能和剩余额度。
4. 服务端原子扣减额度后返回结果。

## 4. 验收标准

### 账户

- 网站可完成邮箱 OTP 登录。
- 插件 options 页面可完成登录。
- 插件能保存并刷新 session。

### 支付

- `create-checkout-session` 仅由服务端创建。
- metadata 至少包含：
  - `userId`
  - `productKey`
  - `planKey`
  - `localOrderId`
  - `source`
- 如果接口支持，附带 `merchantProvidedBuyerIdentity`。
- webhook 可按 `mode` 区分 `test` / `prod`。
- webhook 保留 raw body 验签、时间窗校验、去重、幂等处理。
- 支付成功必须以 webhook 为准，不能由 success 页面直接开会员。

### 会员

- 免费用户只能访问免费功能。
- 付费用户获得对应套餐权限。
- 服务端额度扣减有效。
- 账户页能展示当前套餐、权益和订单状态。

### 安全

- `service_role` 仅在服务端使用。
- Waffo 私钥仅在服务端使用。
- content script 不直接持有敏感 token。

