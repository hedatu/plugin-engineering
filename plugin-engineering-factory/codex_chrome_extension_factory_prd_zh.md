# PRD：Chrome Extension Opportunity Factory（给 Codex 的主规格文件）

- 文档版本：v1.0
- 状态：Execution-ready Draft
- 日期：2026-04-18
- 适用对象：Codex、项目维护者、人工审核人、发布运营
- 文档定位：这是本项目的**产品与工程主规格**。它既是产品 PRD，也是 Codex 的执行边界说明。
- 文档目标：把“每天发现一个细分 Chrome 插件机会，并生成一个合规、单用途、差异化的新扩展”的想法，固化成可持续执行、可审计、可回放、可扩展的自动化系统。

---

## 0. 使用说明

1. 本文档是仓库内的**主规格文件**。  
2. `AGENTS.md` 应当是本文的浓缩执行版；若两者冲突：
   - 产品目标、范围、验收，以本文为准。
   - 本地命令、lint/test 细节，以 `AGENTS.md` 为准。
3. 所有自动生成内容都必须落盘，禁止只在对话中“认为已完成”。
4. 所有阶段都必须可单独重跑，并可在失败后从最近一次有效工件继续。
5. 对外公开发布默认需要人工闸门；没有通过闸门，不得视为“发布完成”。

---

## 1. 项目概述

### 1.1 项目名称
Chrome Extension Opportunity Factory

### 1.2 一句话定义
一个以**真实用户抱怨和公开反馈**为输入，自动完成**机会发现、需求抽象、产品定义、MV3 扩展生成、QA、素材、发布准备和发布后复盘**的 Chrome 扩展工厂。

### 1.3 核心原则
- 不是“抄一个插件”。
- 是“用竞品作为需求证据，独立实现一个更聚焦、更单一目的、更高质量的新扩展”。
- 必须避免模板化铺货、重复体验、标题党、堆权限、伪功能和不真实素材。
- 必须优先追求**合规、单用途、最小权限、真实可用**。

### 1.4 项目愿景
将 Chrome 扩展从“人工选题 + 人工开发 + 人工发布”的低复用流程，升级为“标准化输入 → 状态机执行 → 结构化输出 → 可审计发布”的自动化生产系统。

---

## 2. 背景与问题

当前市场上存在大量有安装量、有评论、但用户长期抱怨未被解决的 Chrome 扩展。传统做法的问题在于：

1. 机会发现低效：需要人工刷商店、翻评论、看 support 页面和 issue。
2. 需求抽象低质：容易停留在“做个更好的 XX”，而不是抓住一个窄 wedge。
3. 开发复用差：每次都像从零开始，没有标准工件和阶段契约。
4. 合规风险高：一旦权限过大、体验重复、文案不实、素材不真，容易在审核被拒。
5. 发布链断裂：发现、开发、发布、复盘常常在不同系统里，没有统一状态机。

本项目要解决的问题不是“怎么一次性做出一个插件”，而是“怎么每天稳定地做出**一个值得继续推进的机会**，并把高分机会推进到 build-ready、publish-ready 甚至 release-ready 状态”。

---

## 3. 目标与非目标

## 3.1 目标

### G1. 每日发现能力
系统每天至少产出 1 个满足阈值的候选机会，带完整证据链与评分。

### G2. 自动需求收敛
系统能把多源反馈聚类为有限、清晰、可操作的问题簇，并自动收敛为单用途 wedge brief。

### G3. 自动开发与验证
系统能基于 brief 生成真实可安装的 Manifest V3 扩展项目，完成编译、打包和 deterministic QA。

### G4. 自动素材与上架准备
系统能输出图标、截图、promo tile、listing 文案、隐私草案、发布计划等上架所需工件。

### G5. 可审计与可恢复
所有阶段输入输出可落盘、可回放、可重试、可定位失败点。

### G6. 合规优先
系统默认遵守 Chrome Web Store 的 single purpose、最小权限、真实 listing、数据披露与反 spam 要求。

---

## 3.2 非目标

### NG1. 不做竞品代码复制工具
默认不抓取、不反编译、不复用闭源竞品代码。

### NG2. 不做批量铺货系统
系统不以“尽可能多发扩展”为目标，而以“独特、可用、合规的高质量单用途扩展”为目标。

### NG3. 不追求首版 100% 无人值守公开上架
首版以 80% 自动化为目标，对外公开发布保留人工闸门。

### NG4. 不做多浏览器统一平台
v1 仅聚焦 Chrome Web Store 与 MV3。Edge/Firefox 属于后续扩展。

### NG5. 不把所有扩展类型一口气做完
v1 只支持少量 archetype builder，逐步扩展。

---

## 4. 产品定义

### 4.1 产品形态
本项目不是一个面向终端用户的插件，而是一个**内部自动化工厂**，输出物可以是：

