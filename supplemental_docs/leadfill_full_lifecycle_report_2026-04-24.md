# LeadFill Full Lifecycle Report

Updated: 2026-04-24
Project: Chrome Extension Opportunity Factory
Product: LeadFill One Profile

## 0. 这份报告是干什么的

这不是一份简单的结果总结，而是一份完整的端到端流程报告。

目标是把这条产品线从最早的机会发现，到插件设计、实现、QA、包装、网站、支付接入、California 基础设施迁移，再到未来的 Chrome upload / publish 路径，全部串成一条清晰的链路。

这份报告重点回答 5 个问题：

1. 这个产品是怎么被选出来的。
2. 插件本体是怎么设计和实现的。
3. 官网、支付、会员体系是怎么接进去的。
4. 现在到底做到哪一步了。
5. 后面如果真的要上传和发布，还要经过哪些人工和技术步骤。

## 1. 当前一句话结论

LeadFill 已经完成以下关键里程碑：

- 需求发现和候选筛选完成
- 单用途插件设计完成
- 插件本体实现完成
- QA 和浏览器烟测完成
- 商业包装和 listing package 完成
- California 已成为主环境
- `pay.915500.xyz` / `pay-api.915500.xyz` 已切到 California
- SMTP 已独立到 Resend
- HWH / Waffo test-mode 支付闭环已验证
- `source=chrome_extension` 真插件路径已验证
- 官网已从 membership/payment hub 改造成 LeadFill-first 产品官网

但以下事情还没有做：

- 没有 Chrome upload
- 没有 Chrome publish
- 没有 production payment
- 没有 public launch approval

所以，当前状态不是“已经公开发布”，而是“内部商业候选版已经基本完备，只差人工视觉审核、生产支付验证和最终公开发布批准”。

## 2. 实际 run 链路

这条产品线目前至少有 3 个关键 run：

1. 源 daily run
   - `2026-04-19-145118-daily-4df0e2`
   - 用于机会发现、候选选择、brief 起点

2. 源 commercial sandbox run
   - `commercial-2026-04-21-195643-dnnpkaefmlha-v0-2-0-7836c9`
   - 用于商业版候选的中间验证

3. 当前 payment-configured commercial candidate
   - `commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2`
   - 当前最重要的工作基线

当前商业候选版的上下文见：

- [00_run_context.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/00_run_context.json)
- [140_payment_configured_commercial_candidate.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/140_payment_configured_commercial_candidate.json)

这条 run 链说明了一件事：

- 不是在旧 run 上直接乱改
- 而是从已有 commercial candidate 派生出新的 payment-configured commercial candidate
- 保持 immutable run 的纪律
- 保持审计链和产物链清楚

## 3. 整体流程图

可以把整个项目拆成 9 个大阶段：

1. 找需求
2. 定 wedge 和产品 brief
3. 设计插件和实现计划
4. 构建插件本体
5. QA 和浏览器验证
6. 商业包装和上架素材
7. 官网和支付接入
8. California 主环境迁移和 cutover
9. 未来的 Chrome upload / publish / public launch

下面按这个顺序展开。

## 4. 第一阶段：找需求

### 4.1 这个项目怎么找需求

这个工厂不是先拍脑袋定产品，而是先从机会发现开始。

工厂标准 stage 顺序在 `AGENTS.md` 里已经定义：

- `INGEST_TASK`
- `DISCOVER_CANDIDATES`
- `ENRICH_FEEDBACK`
- `CLUSTER_PAIN_POINTS`
- `SCORE_OPPORTUNITIES`
- `BUILD_GATE`

对于 LeadFill 这条线，当前我们能直接看到的关键筛选结果在：

- [31_selected_candidate.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/31_selected_candidate.json)

### 4.2 实际选中了什么

被选中的候选是：

- `cand-form-001`
- 候选名：`Lead Form Helper`
- wedge family：`single_profile_form_fill`

选择原因非常明确：

- 有足够的用户和评论基础
- 负反馈和痛点足够清楚
- 当前 builder family 支持这个方向
- overlap 分数可接受
- 不属于高风险高重复方向

