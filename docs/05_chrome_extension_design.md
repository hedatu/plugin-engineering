# 05. Chrome 插件会员接入设计

## 1. 插件不是托管网页

Chrome 插件的 UI 文件在扩展包里：

```text
popup.html
options.html
background.js
content-script.js
```

用户安装后，这些文件由浏览器扩展系统加载，不是从 Cloudflare 或 Supabase 实时加载。

Cloudflare 只托管：

- 官网
- 定价页
- 登录页
- 用户中心
- 支付成功页
- 帮助文档

Supabase 只提供：

- 登录 API
- 权益 API
- 额度 API
- 支付 API

## 2. 推荐插件结构

```text
extensions/my-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── index.ts
│   ├── popup/
│   │   ├── index.html
│   │   └── App.tsx
│   ├── options/
│   │   ├── index.html
│   │   └── App.tsx
│   ├── content/
│   │   └── index.ts
│   ├── sdk/
│   │   ├── auth.ts
│   │   ├── entitlement.ts
│   │   └── usage.ts
│   └── config.ts
└── vite.config.ts
```

## 3. background/service worker 职责

background 是插件的安全中枢：

- 保存 access token / refresh token。
- 刷新 Supabase session。
- 调 Supabase Edge Functions。
- 转发 popup/options/content 的请求。
- 缓存 entitlement 状态。
- 处理网络错误和登录过期。

content script 不直接持有 token。

## 4. options 页面

必须包含：

- 邮箱输入框。
- 发送验证码按钮。
- 验证码输入框。
- 登录按钮。
- 当前用户邮箱。
- 当前 productKey。
- 当前 plan。
- 当前权益状态。
- 功能列表。
- 剩余额度。
- 升级会员按钮。
- 管理订阅/账号按钮。
- 刷新权限按钮。
- 退出登录按钮。

## 5. popup 页面

popup 要简单：

- 当前会员状态。
- 当前剩余额度。
- 主要功能按钮。
- 未开通时显示升级。
- 出错时显示明确原因。

## 6. feature gating

插件 UI 可以先根据 cached entitlement 控制按钮展示，但执行前必须服务端确认。

伪代码：

```ts
async function runBatchExport() {
  const result = await chrome.runtime.sendMessage({
    type: 'CONSUME_USAGE',
    productKey: PRODUCT_KEY,
    featureKey: 'batch_export',
    amount: 1,
  })

  if (!result.allowed) {
    if (result.errorCode === 'FEATURE_NOT_ENABLED') showUpgrade()
    if (result.errorCode === 'QUOTA_EXCEEDED') showQuotaExceeded()
    return
  }

  await executeBatchExportLocally()
}
```

## 7. installation_id

首次运行时生成：

```ts
const installationId = crypto.randomUUID()
```

保存到 `chrome.storage.local`。

登录后调用 `register-installation`：

```json
{
  "productKey": "chatgpt2obsidian",
  "installationId": "uuid",
  "extensionId": "chrome-extension-id",
  "browser": "chrome",
  "version": "1.0.0"
}
```

服务端根据套餐 `max_installations` 判断是否允许绑定。

## 8. token 存储建议

第一版：

- access_token：`chrome.storage.local`，并在 background 内存缓存。
- refresh_token：`chrome.storage.local`。
- entitlement_cache：`chrome.storage.local`，带 `fetchedAt`。

更安全的后续版本：

- access_token 存 `chrome.storage.session` 或 background 内存。
- refresh_token 仍需持久化，但减少暴露面。
- content script 永不读取 token。

## 9. 插件升级支付方式

点击“Upgrade”后有两种方式：

### 方案 A：打开网站 pricing

```text
https://yourproduct.com/pricing?productKey=chatgpt2obsidian&source=extension
```

优点：界面好做，用户更信任。

### 方案 B：插件直接调 create-checkout-session

插件调用 Edge Function 后，直接打开返回的 Waffo `checkoutUrl`。

优点：路径短。

建议第一版使用方案 A，网站里再创建 checkout session。

## 10. 不要做的事情

- 不要只靠前端控制付费功能。
- 不要把 Waffo 私钥放插件里。
- 不要把 Supabase service_role key 放插件里。
- 不要把真正功能逻辑远程下发给插件执行。
- 不要把支付成功 URL 当作开通依据。
- 不要让 content script 能直接读写会员 token。