- 候选机会报告
- 用户反馈聚类
- 产品 brief
- 实施计划
- 可安装的 Chrome 扩展 repo / dist / zip
- QA 报告
- 素材包与 listing 文案
- 发布计划
- 发布后监控报表

### 4.2 北极星指标
“被人工批准继续推进的高质量机会数量 / 周”。

### 4.3 核心成功指标
- 每天产出至少 1 个高于阈值的机会
- 至少 60% 的入围机会能生成可审阅 brief
- 至少 40% 的 brief 能生成 QA 通过的 build
- 首发公开发布的扩展中，政策拒审率趋近于 0
- 发布后 30 天内，差评主题与原竞品核心抱怨相比明显改善

---

## 5. 目标用户与角色

### 5.1 项目 Owner
定义方向、阈值、品类、品牌与发布策略。

### 5.2 Reviewer / Compliance Approver
审核是否符合单一目的、最小权限、隐私、素材真实性与发布条件。

### 5.3 Release Operator
执行或批准首次 item 创建、灰度放量与回滚。

### 5.4 Codex
本项目的主执行体，负责按阶段产出工件、修改代码、运行检查、修复失败、更新结果。

---

## 6. 设计原则

### P1. Evidence First
必须从公开、可追溯的用户反馈证据出发，而不是凭空想点子。

### P2. Single Purpose First
生成的新扩展必须功能边界窄、易理解、描述清楚。

### P3. Greenfield by Default
实现层默认独立重写，只在许可证清晰、允许复用时复用开源代码。

### P4. Minimum Permissions
没有明确必要性，不申请 host permissions、broad permissions、持续后台能力。

### P5. Deterministic Outputs
能用规则、schema、模板约束的，不依赖自由发挥。

### P6. Every Stage Leaves Artifacts
每个阶段都必须有结构化输出，便于重跑与比较。

### P7. Human Gate Before Public Risk
涉及公开发布、隐私风险、品牌风险的环节必须有人工闸门。

---

## 7. 范围规划

## 7.1 v1 范围
- 发现候选扩展
- 聚合多源反馈
- 聚类 pain points
- 机会评分
- 生成 brief
- 生成 implementation plan
- 生成真实 MV3 项目
- 执行 QA
- 生成 listing assets
- 生成 publish plan
- 生成 post-release monitor plan

## 7.2 v1.5 范围
- 接入更多 archetype builder
- 接入既有 item 更新发布
- 接入 staged publish 与放量策略
- 接入商店评论 / support hub 复盘闭环

## 7.3 v2 范围
- 更强的 portfolio overlap 管理
- 自动实验与 A/B 素材对比
- 多渠道增长闭环
- 多浏览器发布适配
- 人工审批最小化，但不删除高风险闸门

---

## 8. 外部约束与平台假设

1. Chrome Web Store V2 API 适合做服务账号驱动的自动化管理、revision 提交和 staged publish。
2. 首次创建新 item 仍按 Dashboard 的 “Add new item” 流程处理，不能假设“新 item 全自动创建”是稳定主链能力。
3. 开发者公开扩展数量默认存在上限，因此系统目标应是“日更发现与产物，择优发布”，而不是“每天强制公开上架一个新扩展”。
4. 所有扩展必须是 Manifest V3。
5. 对个人或敏感数据的处理必须与单一目的严格绑定。
6. Codex Cloud 默认关闭 agent 互联网访问；需要时必须为不同环境单独配置 allowlist。
7. Codex Cloud 的 secrets 在 agent phase 前会被移除，因此需要长期凭据的发布动作，优先放在 CI runner 或受控脚本中执行，而不是完全依赖 cloud task 内的 agent 直接拿 secret 做发布。

---

## 9. 工作流状态机

统一状态机如下：

`INGEST_TASK -> DISCOVER_CANDIDATES -> ENRICH_FEEDBACK -> CLUSTER_PAIN_POINTS -> SCORE_OPPORTUNITIES -> BUILD_GATE -> WRITE_BRIEF -> PLAN_IMPLEMENTATION -> BUILD_EXTENSION -> RUN_QA -> GENERATE_ASSETS -> RUN_POLICY_GATE -> DECIDE_PUBLISH_INTENT -> PREPARE_LISTING_PACKAGE / EXECUTE_PUBLISH_PLAN -> MONITOR_POST_RELEASE -> CLOSE_RUN`

### 9.1 阶段性原则
- 任一阶段失败，必须写入 `status=failed` 与 `failure_reason`
- 允许 repair run 从最近的有效工件继续
- 不允许 silent skip
- 每个阶段必须有输入契约、输出契约、Definition of Done

---

## 10. 功能需求

## 10.1 INGEST_TASK

### 目标
读取单次运行的任务定义、阈值、允许类目、禁止类目、portfolio registry 与发布策略。

### 输入
- `task.json`
- `portfolio_registry.json`
- `.env` / secrets / runtime config