核心筛选依据来自 artifact：

- 4 clusters
- 5 evidence items
- weighted evidence 4.5
- overall score 84.29

### 4.3 为什么不是“做一个更大的自动化插件”

因为这个工厂的设计原则不是做“大而全”，而是做单用途 wedge。

所以这里没有走：

- CRM sync
- 云端账号体系
- 多 profile 团队协作
- 广义浏览器自动化

而是收敛成一个很窄、很清楚、很容易陈述也更容易合规的 wedge：

- 保存一个本地 profile
- 在当前页面的一组可见字段里做 click-to-fill

这一步非常关键，因为后面所有设计、权限、文案、定价、支付，都是围绕这个窄 wedge 长出来的。

## 5. 第二阶段：定产品 brief 和插件设计

### 5.1 产品 brief 怎么定

产品 brief 在：

- [41_product_brief.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/41_product_brief.json)
- [41_product_brief.md](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/41_product_brief.md)

这里把产品收敛成了非常明确的定义：

- 产品名：`LeadFill One Profile`
- single purpose statement：
  `Save one local profile and fill visible lead form fields on the current page in one click.`

### 5.2 目标用户是谁

brief 里明确写了目标用户：

- sales reps
- recruiters
- operators
- 核心痛点是反复输入同一组联系信息

这决定了文案方向和产品设计方向都必须围绕：

- 省时间
- 减少重复劳动
- 本地保存
- 一键填充

### 5.3 插件核心设计怎么定

brief 里定下来的核心 workflow 是：

1. 打开 popup
2. 保存一个可复用 profile 到本地
3. 打开目标网页表单
4. 点击 `Fill Current Page`

### 5.4 必须要有的能力

brief 中的 must-have features：

- 一个可复用的本地 profile
- 只处理当前页面可见字段
- 只有用户显式点击才触发 fill

### 5.5 明确不做什么

这一步很重要，因为它直接限制了后续需求膨胀。

brief 中的 non-goals：

- No CRM sync
- No multi-profile team workspace
- No cloud account

### 5.6 权限预算怎么控制

brief 已经把权限预算收得非常窄：

required:

- `storage`
- `activeTab`
- `scripting`

forbidden:

- `host_permissions`
- `identity`
- `downloads`
- `background`

这一步的价值是：

- 降低政策风险
- 让隐私承诺更可信
- 让 listing copy 更容易自洽

## 6. 第三阶段：设计实现计划

### 6.1 实现计划在哪里

实现计划在：

- [42_implementation_plan.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/42_implementation_plan.json)

### 6.2 插件本体怎么拆模块

这个计划并不是只写“做一个 popup”，而是拆成了清楚的模块：

- popup profile editor
- local storage bridge
- active-tab script injection
- field matching heuristics
- privacy page

在商业版范围里，又额外加了：

- monetization config
- paywall UI
- license client
- usage meter
- external upgrade flow
- background membership runtime
- email OTP auth UI
- entitlement refresh
- usage gate
- external checkout flow

### 6.3 为什么实现计划里就把支付和会员一起规划进去了

因为这个产品最后不是只做免费插件，而是要做“可商业化但安全边界清楚”的插件。

所以实现计划里必须从一开始就考虑：

- 免费额度怎么扣
- 升级入口怎么打开
- 支付后会员如何刷新
- 什么情况下不能本地开会员
- 插件端不能持有哪些 secret

### 6.4 生成哪些文件

生成计划里已经明确列出主要文件：

- `manifest.json`
- `popup.html`
- `popup.css`
- `popup.js`
- `privacy.html`
- `background.js`
- `monetization_config.json`
- `pay_site_config.json`
- `monetization/authFlow.js`
- `monetization/checkoutFlow.js`
- `monetization/membershipClient.js`
- `monetization/usageGate.js`

这说明这不是只靠网站或只靠后端，而是插件前端、后台 runtime 和外部 pay site 有清楚分工。

### 6.5 这一步已经提前设了哪些风险边界

实现计划里明确写了这些风险 flag：

