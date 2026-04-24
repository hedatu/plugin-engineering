# 07. 安全与运维方案

## 1. 密钥管理

### 前端可暴露

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### 绝不能暴露到前端/插件

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_PRIVATE_KEY`
- `WAFFO_WEBHOOK_PUBLIC_KEY_TEST/PROD` 虽然是公钥，但也建议只放服务端配置。
- Waffo 后台账号密码。
- Cloudflare API token。

## 2. Webhook 安全

必须满足：

- HTTPS。
- 原始 body 验签。
- RSA-SHA256。
- timestamp 5 分钟容忍。
- eventType + eventId + mode 去重。
- 未处理事件也返回 200，避免无意义重试。
- 存 raw payload 方便排查。

## 3. 数据库安全

- 所有表开启 RLS。
- 公开表只允许 select active 数据。
- billing/entitlement/webhook 只能 service role 写。
- 用户只能读自己的订单摘要。
- 使用 SQL function 做原子扣减，避免并发超用。

## 4. 插件安全

- token 不给 content script。
- content script 只做页面 DOM 操作。
- 所有敏感 API 由 background 调用。
- 插件只缓存 entitlement，缓存不能作为最终授权依据。
- 每次执行付费/限额功能前都要调用 `consume-usage`。

## 5. 运营监控

第一版至少保留：

- Edge Function 日志。
- webhook_events 表。
- failed webhook 查询。
- orders/payments/subscriptions 状态统计。
- entitlement 异常查询。
- usage 超限日志。

## 6. 常用 SQL 查询

### 查询失败 webhook

```sql
select *
from webhook_events
where processed_at is null or processing_error is not null
order by received_at desc;
```

### 查询某用户权益

```sql
select p.email, pr.product_key, pl.plan_key, e.status, e.expires_at
from entitlements e
join profiles p on p.id = e.user_id
join products pr on pr.id = e.product_id
left join plans pl on pl.id = e.plan_id
where p.email = 'user@example.com';
```

### 查询今日用量

```sql
select *
from usage_counters
where period_type = 'day'
  and period_start = date_trunc('day', now());
```

## 7. 备份策略

- Supabase Pro 后启用自动备份。
- 关键表定期导出：orders、payments、subscriptions、entitlements、webhook_events。
- 每次改 schema 前做 migration，不直接在线上手改。
- Test 和 Production 使用不同项目或至少不同 Waffo mode 和 product IDs。

## 8. 法务和审核准备

你需要准备：

- 自有域名。
- 自有域名邮箱，例如 `support@yourproduct.com`。
- 隐私政策。
- 服务条款。
- 退款政策。
- 公开价格页。
- 产品说明页。
- Chrome Web Store 隐私披露。
- Waffo 禁售/限制品类自查。