### 输出
- `00_run_context.json`

### 必备字段
- `run_id`
- `date`
- `allowed_categories`
- `blocked_categories`
- `thresholds`
- `publish.review_strategy`
- `builder.allow_families`
- `asset.locale`
- `brand_rules`

### 验收
- 若任务缺少必填字段，直接 fail
- 所有默认值必须显式补全后落盘

---

## 10.2 DISCOVER_CANDIDATES

### 目标
从 Chrome Web Store 的公开入口中找出一批有安装量、有评论、有明显提升空间的候选扩展。

### 输入
- `00_run_context.json`

### 来源
- Chrome Web Store sitemap / listing 页
- 类目页 / 搜索种子
- 历史 blacklist / overlap registry

### 核心逻辑
- 拉取候选条目
- 提取名称、URL、类目、安装量、评分、评论量、支持站、官网、更新时间等
- 依据阈值初筛
- 排除被 portfolio registry 判定为高度重叠或被 blacklist 命中的条目
- 输出 Top-N 候选池

### 输出
- `10_candidate_report.json`

### 验收
- 至少包含 10 个候选，或明确记录“不足 10 个”的原因
- 每个候选都有证据来源 URL 与抓取时间
- 至少包含一套排序与淘汰原因

---

## 10.3 ENRICH_FEEDBACK

### 目标
为每个候选聚合用户声音，避免只看商店评论。

### 输入
- `10_candidate_report.json`

### 数据来源优先级
1. Chrome Web Store listing 可见信息
2. Support site / 官方帮助站
3. GitHub issues（若存在）
4. FAQ / 文档 / 公开支持页
5. Reddit / 论坛 / 搜索摘要（可选，非硬依赖）

### 处理逻辑
- 提取 complaint / request / breakage / confusion / privacy concern
- 按 source、recency、重复出现频率记录
- 去重、规范化、清洗噪声
- 保留原文片段、URL、时间、来源类型

### 输出
- `20_feedback_evidence.json`

### 验收
- 每个候选至少有 1 个外部非商店证据源，除非明确不存在
- 所有 evidence 都可追溯到 source URL
- 若无有效反馈，必须写明 fallback 依据

---

## 10.4 CLUSTER_PAIN_POINTS

### 目标
把离散反馈压缩成有限问题簇，为 brief 提供输入。

### 输入
- `20_feedback_evidence.json`

### 输出
- `21_feedback_clusters.json`

### 每个 cluster 必须包含
- `cluster_id`
- `title`
- `summary`
- `evidence_count`
- `sources`
- `severity`
- `frequency`
- `fixability`
- `example_quotes`
- `suggested_wedges`

### 聚类要求
- 可重复运行结果尽量稳定
- 同义抱怨合并
- 不把“功能建议”和“故障抱怨”混在同一簇里
- 至少识别：
  - 缺功能
  - 体验问题
  - 权限 / 隐私顾虑
  - 稳定性 / 兼容性问题

### 验收
- 至少产出 3 个 cluster，或写明不满足聚类条件
- 每个 cluster 至少绑定 2 条 evidence，除非样本极少

---

## 10.5 SCORE_OPPORTUNITIES

### 目标
基于需求强度、痛点密度、差异化空间、实现可行性与合规风险，对候选机会进行量化排序。

### 输入
- `10_candidate_report.json`
- `21_feedback_clusters.json`
- `portfolio_registry.json`

### 输出
- `30_opportunity_scores.json`
- `31_selected_candidate.json`

### 评分维度
- `demand_score`
- `pain_score`
- `headroom_score`
- `feasibility_score`
- `compliance_score`
- `portfolio_overlap_score`
- `overall_score`

### 选择规则
- 先过滤低于硬阈值的项
- 在剩余候选中选 overall_score 最高者
- 若第一名的 overlap 过高，则顺延
- 若全部不达标，则本次 run 终止于 `NO_GO_TODAY`

### 验收
- 必须输出所有候选的分项分数
- 必须写出 top1 被选中的理由
- 若未选中任何候选，必须输出终止原因

---

## 10.6 BUILD_GATE

### 目标
在进入 brief 之前做第一次硬闸门。

### 闸门条件
- 达到最低 overall_score
- 至少 3 个可操作 pain clusters
- 与现有 portfolio 不高度重复
- 可抽象为单一目的 wedge
- 预计权限可控制在最小集内

### 输出
- `32_build_gate_decision.json`

### 验收
- 明确写出 `go / no_go`
- 明确列出阻止 build 的因素

---

## 10.7 WRITE_BRIEF

### 目标
把“候选机会 + 抱怨簇”收敛为一个**单用途、可开发**的产品 brief。

### 输入
- `31_selected_candidate.json`
- `21_feedback_clusters.json`
- `32_build_gate_decision.json`

### 输出
- `41_product_brief.json`
- `41_product_brief.md`