- visible fields only
- no hidden server sync
- no provider secrets in bundle
- do not trust local storage alone for paid unlock
- successUrl must not unlock membership locally

这几个边界贯穿了后续所有阶段。

## 7. 第四阶段：构建插件本体

### 7.1 构建产物在哪里

构建报告在：

- [50_build_report.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/50_build_report.json)

### 7.2 构建结果是什么

构建结果说明：

- archetype：`single_profile_form_fill`
- manifest version：`0.2.0`
- package zip 已生成
- dist 已生成
- repo workspace 已生成

### 7.3 商业化配置是怎么注入进去的

build report 明确显示这轮已经注入的是公开配置，不是私密配置：

- `site_url=https://pay.915500.xyz`
- `public_supabase_url=https://pay-api.915500.xyz`
- `product_key=leadfill-one-profile`
- `plan_key=lifetime`
- `feature_key=leadfill_fill_action`
- `checkout_mode=test`

而且这里特别重要的一点是：

- `public_supabase_anon_key_present=true`
- 但 service role、merchant secret、Waffo private key 不在 bundle 里

这一步证明“支付接入”不是靠把后端 secret 塞进插件里完成的。

## 8. 第五阶段：QA 和浏览器烟测

### 8.1 静态 QA

静态 QA 在：

- [60_qa_report.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/60_qa_report.json)

这一步检查的是：

- manifest 是否是 MV3
- 权限是否符合计划
- popup / privacy / README / monetization 文件是否齐全
- monetization config 是否存在且结构正确
- popup UI 和 trust copy 是否存在

结果：

- 全部通过

### 8.2 浏览器烟测

浏览器烟测在：

- [61_browser_smoke.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/61_browser_smoke.json)

它不是只看“插件能打开”，而是覆盖了多个真实场景：

- 空白表单填充
- 部分已填表单
- readonly / disabled 字段跳过
- select 字段填充
- 无匹配字段场景
- 默认不覆盖已有值
- popup 反馈信息显示
- profile 管理

### 8.3 这些烟测证明了什么

它证明了 LeadFill 的产品承诺不是空的：

- 能填
- 知道何时不该覆盖
- 知道何时跳过 locked field
- 无匹配时不会乱写
- 本地 profile 可编辑和删除

也就是说，“插件本体”的核心用户价值已经被实际验证过了。

### 8.4 功能矩阵和产品验收

相关产物还包括：

- [62_functional_test_matrix.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/62_functional_test_matrix.json)
- [94_product_acceptance_review.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/94_product_acceptance_review.json)

产品验收的结论是：

- 核心流程已经被证明
- UX 是 `clear_but_basic`
- 商业化路径是 `commercial_flow_scoped_and_proven`
- 最大剩余风险是字段匹配仍依赖 heuristic

这说明产品不是“没做出来”，而是“做出来了，并且已经进入 polish 和 launch discipline 阶段”。

## 9. 第六阶段：商业包装和 listing package

### 9.1 为什么插件不是 build 完就算完

因为最终要进入商店，就必须解决这些问题：

- 截图要真实
- 文案要真实
- 隐私承诺要自洽
- 付费披露要真实
- 页面和素材要有 premium feel

### 9.2 商业包装产物有哪些

关键产物包括：

- [110_monetization_security_scan.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/110_monetization_security_scan.json)
- [111_premium_packaging_brief.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/111_premium_packaging_brief.json)
- [112_brand_system.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/112_brand_system.json)
- [114_screenshot_storyboard.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/114_screenshot_storyboard.json)
- [115_listing_quality_gate.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/115_listing_quality_gate.json)
- [120_store_listing_release_package_report.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/120_store_listing_release_package_report.json)

### 9.3 为什么这一段很重要

因为这一步直接决定：

- 商店第一眼是否可信
- 用户是否能看懂 Free 和 Lifetime
- 会不会因为虚构能力或虚假截图被打回

### 9.4 当前包装质量如何

从现有 artifact 看：

- monetization security scan：passed
- listing quality gate：passed
- premium feel score：100
- store listing release package：passed

