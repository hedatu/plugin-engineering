# 00. 架构决策说明

## 1. 网站到底放在哪里？

推荐：**Cloudflare Pages 放网站前端，Supabase 放后端。**

原因：

- Cloudflare Pages 更适合托管官网、定价页、登录页、用户中心这些前端页面。
- Supabase 更适合做数据库、用户登录、Edge Functions、Storage、权限和订单逻辑。
- Supabase 可以有自定义域名，但更适合作 API 域名，例如 `api.yourdomain.com`，而不是把整个营销网站都塞进 Supabase。
- 你可以把域名 DNS 放 Cloudflare，网站用 `yourdomain.com`，Supabase API 用默认 `project.supabase.co` 或 `api.yourdomain.com`。

推荐域名结构：

```text
https://yourproduct.com             -> Cloudflare Pages 网站
https://yourproduct.com/pricing     -> Cloudflare Pages 定价页
https://yourproduct.com/account     -> Cloudflare Pages 用户中心
https://api.yourproduct.com         -> Supabase 自定义 API 域名，可选
https://<project>.supabase.co       -> Supabase 默认 API 域名，可先用
```

## 2. Chrome 插件放在哪里？

Chrome 插件不放在 Cloudflare，也不放在 Supabase。

插件是一个扩展包：

```text
manifest.json
popup.html
options.html
background.js
content-script.js
assets/*
```

用户从 Chrome Web Store 安装后，这些文件就在用户浏览器的扩展环境里运行，地址通常类似：

```text
chrome-extension://<extension-id>/options.html
```

插件只需要访问：

- Cloudflare 网站：打开登录、定价、账号、帮助页面。
- Supabase API：查询会员、扣减额度、注册安装、同步状态。
- Waffo 托管结账页：由后端创建 session 后返回 `checkoutUrl`，插件打开它。

不要做：

- 不要把插件 options 页面当作你网站上的一个普通 URL。
- 不要从你的服务器动态下发可执行代码给插件。
- 不要让 content script 直接持有敏感 token。

## 3. 为什么不用一台传统服务器？

你现在不需要传统 VPS。

你需要的是三层服务：

```text
Cloudflare Pages  -> 前端页面和静态资源
Supabase          -> Auth + DB + Edge Functions + Storage
Waffo Pancake     -> 收款 + 托管结账 + Webhook + MoR
```

这已经足够完成第一版商业闭环。

## 4. 为什么支付成功页不能直接开会员？

因为 success URL 只是用户浏览器跳回来了，不代表支付一定最终成功。

正确逻辑：

1. 用户点击升级。
2. 你的 Supabase Edge Function 创建本地订单。
3. Edge Function 调 Waffo 创建 checkout session。
4. 用户在 Waffo 页面支付。
5. Waffo 通过 webhook 通知 Supabase。
6. Supabase 验签、去重、入库、开会员。
7. 网站或插件刷新会员状态。

## 5. 第一版不要做太复杂

第一版建议只做：

- 一个产品：`chatgpt2obsidian` 或你的真实插件 productKey。
- 三个套餐：`free`、`pro_monthly`、`lifetime`。
- 两个功能：`single_export`、`batch_export`。
- 一个额度：free 每日 5 次；pro/lifetime 不限。
- 一个用户中心：显示当前套餐、购买记录、额度。

跑通后再扩展到多插件商城。