### 必填字段
- `product_name_working`
- `wedge_family`
- `single_purpose_statement`
- `target_user`
- `trigger_moment`
- `core_workflow`
- `must_have_features`
- `non_goals`
- `permission_budget`
- `data_handling_summary`
- `ui_surface`
- `success_criteria`
- `positioning`
- `screenshot_angles`
- `listing_summary_seed`

### 关键要求
- 只允许 1 个核心 wedge
- 必须显式写 non-goals
- 必须给出 permission budget
- 必须说明“为什么不是竞品复刻”
- 不得写成“万能插件”

### 验收
- 用一句话即可清楚说明产品价值
- 不阅读上下文，也能理解其单一目的
- 能直接被 build 阶段消费

---

## 10.8 PLAN_IMPLEMENTATION

### 目标
把 brief 翻成工程计划。

### 输入
- `41_product_brief.json`

### 输出
- `42_implementation_plan.json`

### 必填字段
- `archetype`
- `target_manifest_version`
- `module_plan`
- `files_to_generate`
- `permissions`
- `optional_permissions`
- `test_matrix`
- `storage_plan`
- `qa_checks`
- `risk_flags`

### 验收
- 必须映射到已有 builder family，或明确进入 `generic_fallback`
- 文件树、模块职责、测试点必须具体
- 不得出现与 brief 冲突的额外功能

---

## 10.9 BUILD_EXTENSION

### 目标
根据 implementation plan 生成真实、可安装、可编译的 MV3 扩展项目。

### 输入
- `41_product_brief.json`
- `42_implementation_plan.json`

### 输出
- `50_build_report.json`
- `workspace/repo/`
- `workspace/dist/`
- `workspace/package.zip`

### 生成要求
- 生成 `manifest.json`
- 生成必需源码、构建配置和 README
- 生成隐私页 / help 页（若 brief 需要）
- 产物必须可 `Load unpacked`
- 产物必须可 zip 打包

### 工程要求
- TypeScript 优先
- Manifest V3 必须
- 权限只能来自 implementation plan
- 不得生成未声明依赖的“神秘功能”

### 验收
- build 成功
- zip 非空
- manifest 合法
- 目录结构可读
- README 说明可运行方式与权限说明

---

## 10.10 RUN_QA

### 目标
对生成的扩展执行 deterministic QA 与政策前置检查。

### 输入
- `workspace/repo/`
- `workspace/dist/`
- `41_product_brief.json`
- `42_implementation_plan.json`

### 输出
- `60_qa_report.json`

### QA 维度
- manifest 校验
- 权限预算校验
- 构建产物存在性
- popup / options / background / content scripts 引用正确性
- icon 存在性
- 文案一致性
- 关键 happy path 检查
- 与 brief 一致性
- 隐私页存在性（若需要）
- 无明显硬编码密钥
- 无未使用的高风险权限

### 验收
- 必须给出 pass / fail
- 必须给出 failed checks 列表与修复建议
- 失败时允许自动修复一轮，再次 QA

---

## 10.11 GENERATE_ASSETS

### 目标
生成上架与仓库所需的视觉与文案资产。

### 输入
- `41_product_brief.json`
- `50_build_report.json`
- `60_qa_report.json`

### 输出
- `70_listing_assets/`
- `71_listing_copy.json`

### 资产范围
- `icon16.png`
- `icon48.png`
- `icon128.png`
- `promo_440x280.png`
- `promo_1400x560.png`（可选但建议）
- `screenshot_1..5.png`
- `store_summary.txt`
- `store_description.md`
- `privacy_disclosure.md`
- `test_instructions.md`

### 要求
- 截图必须来自真实扩展流程
- promo image 不能只是截图裁切
- 文案必须与真实功能一致
- Summary 必须短、清楚、无堆词

### 验收
- 图像尺寸正确
- 截图数量 ≥1，建议 5
- 所有文案与实际功能一致
- 若需要测试账号或特殊步骤，必须写 test instructions

---

## 10.12 RUN_POLICY_GATE

### 目标
在正式发布前做合规审查。

### 输入
- `41_product_brief.json`
- `60_qa_report.json`
- `71_listing_copy.json`
- `70_listing_assets/`

### 输出
- `72_policy_gate.json`

### 校验项
- single purpose
- 最小权限
- 数据使用与目的绑定
- 是否触及个人 / 敏感数据
- 是否需要 Limited Use 披露
- 是否存在 repetitive content 风险
- 是否存在 misleading listing 风险
- 是否存在 review manipulation / spam 风险
- 截图与功能一致
- 标题不碰瓷、不误导

### 验收
- 必须输出 `pass / conditional_pass / fail`
- `conditional_pass` 必须列出人工确认事项

---

## 10.13 DECIDE_PUBLISH_INTENT

### 目标
决定本次 run 到哪里结束。

