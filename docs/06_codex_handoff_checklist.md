# 06. Codex 交付清单

## 1. 不要交给 Codex 的内容

不要把以下内容直接提交进仓库：

- Supabase 主账号密码
- Cloudflare 主账号密码
- Waffo 后台账号密码
- Waffo private key 明文
- Supabase service role key 明文
- 任何真实用户数据

真实密钥只放在：

- 本地 `.env.local`
- Cloudflare Pages 环境变量
- Supabase Edge Function secrets

## 2. 第一阶段目标

目标：跑通最小真实联调闭环。

必须覆盖：

### Web

- `/`
- `/pricing`
- `/login`
- `/account`
- `/checkout/success`
- `/checkout/cancel`
- `/privacy`
- `/terms`

### Supabase

- 执行 schema / migration / seed
- 部署 5 个 Edge Functions
- 完成 RLS

### 支付

- `create-checkout-session` 能创建 Waffo Test checkout
- `waffo-webhook` 能接收 Waffo Test 事件
- 支付成功后更新 `orders`、`payments`、`entitlements`

### 插件

- options 登录
- 查询 entitlement
- 点击升级
- `consume-usage` 扣减额度

## 3. 验收步骤

### 本地

1. `npm install`
2. `npm run supabase:db:reset`
3. `npm run supabase:functions:serve`
4. `npm run dev:web`
5. `npm run build:extension`
6. Load unpacked 扩展
7. 测试登录、查询 entitlement、consume-usage

### Waffo Test

1. 在 Waffo 后台配置 Test 商品、计划、价格和 webhook URL。
2. 在 Supabase 配置 Waffo Test secrets。
3. 创建 checkout session。
4. 完成 Test 支付。
5. 检查 `processed_webhooks`。
6. 检查 `orders`、`payments`、`entitlements`。
7. 回到 `/checkout/success` 或 `/account` 查看状态。

### Production

1. 切换 Production product / plan / price。
2. 配置 Production webhook URL 和公钥。
3. 进行小额真实订单测试。
4. 确认订单、权益和用户中心结果一致。