这意味着“上架素材包”在系统层面已经准备好了。

但是还差一个关键人工环节：

- human visual review

也就是说，系统觉得它已经够好了，但公开前仍然需要人眼兜底。

## 10. 第七阶段：官网设计和“把插件接到网页上”

你之前特别关心“网页怎么设计”，这里单独讲。

### 10.1 这一步的本质是什么

这里不是“上传插件到 Chrome Web Store”，而是“让插件有一个像正式商业产品的官网和支付前台”。

也就是：

- 插件不只是一个 zip
- 它还要有官网
- 有产品页
- 有定价页
- 有 Account / Membership 页
- 有支付成功/失败页
- 有法律页面

### 10.2 最初的网站问题是什么

你指出的问题非常准确：

- 首页太像 membership hub
- 顶部导航太像后台
- Pricing 太技术化
- Hero 不够像产品官网
- 页面空但不高级
- 技术说明在错误的位置

### 10.3 这轮网站重构到底改了什么

当前网站输出在：

- [index.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/index.html)
- [product.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/product.html)
- [pricing.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/pricing.html)
- [account.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/account.html)
- [refund.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/refund.html)
- [privacy.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/privacy.html)
- [terms.html](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/terms.html)

改造结果是：

首页现在是 LeadFill 首页，不是 membership hub 首页。

首页结构变成：

1. Hero
2. 真实截图视觉区
3. Core benefits
4. How it works
5. Free vs Lifetime
6. FAQ
7. Footer CTA

### 10.4 顶部导航怎么改了

改成了：

- Home
- Product
- Pricing
- Account

而不是：

- 像后台一样堆很多系统页入口

Refund / Privacy / Terms 被降级到了 footer。

### 10.5 Pricing 页怎么改了

Pricing 不再写这种技术表达：

- feature flags
- internal config 风格字段
- account/system 状态放在高位

现在是用户能直接看懂的人话结构：

- Free
- Lifetime Unlock
- How payment works
- How membership refresh works

而且保留了技术真相，但位置被放对了。

### 10.6 设计系统怎么定的

设计系统产物在：

- [142_web_design_system.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/142_web_design_system.json)

设计方向是：

- premium
- modern
- clean
- focused
- productized
- trustworthy

其中已经明确规定：

- typography 层级
- color system
- spacing system
- component system
- copy rules
- payment safety rules

### 10.7 网站如何与插件和支付联动

站点不是独立瞎写的，它跟插件和支付配置对齐：

- 产品 key 对齐
- plan key 对齐
- site URL 对齐
- public supabase URL 对齐
- success / cancel 页面对齐
- account 页面承接 membership restore

### 10.8 多语言是怎么做的

当前支持：

- `en`
- `zh-cn`
- `ja`
- `es`

相关产物：

- [locales.json](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/locales.json)

当前结论是：

- 多语言页面已经生成
- 英文是 source of truth
- 其他语言仍需人工语言检查

## 11. 第八阶段：绑定支付

这是整条链里技术要求最高的一段。

### 11.1 支付接入的原则

支付不是“点一个 success 页面就开会员”，而是严格按下面的原则做：

- 插件只持有 public config
- checkout 在外部安全页面完成
- webhook 才是 entitlement active 的唯一依据
- successUrl 不能在本地开会员
- 插件不能持有 service role / private key / merchant secret

### 11.2 为什么要先做 SMTP

因为账号恢复和 membership refresh 走的是 email OTP。

如果 OTP 不稳定：

- 登录不稳定
- 会员恢复不稳定
- 支付后的 entitlement refresh 也会受影响

所以 SMTP 独立化不是边角问题，而是支付闭环的前置条件。

### 11.3 SMTP 绑定过程中遇到什么问题

最开始 California 仍依赖旧服务器 relay。

风险是：

- 旧服务器一到期，OTP 就断

后来切到了 Resend，并在 [smtp_independent_e2e_report.california.json](/D:/code/ai插件优化工作流/migration/smtp_independent_e2e_report.california.json) 中验证通过。