### 决策分支
- `draft_only`
- `build_ready`
- `publish_ready`
- `update_existing_item`
- `staged_publish`
- `archive_no_publish`

### 输出
- `80_publish_plan.json`

### 决策依据
- opportunity score
- QA 结果
- policy gate 结果
- 当前 portfolio 结构
- 当周发布预算
- 是否存在可更新的既有 item

---

## 10.14 PREPARE_LISTING_PACKAGE

### 目标
在不真正发布的前提下，准备完整的 dashboard / API 上架包。

### 输出
- `81_listing_package/`

### 内容
- zip
- store listing copy
- privacy copy
- test instructions
- screenshot manifest
- promo asset manifest
- category suggestion
- language / locale notes
- release checklist

---

## 10.15 EXECUTE_PUBLISH_PLAN

### 目标
执行发布动作。

### 发布 lane
1. `prepare_new_item`
   - 首次 item 创建，默认人工或浏览器自动化兜底
2. `update_existing_item`
   - 通过 API 更新既有 item revision
3. `staged_publish`
   - 通过 API 提交 staged publish
4. `rollout_increase`
   - 调整百分比
5. `rollback`
   - 回滚到前一稳定版本

### 输出
- `90_publish_execution.json`

### 原则
- 首发公开发布默认需要人工确认
- 已有 item 的 revision/update 可以自动化
- 所有失败都要留痕，禁止 silent fail

---

## 10.16 MONITOR_POST_RELEASE

### 目标
发布后监控效果，并把结果反馈回 discovery 与 scoring。

### 输入
- `90_publish_execution.json`
- Web Store metrics / support / comments / support hub

### 输出
- `95_monitoring_snapshot.json`
- `96_learning_update.json`

### 指标
- impressions
- installs
- uninstalls
- listing conversion
- average rating
- negative theme changes
- support ticket categories
- crash / bug trend
- rollout health

### 反馈回路
- 更新 blacklist
- 更新 overlap registry
- 更新 archetype priors
- 更新评分权重
- 更新 bad patterns 库

---

## 11. 非功能需求

## 11.1 可恢复性
- 任一阶段失败后可从最近工件恢复
- 不要求从头重跑所有阶段

## 11.2 可观测性
- 每个阶段必须记录：
  - 输入文件
  - 输出文件
  - 开始 / 结束时间
  - 使用模型 / builder
  - 错误摘要

## 11.3 可审计性
- 所有自动决策必须可追溯到 evidence 与规则
- 不允许只输出结论而没有理由

## 11.4 安全性
- 发布凭据不得硬编码进 repo
- CI / 发布阶段必须使用受控 secret 管理
- 发现阶段的联网必须限制域名范围

## 11.5 一致性
- 阶段命名、文件命名、schema key 必须稳定
- 不允许同一含义字段在不同阶段反复改名

## 11.6 性能目标
- 单次离线 dry-run（discovery -> brief -> build -> qa）目标 15 分钟内结束
- 单阶段失败后的 repair run 目标 5 分钟内恢复到下一阶段
- 这些是内部工程目标，不作为用户承诺

---

## 12. 数据契约与标准工件

以下工件为 v1 必备：

1. `00_run_context.json`
2. `10_candidate_report.json`
3. `20_feedback_evidence.json`
4. `21_feedback_clusters.json`
5. `30_opportunity_scores.json`
6. `31_selected_candidate.json`
7. `32_build_gate_decision.json`
8. `41_product_brief.json`
9. `41_product_brief.md`
10. `42_implementation_plan.json`
11. `50_build_report.json`
12. `60_qa_report.json`
13. `70_listing_assets/`
14. `71_listing_copy.json`
15. `72_policy_gate.json`
16. `80_publish_plan.json`
17. `81_listing_package/`
18. `90_publish_execution.json`
19. `95_monitoring_snapshot.json`
20. `96_learning_update.json`

### 工件命名规则
- 两位数前缀表示阶段顺序
- JSON 用于机器消费
- MD 用于人工审阅
- 目录型工件用于素材与打包产物

---

## 13. Codex 执行设计

## 13.1 运行方式

### 本地开发
- 用 Codex CLI 做交互式开发与调试
- 用 `codex` 进入仓库上下文

### 脚本与 CI
- 用 `codex exec` 跑非交互阶段
- 每个 stage 对应一个 prompt file + schema + output path

### 长流程集成
- 用 Codex SDK 在自定义 orchestrator 中控制多轮工程会话
- 适合 `brief -> build -> qa -> fix -> qa` 这类需要连续上下文的链路

### GitHub 自动化
- 用 Codex GitHub Action 承接 PR review、CI 自动修复、批量 exec 任务

---

## 13.2 Codex 职责边界

Codex 可以负责：
- 读取现有工件
- 生成或修改代码
- 运行本地命令
- 生成文档与 JSON 工件
- 执行 lint / test / qa
- 生成图片提示词或图像生产脚本
- 根据规则修复失败

