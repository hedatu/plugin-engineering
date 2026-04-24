# 开发审计与优先级

本文完成两件事：

1. 把 PRD 拆成“当前已定义模块、待实现模块、开发优先级”。
2. 反推当前仓库缺哪些文件和代码骨架，并标注本次已补内容。

## 1. PRD 已定义模块

### Research Layer
- `INGEST_TASK`
- `DISCOVER_CANDIDATES`
- `ENRICH_FEEDBACK`
- `CLUSTER_PAIN_POINTS`
- `SCORE_OPPORTUNITIES`
- `BUILD_GATE`

### Product / Build Layer
- `WRITE_BRIEF`
- `PLAN_IMPLEMENTATION`
- `BUILD_EXTENSION`
- `RUN_QA`
- `GENERATE_ASSETS`
- `RUN_POLICY_GATE`

### Release / Learning Layer
- `DECIDE_PUBLISH_INTENT`
- `PREPARE_LISTING_PACKAGE`
- `EXECUTE_PUBLISH_PLAN`
- `MONITOR_POST_RELEASE`

### Cross-cutting
- JSON artifact contracts
- deterministic QA
- permission budget checks
- policy gate
- run recovery
- artifact audit trail
- human gate before public release

## 2. 当前仓库初始缺口

本次开发前，仓库只有两份 Markdown 文档，缺少以下工程基础：

- `AGENTS.md`
- `README.md`
- `package.json`
- runnable CLI
- workflow stage implementation
- builder registry
- working archetype builders
- QA runner
- listing asset generator
- policy gate
- fixture task
- fixture candidates
- fixture feedback evidence
- standard `runs/` output structure
- schema directory

## 3. 本次已补工程骨架

- 项目入口：`package.json`
- Codex 执行规则：`AGENTS.md`
- 本地说明：`README.md`
- 默认任务：`fixtures/tasks/daily_task.json`
- live 任务：`fixtures/tasks/daily_task_live.json`
- tab 任务：`fixtures/tasks/daily_task_tab_export.json`
- gmail 任务：`fixtures/tasks/daily_task_gmail_snippet.json`
- 候选池 fixture：`fixtures/discovery/candidates.json`
- 用户反馈 fixture：`fixtures/research/feedback_evidence.json`
- 主工作流 CLI：`scripts/daily_run.mjs`
- 单独 build CLI：`scripts/build_cli.mjs`
- 单独 QA CLI：`scripts/qa_cli.mjs`
- workflow stages：`src/workflow/stages.mjs`
- workflow runner：`src/workflow/runDailyWorkflow.mjs`
- live research adapter：`src/research/liveResearch.mjs`
- builder registry：`src/builders/index.mjs`
- tab export builder：`src/builders/tabCsvWindowExport.mjs`
- form fill builder：`src/builders/singleProfileFormFill.mjs`
- gmail snippet builder：`src/builders/gmailSnippet.mjs`
- utility helpers：`src/utils/`
- initial schemas：`schemas/`

## 4. 开发优先级

### P0 - 已在本次实现
- 离线 workflow 可从 `task.json` 跑到 `80_publish_plan.json`。
- 三个 archetype builder 可生成真实 MV3 draft package。
- QA 能检查 manifest、权限、文件引用、隐私页、zip、listing copy。
- live discovery 已有 best-effort adapter，并会把 sitemap、search、listing、support、GitHub 和 fallback 记录到 `09_live_research_report.json`。

### P1 - 下一步最值得做
- 扩展 live research adapter：补更稳的 listing 指标解析、支持站主题抽取和更精细的 source weighting。
- 用 JSON Schema validator 强校验每个 artifact。
- 增加 repair-run 入口，从任意 stage 继续。

### P2 - 发布准备
- 生成 `81_listing_package/`。
- 接入已有 item 的 Chrome Web Store API 更新发布 lane。
- 将 publish secrets 放在受控 CI runner。
- 增加真实浏览器截图生成。

### P3 - 复盘闭环
- 接 Web Store metrics。
- 接 support hub / comments。
- 输出 `95_monitoring_snapshot.json` 与 `96_learning_update.json`。

## 5. 当前最小剩余阻塞

- 已接入 best-effort live research；当前 Chrome Web Store 仍依赖 PowerShell fallback，且少数 live run 可能因为指标不足或网络波动回退到 fixture。
- listing screenshots 是 draft validation asset，不是真浏览器截图。
- source weighting、发布执行、监控闭环尚未实现。
