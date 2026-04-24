# 02. 业务与数据流转图

## 1. 总架构图

```mermaid
flowchart LR
  U[用户] --> EXT[Chrome 插件\npopup/options/content]
  U --> WEB[Cloudflare Pages 网站\n官网/定价/账号/成功页]

  EXT -->|登录/查权限/扣额度| SB_AUTH[Supabase Auth]
  EXT -->|Edge Function API| SB_FN[Supabase Edge Functions]
  WEB -->|登录/用户中心| SB_AUTH
  WEB -->|创建支付/查会员| SB_FN

  SB_FN --> DB[(Supabase Postgres)]
  SB_FN --> STORAGE[Supabase Storage\n可选: 导出文件/头像]

  SB_FN -->|服务端创建 checkout session| WAFFO[Waffo Pancake\n托管结账/MoR]
  WAFFO -->|checkoutUrl| WEB
  WEB -->|跳转支付| WAFFO
  EXT -->|打开支付链接| WAFFO

  WAFFO -->|Webhook: order/subscription/refund| WH[waffo-webhook Edge Function]
  WH -->|验签/去重/入库/开通| DB

  DB --> ENT[entitlements 权益]
  DB --> USAGE[usage_counters 额度]
  DB --> BILL[billing/order/payment 日志]
```

## 2. 登录数据流

```mermaid
sequenceDiagram
  participant User as 用户
  participant Ext as Chrome 插件 options
  participant SB as Supabase Auth
  participant DB as Supabase Postgres
  participant Fn as Supabase Edge Function

  User->>Ext: 输入邮箱
  Ext->>SB: signInWithOtp(email)
  SB-->>User: 发送 6 位验证码邮件
  User->>Ext: 输入验证码
  Ext->>SB: verifyOtp(email, token)
  SB-->>Ext: access_token + refresh_token
  Ext->>Fn: get-entitlement(productKey)
  Fn->>DB: 查询 profiles/products/plans/entitlements/usage
  DB-->>Fn: 权益和额度
  Fn-->>Ext: 返回当前会员状态
```

## 3. 支付数据流

```mermaid
sequenceDiagram
  participant Ext as Chrome 插件/网站
  participant Fn as create-checkout-session
  participant DB as Supabase Postgres
  participant W as Waffo Pancake
  participant WH as waffo-webhook

  Ext->>Fn: POST productKey + planKey + installationId
  Fn->>DB: 创建本地 checkout_sessions 记录
  Fn->>W: 创建 checkout session，附带 metadata
  W-->>Fn: sessionId + checkoutUrl + expiresAt
  Fn->>DB: 保存 waffo_session_id 和 checkoutUrl
  Fn-->>Ext: checkoutUrl
  Ext->>W: 打开托管结账页
  W-->>WH: Webhook: order.completed 或 subscription.activated
  WH->>WH: 使用原始 body 验证 RSA-SHA256 签名
  WH->>DB: eventType + eventId 去重
  WH->>DB: 写入订单/支付/订阅
  WH->>DB: upsert entitlements
  WH-->>W: 200 OK
```

## 4. 插件功能执行流

```mermaid
sequenceDiagram
  participant User as 用户
  participant UI as 插件 popup/content
  participant BG as background service worker
  participant Fn as consume-usage Edge Function
  participant DB as Supabase Postgres

  User->>UI: 点击 batch export
  UI->>BG: chrome.runtime.sendMessage({type:'CONSUME_USAGE'})
  BG->>Fn: POST productKey + featureKey
  Fn->>DB: 检查 entitlement 是否有效
  Fn->>DB: 检查 feature 是否开启
  Fn->>DB: 原子扣减 quota
  alt 允许
    Fn-->>BG: allowed=true, remaining=-1
    BG-->>UI: 可以执行
    UI->>UI: 执行本地插件功能
  else 不允许
    Fn-->>BG: 403/429 + 错误码
    BG-->>UI: 显示升级或额度用尽
  end
```

## 5. 数据归属

| 数据 | 放在哪里 | 说明 |
|---|---|---|
| 官网页面 | Cloudflare Pages | SEO、静态资源、登录页、定价页、账号页 |
| 用户账号 | Supabase Auth | 邮箱 OTP / magic link |
| 用户资料 | Supabase Postgres `profiles` | 与 `auth.users` 一对一 |
| 套餐配置 | Supabase Postgres `plans` | feature/quotas 数据驱动 |
| 订单/支付/订阅 | Supabase Postgres | 来自 Waffo webhook |
| 权益 | Supabase Postgres `entitlements` | 插件和网站统一读取 |
| 使用额度 | Supabase Postgres `usage_counters` | 服务端原子扣减 |
| 插件 UI 文件 | 用户浏览器扩展环境 | 通过 Chrome Web Store 安装 |
| 插件本地状态 | `chrome.storage.local/session` | token、entitlement cache、installation_id |
| 支付页面 | Waffo Pancake | 托管结账页 |
| 导出文件 | Supabase Storage，可选 | 只有需要云端保存时使用 |