Codex 不应在没有明确授权时做：
- 公开发布新 item
- 暴露或打印凭据
- 引入超出 brief 的功能
- 打开不受限的全网抓取
- 修改 portfolio registry 的人工保护字段
- 伪造截图或伪造用户反馈证据

---

## 13.3 Codex 模型策略

- 主执行模型：`gpt-5.4`
- 轻量子任务：`gpt-5.4-mini`
- 仅在低延迟探索场景下考虑 `gpt-5.3-codex-spark`
- 模型选择必须可配置，不得写死在业务逻辑中

---

## 13.4 环境策略

### Research Environment
用途：`DISCOVER_CANDIDATES`、`ENRICH_FEEDBACK`

要求：
- 开启有限互联网访问
- 域名 allowlist 最小化
- 仅允许必要 HTTP 方法
- 输出原始证据到工件

建议 allowlist：
- `chromewebstore.google.com`
- `developer.chrome.com`
- `github.com`
- `api.github.com`
- 已知 support domain 白名单
- 可选：`www.reddit.com` / 搜索域名（若启用）

### Build Environment
用途：`WRITE_BRIEF`、`PLAN_IMPLEMENTATION`、`BUILD_EXTENSION`、`RUN_QA`

要求：
- 默认关闭 agent 互联网访问
- 只读输入工件，写输出工件
- 依赖通过 setup script 安装

### Publish Environment
用途：`EXECUTE_PUBLISH_PLAN`

要求：
- 优先在 CI runner 或受控服务里执行
- 使用服务账号 / API key
- 与普通 research/build 环境隔离

---

## 13.5 AGENTS.md 要求

仓库根目录必须存在 `AGENTS.md`，内容至少包括：
- 项目目标摘要
- 阶段列表
- 必须先读的工件文件
- lint / test / qa 命令
- 哪些目录可以改
- 哪些目录禁止改
- 发布与 secret 禁令
- 失败时的标准处理方式
- 输出工件落盘要求

---

## 13.6 技能与脚本

建议把重复工作固化成：
- `skills/discovery/`
- `skills/brief/`
- `skills/builder_tab_export/`
- `skills/builder_form_fill/`
- `skills/qa/`
- `skills/assets/`
- `skills/publish/`

每个 skill 至少包含：
- `SKILL.md`
- 可复用脚本
- 输入 / 输出约定
- 常见失败与修复步骤

---

## 14. 架构设计

## 14.1 总体架构

系统分为四层：

### A. Orchestration Layer
负责状态机、重试、调度、人工闸门、运行元数据。
可选实现：
- GitHub Actions（v1 最简）
- n8n（触发 + 通知 + 审批）
- Temporal（长流程、重试、signal）

### B. Research Layer
负责发现、抓取、聚类、评分。

### C. Build Layer
负责 brief、plan、builder、qa、assets。

### D. Release & Learning Layer
负责 publish plan、release、监控、学习反馈。

---

## 14.2 推荐仓库结构

```text
factory/
  AGENTS.md
  README.md
  docs/
    prd.md
    architecture.md
    compliance.md
  prompts/
    discover.md
    enrich.md
    brief.md
    plan.md
    build.md
    qa.md
    assets.md
    publish.md
  schemas/
    run_context.schema.json
    candidate_report.schema.json
    feedback_evidence.schema.json
    feedback_clusters.schema.json
    opportunity_scores.schema.json
    build_gate.schema.json
    product_brief.schema.json
    implementation_plan.schema.json
    build_report.schema.json
    qa_report.schema.json
    listing_copy.schema.json
    policy_gate.schema.json
    publish_plan.schema.json
  scripts/
    daily_run.ts
    discovery_cli.ts
    brief_cli.ts
    build_cli.ts
    qa_cli.ts
    publish_cli.ts
  src/
    orchestrator/
    research/
    brief/
    builders/
      tab_export/
      form_fill/
      gmail_snippet/
    qa/
    assets/
    publish/
    monitor/
  skills/
    discovery/
    brief/
    qa/
  fixtures/
    discovery/
    build/
  runs/
    2026-04-18/
      00_run_context.json
      ...
  .github/workflows/
    daily-factory.yml
    publish-existing-item.yml
```

---

## 15. 发布策略

## 15.1 原则
- 发现与 build 每天可自动跑
- 公开发布不强制每天发生
- 首发创建 item 默认需要人工闸门
- 更新既有 item 可以自动化程度更高

## 15.2 发布模式

### 模式 A：仅草稿
输出 listing package，不执行发布。

### 模式 B：已有 item 更新
针对已存在 item 的 revision 更新与审核提交流程自动化。

### 模式 C：分阶段发布
先提交 staged publish，审核通过后再手动或自动放量。

### 模式 D：回滚
当监控指标恶化时自动生成 rollback plan，人工批准后执行。

---