另外又遇到一层网络问题：

- DO 封了 `465` / `587` / `25`
- 最后改用 Resend `2587`

### 11.4 HWH / Waffo 支付是怎么绑定进来的

绑定步骤大致是：

1. 插件端生成 checkout 请求
2. checkout 请求里带上正确 metadata
3. 用户跳到外部支付页
4. Waffo 完成 test payment
5. webhook 发到 pay-api
6. California 验签
7. 写入 orders / payments
8. entitlement 变 active
9. 插件端 refresh membership
10. Pro usage 开始允许

### 11.5 真正验证通过了哪些点

从 [waffo_chrome_extension_source_e2e.ca-hwh.json](/D:/code/ai插件优化工作流/migration/waffo_chrome_extension_source_e2e.ca-hwh.json) 可以确认：

- `source=chrome_extension` 已验证
- 真插件客户端已跑通
- installationId 存在
- localOrderId 匹配
- webhook 收到并验签
- entitlement active from webhook
- refresh entitlement active
- consume usage pro passed
- UI pro active verified
- success URL 没有本地开会员

### 11.6 支付为什么还没有进入 production

因为当前所有支付验证都还是：

- `checkout_mode=test`
- `production_payment_status=not_verified`

也就是说，支付体系架子和闭环都通了，但 live commerce 还没验证。

## 12. 第九阶段：California 主环境迁移和 cutover

### 12.1 为什么需要 California

因为原来的部署和依赖关系不够稳，尤其 SMTP relay 和环境收口不理想。

目标是让 California 成为新的主环境，并把：

- pay site
- pay api
- auth
- review-watch

都稳定收口到 California。

### 12.2 California 最终做成了什么

从 [dns_cutover_gate.json](/D:/code/ai插件优化工作流/migration/dns_cutover_gate.json) 和 [post_cutover_smoke_report.json](/D:/code/ai插件优化工作流/migration/post_cutover_smoke_report.json) 看：

- DNS cutover 已执行
- HTTPS 正常
- webhook route 正常
- OTP smoke 正常
- entitlement / installation / free quota 正常
- review-watch 正常
- rollback plan 已准备

### 12.3 还保留了什么

虽然 California 已经是 primary，但 staging alias 仍保留：

- `ca-hwh.915500.xyz`
- `ca-hwh-api.915500.xyz`

这有两个好处：

- 出问题时有对照环境
- 迁移不是“一刀切后没有退路”

### 12.4 最大剩余基础设施风险是什么

不是 DNS，也不是 SMTP，也不是 webhook。

最大剩余风险是：

- `1 GB RAM + 2 GB swap`

当前它是已接受风险，不是未解决 blocker。

## 13. 第十阶段：未来如果真的要上传 Chrome Web Store，要怎么走

这里必须讲清楚：

当前并没有 upload / publish。

但是这条路径已经被设计出来了。

### 13.1 当前 run 对发布意图的定义

在 [80_publish_plan.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/80_publish_plan.json) 中：

- `publish_intent = draft_only`

也就是说：

- 当前允许做完发布准备
- 不允许直接公开发布

### 13.2 sandbox validation 是怎么准备的

在 [83_sandbox_validation_plan.json](/D:/code/ai插件优化工作流/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/83_sandbox_validation_plan.json) 中，已经定义了：

- run type 是 `sandbox_validation`
- upload_allowed = false
- publish_allowed = false
- 下一步必须先完成人工视觉审核

### 13.3 真正的未来发布顺序应该是什么

如果后面真的要上 Chrome Web Store，推荐顺序是：

1. 完成 human visual review
2. 解决 review 中发现的问题
3. 做 production payment readiness
4. 做 controlled live payment verification
5. 请求 sandbox upload approval
6. 执行 sandbox upload
7. 看 review status
8. 再决定是否请求 publish approval
9. 再执行 publish

### 13.4 对应命令路径

后续真正会用到的关键命令包括：