## 15.3 首发 item 策略
v1 中，首次上架遵循以下规则：
1. Codex 生成完整 listing package
2. 人工确认品牌、隐私、截图真实性
3. 通过 Dashboard 或受控浏览器自动化上传
4. 审核通过后进入监控

---

## 16. 合规与隐私要求

## 16.1 Single Purpose
所有输出扩展必须可被一句话准确描述，且功能边界狭窄、易懂。

## 16.2 Minimum Permissions
权限必须和 single purpose 一一对应。

## 16.3 数据使用
- 只能为描述中的单一目的收集和使用数据
- 禁止与主功能无关的数据用途
- 个人 / 敏感数据场景必须触发额外披露要求

## 16.4 Listing Truthfulness
- 标题、摘要、描述、截图必须真实
- 截图必须展示实际用户体验
- 不得承诺不存在的功能

## 16.5 Anti-Spam
- 禁止刷量、激励评论、虚假评价
- 禁止批量发布高度重复扩展
- 禁止把 portfolio 当模板变体农场

## 16.6 Limited Use 场景
若扩展请求或处理个人 / 敏感数据，必须：
- 在项目主页或隐私页提供 Limited Use 披露
- 将数据用途绑定到 single purpose
- 对非核心用途额外披露并征得同意

---

## 17. Builder 策略

## 17.1 Archetype-first
v1 不追求“万能 builder”，优先支持少量高质量 archetype。

### 初始 archetype
- `tab_csv_window_export`
- `single_profile_form_fill`
- `gmail_snippet`（规划中）

## 17.2 Generic Fallback
当 brief 无法映射到现有 archetype 时：
- 可产出 implementation plan
- 允许输出 `build_blocked_by_missing_builder`
- 不强行生成低质量项目

## 17.3 Builder Definition of Done
一个 builder 被视为“完成”，需满足：
- 能消费标准 brief / plan
- 能生成真实 MV3 项目
- 能产出 dist / zip
- 有至少一套 deterministic QA
- 至少一个 fixture E2E 通过

---

## 18. QA 策略

## 18.1 QA 层次
1. Static QA：manifest、权限、文件存在性
2. Functional QA：核心 happy path
3. Policy QA：single purpose、listing 一致性、隐私披露
4. Asset QA：尺寸、数量、真实性
5. Release QA：可打包、可提交、可回滚

## 18.2 QA 输出
必须以结构化 JSON 输出：
- `checks_passed`
- `checks_failed`
- `warnings`
- `repair_suggestions`
- `overall_status`

## 18.3 自动修复策略
- 第一次 QA fail 后允许一次 Codex 自动修复
- 第二次仍 fail，则停止并进入人工审阅

---

## 19. 运营与监控

## 19.1 发布后监控周期
- T+1：安装/卸载/错误初检
- T+3：差评主题 / support 工单
- T+7：转化率 / 保留
- T+30：是否保留 / 合并 / 下架 / 再迭代

## 19.2 监控输出动作
- 放量
- 暂停
- 回滚
- 进入下一轮 brief 迭代
- 更新 archetype 经验库

---

## 20. 里程碑

## M1：发现链可运行
范围：
- ingest
- discovery
- enrich
- cluster
- score
- select

完成标准：
- 每天稳定产出一个选中候选或 no-go 结论

## M2：brief 链可运行
范围：
- build gate
- brief
- implementation plan

完成标准：
- 选中候选可自动产出 build-ready brief

## M3：单 archetype build 链可运行
范围：
- build
- qa

完成标准：
- 至少 1 个 archetype 可生成真实 MV3 产物

## M4：双 archetype build 链可运行
完成标准：
- 至少 2 个 archetype E2E 跑通

## M5：assets 与 policy gate 可运行
完成标准：
- 能输出上架包并通过内部政策检查

## M6：发布 lane 接通
完成标准：
- 已有 item 更新可自动化
- 首发 item 有半自动上架通道

## M7：monitor 闭环
完成标准：
- 发布后指标可自动回写 learning update

---

## 21. 风险与缓解

### R1. 发现质量低
缓解：
- 引入 blacklist、source weighting、类目白名单
- 提高 evidence 最低要求

### R2. brief 太宽
缓解：
- 强制 single-purpose statement
- 强制 non-goals
- build gate 前设 wedge 审核

### R3. build 质量不稳定
缓解：
- archetype-first
- deterministic templates
- generic fallback 不强做

### R4. 政策被拒
缓解：
- 提前 policy gate
- 素材真实性检查
- 数据披露模板

### R5. 发布 secret 泄露
缓解：
- 将发布动作放入受控 runner
- secret 不进入 agent phase

### R6. Codex 过度联网或被 prompt injection
缓解：
- research env allowlist
- build env 断网
- 仅信任明确白名单域名
- 保存 work log 审核

### R7. portfolio 越做越重复
缓解：
- overlap registry
- family caps
- 相似 wedge 限额