- `npm run packaging:record-human-visual-review -- --run runs/<run_id> --decision passed --note "<note>"`
- `npm run approve:sandbox-upload -- --run runs/<run_id> --note "<note>"`
- `npm run publish:sandbox-upload -- --run runs/<run_id>`
- `npm run publish:review-status -- --run runs/<run_id>`
- `npm run approve:sandbox-publish -- --run runs/<run_id> --note "<note>"`
- `npm run publish:sandbox-publish -- --run runs/<run_id>`

### 13.5 为什么现在还不能走这条路

因为还差：

- human visual review
- production payment verification
- public launch approval

## 14. 这整个项目里遇到的主要问题

### 14.1 需求阶段的问题

- 需要避免做高重叠、低差异化 wedge
- 需要把需求从“大而全”收敛成一个清晰的 single purpose

### 14.2 实现阶段的问题

- 不能让插件为支付接入而持有 secret
- 不能因为做商业化就破坏本地优先和权限最小化

### 14.3 支付阶段的问题

- California 最初只收到 generic verification ping
- 后来才拿到真实 paid webhook
- 早期插件 Unauthorized 其实是 stale local config 和 stale profile 问题

### 14.4 SMTP 阶段的问题

- 最初依赖旧 relay
- 切 Resend 时又撞上 DO 端口封禁

### 14.5 网站阶段的问题

- 网站最初像支付中台，不像产品官网
- 旧自动检查规则还在逼首页显示中台式技术文案
- product-first rewrite 一度把本地化模块改挂了

### 14.6 文档阶段的问题

- 状态分散在 `runs/`、`state/run_events/`、`migration/`、`generated/` 等多个目录
- 没有一个单点文档能完整说明当前状态

这也是为什么这次需要重新写这份全流程报告。

## 15. 当前还没解决的问题

当前未解决的问题，不再是“系统跑不通”，而是“发布前最后一圈人工和商业化问题”。

### 15.1 human visual review 还没过

文件：

- [146_human_visual_review_checklist.md](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/146_human_visual_review_checklist.md)

### 15.2 production payment 还没验证

文件：

- [147_production_payment_readiness.md](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/147_production_payment_readiness.md)

### 15.3 public launch approval 还没给

文件：

- [149_public_launch_gate.json](/D:/code/ai插件优化工作流/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/149_public_launch_gate.json)

### 15.4 低内存风险仍然存在

文件：

- [california_capacity_review.json](/D:/code/ai插件优化工作流/migration/california_capacity_review.json)

### 15.5 多语言页面还需要人审

文件：

- [locales.json](/D:/code/ai插件优化工作流/generated/plugin-pages/leadfill-one-profile/locales.json)

## 16. 现在这个项目到底走到哪一步了

如果用最实际的话说：

这个项目已经走完了“从需求找到一个可以做的商业插件，到把插件、官网、支付、主环境都搭出来并验证 test-mode 闭环”的绝大部分工程工作。

现在剩下的不是从 0 到 1 的难题，而是从“内部准备完成”到“对外公开发布”之间的最后三个门：

1. human visual review
2. production payment verification
3. final public launch approval

## 17. 推荐下一步

最合理的顺序仍然是：

1. 做 human visual review
2. 根据 review 修最后的网页和包装细节
3. 做 production payment readiness 和 live config planning
4. 做 controlled production payment verification
5. 再决定是否准备 Chrome re-review / sandbox upload

不建议的顺序：

- 直接 upload
- 直接 publish
- 在没有 live payment verification 的情况下公开收费

## 18. 最后结论

LeadFill 这条产品线不是停留在概念、原型或半成品阶段。

它已经具备了这些真实能力：

- 有明确来源的需求选择
- 有清楚的 wedge 和产品定义
- 有最小权限的插件实现
- 有真实 QA 和浏览器验证
- 有商业包装和 listing package
- 有官网和支付前台
- 有 test-mode 的真实支付闭环
- 有 webhook 驱动的 entitlement 激活
- 有 California 主环境和 review-watch

它现在缺的，不是“再做一次工程重写”，而是：

- 人工视觉审核
- 生产支付验证
- 公开发布决策

这三个问题解决之后，才进入真正的公开商业发布阶段。