---

## 22. Open Questions

1. `gmail_snippet` builder 的 UI surface 是否统一用 popup，还是拆 content script + compose helper？
2. 首次 item 创建是长期保留人工，还是后续引入浏览器自动化兜底？
3. 监控指标里是否要接 Google Analytics，还是仅使用 Web Store metrics 与内部事件？
4. 哪些类目列入长期禁区，例如高敏感数据、未成年人、医疗、金融建议等？

---

## 23. 验收标准（项目级）

当且仅当以下条件全部满足，v1 视为完成：

1. 从 `task.json` 启动一次 run，可跑到 `80_publish_plan.json` 或明确 `NO_GO_TODAY`
2. 至少 2 个 archetype builder 能稳定生成真实 MV3 工程
3. discovery -> brief -> build -> qa 全链路至少 5 次 fixture run 成功
4. 资产与 listing 输出可供人工直接上架
5. 发布 lane 至少支持“已有 item 更新”自动化
6. 所有阶段都有 JSON 工件
7. 任何失败都可定位到 stage 和 failure_reason
8. 没有把 secret 写进 repo 或输出日志
9. policy gate 覆盖 single purpose、最小权限、数据披露、素材真实性
10. 文档、schema、AGENTS.md、CLI 命令一致

---

## 24. Codex 启动指令附录

以下内容建议作为仓库根目录 `README` 或 `AGENTS.md` 中的启动提示：

### 24.1 Codex 总规则
- 先读 `docs/prd.md`
- 再读 `AGENTS.md`
- 再读最新一次 `runs/<date>/` 工件
- 仅在允许的目录中写文件
- 每个阶段结束都要落盘
- 不得伪造 evidence
- 不得跳过 QA 与 policy gate

### 24.2 推荐命令模式
```bash
# 交互模式
codex

# 单阶段
codex exec "Run DISCOVER_CANDIDATES using prompts/discover.md and write runs/$RUN_ID/10_candidate_report.json"

# CI 中的连续任务
codex exec "Read docs/prd.md and AGENTS.md, then run BUILD_EXTENSION for the selected candidate"
```

### 24.3 推荐运行顺序
1. `DISCOVER_CANDIDATES`
2. `ENRICH_FEEDBACK`
3. `CLUSTER_PAIN_POINTS`
4. `SCORE_OPPORTUNITIES`
5. `BUILD_GATE`
6. `WRITE_BRIEF`
7. `PLAN_IMPLEMENTATION`
8. `BUILD_EXTENSION`
9. `RUN_QA`
10. `GENERATE_ASSETS`
11. `RUN_POLICY_GATE`
12. `DECIDE_PUBLISH_INTENT`

---

## 25. 首版 task.json 示例

```json
{
  "run_id": "2026-04-18-daily-001",
  "date": "2026-04-18",
  "allowed_categories": ["Productivity", "Developer Tools", "Workflow & Planning"],
  "blocked_categories": ["Shopping", "Crypto", "VPN", "Security", "Children"],
  "thresholds": {
    "min_users": 10000,
    "min_reviews": 100,
    "rating_min": 3.8,
    "rating_max": 4.6,
    "min_negative_clusters": 3,
    "min_overall_score": 70
  },
  "builder": {
    "allow_families": [
      "tab_csv_window_export",
      "single_profile_form_fill",
      "gmail_snippet"
    ]
  },
  "publish": {
    "review_strategy": "manual_for_new_item_api_for_existing_item",
    "allow_public_release": false,
    "default_publish_intent": "draft_only"
  },
  "assets": {
    "locale": "en-US",
    "screenshots_target": 5
  },
  "brand_rules": {
    "tone": "clear, practical, non-hype",
    "forbid_competitor_name_in_title": true
  }
}
```

---

## 26. 参考实现建议

### 26.1 首版最小实现
- GitHub Actions 作为调度壳
- `codex exec` 作为单阶段执行器
- Node.js / TypeScript 作为主语言
- JSON schema 做阶段契约
- 本地 fixtures 保障离线测试
- 仅对 research env 开有限互联网访问

### 26.2 第二阶段增强
- 引入 Codex SDK，持续控制 `brief -> build -> qa -> fix`
- 引入 Temporal 处理长流程与人工 signal
- 引入更严格的 policy evaluators
- 引入第三个 archetype builder

---

## 27. 最终结论

这是一个“以用户抱怨为输入、以单用途合规扩展为输出”的自动化工厂项目，而不是简单的插件生成器。  
首版成功的关键，不是追求每天公开发布，而是先把以下链路稳定下来：

**发现真实机会 → 收敛单用途 wedge → 生成真实 MV3 项目 → 通过 QA 与政策闸门 → 输出可上架包 → 择优发布 → 回写经验**

只有当这条链路稳定、可审计、可恢复之后，才值得逐步提高自动化比例。

---