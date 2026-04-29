# SRT to Markdown Article 插件设计方案

日期：2026-04-29  
项目：Chrome Extension Opportunity Factory / HWH 插件商城  
插件阶段：Product Design Draft  
建议英文名：SRT to Markdown Article  
建议中文名：字幕转 Markdown 文章  

## 1. 一句话定义

一个本地优先的 Chrome 插件：用户上传 `.srt` 字幕文件，可选上传对应视频文件用于本地预览和标题辅助，插件把字幕清洗、合并、分段，并导出为可复制、可下载的 Markdown 文章草稿。

## 2. 为什么这个插件值得做

这个需求适合从 skill / workflow 派生为插件，原因很清楚：

- 输入明确：SRT 字幕文件，必要时加视频文件。
- 输出明确：Markdown 文章。
- 用户场景明确：视频笔记、课程整理、播客转文章、自媒体素材沉淀、Obsidian / Notion 知识库。
- 插件权限可以非常低：不需要 host permissions，不需要读取网页，不需要第三方账号。
- 第一版可以完全本地处理，隐私边界清楚。
- 商业化边界也清楚：免费转换次数或文件长度限制，付费解锁长字幕和批量处理。

## 3. 核心用户

### 3.1 主要用户

- 用 Obsidian / Notion 做知识库的人。
- 把视频课程整理成文章或笔记的人。
- 自媒体运营，把视频字幕整理成公众号、博客或小红书草稿的人。
- 播客 / 访谈内容整理者。
- 研究型用户，需要把长视频信息沉淀为结构化笔记。

### 3.2 不是优先用户

- 需要从视频里自动识别语音的人。
- 需要专业字幕编辑器的人。
- 需要复杂剪辑、转码、时间轴校准的人。
- 需要团队协作云端字幕库的人。

## 4. 产品定位

这个插件不做“视频处理平台”，只做一个单用途工具：

> 把已有字幕文件变成更好阅读、更好保存、更适合知识库的 Markdown 文章。

第一版重点是字幕清洗和结构化，不做视频转文字。

## 5. MVP 范围

### 5.1 必须做

1. 上传 `.srt` 文件。
2. 解析 SRT 序号、时间轴和字幕文本。
3. 清洗字幕：
   - 去掉序号。
   - 可选去掉时间轴。
   - 合并断行。
   - 去掉重复空格。
   - 处理简单重复字幕。
4. 自动分段：
   - 按时间间隔分段。
   - 按标点和句长分段。
   - 长段落自动拆分。
5. 输出 Markdown：
   - 标题。
   - 简介占位。
   - 正文段落。
   - 可选保留章节时间戳。
6. 一键复制 Markdown。
7. 下载 `.md` 文件。
8. 本地处理说明：
   - No upload.
   - Local processing.
   - Your subtitle file stays in the browser.
9. 中英文界面。
10. 免费使用限制：
   - 10 次免费转换。
   - 超过后显示升级按钮。
11. 升级按钮跳 HWH 插件商城对应 pricing 页面。

### 5.2 可以做，但不放第一版核心

1. 上传视频文件作为可选辅助：
   - 本地预览视频。
   - 读取视频文件名。
   - 读取浏览器可获得的 duration。
   - 不上传视频。
   - 不转码。
   - 不从视频提取音频。
2. 模板选择：
   - Article draft。
   - Obsidian note。
   - Timestamped notes。
   - Transcript clean-up。
3. Markdown frontmatter。
4. 自动生成目录。

### 5.3 第一版明确不做

1. 不做视频转文字。
2. 不做 ASR。
3. 不做云端上传。
4. 不做团队协作。
5. 不做自动发布到博客 / Notion / Obsidian。
6. 不做批量视频处理。
7. 不持有任何 AI API key。
8. 不持有 Waffo secret。
9. 不持有 Supabase service role。

## 6. 用户流程

### 6.1 免费用户流程

1. 打开插件。
2. 点击 `Open Converter`。
3. 上传 `.srt` 文件。
4. 可选上传视频文件用于本地预览。
5. 选择输出模式。
6. 点击 `Convert to Markdown`。
7. 预览 Markdown。
8. 点击 `Copy` 或 `Download .md`。
9. 免费转换次数减少 1。
10. 第 11 次显示升级提示。

### 6.2 付费用户流程

1. 用户点击 `Upgrade`。
2. 跳到 HWH 插件商城该插件 pricing 页。
3. 网站登录 / checkout。
4. Waffo 完成付款。
5. webhook 写 entitlement。
6. 插件 `REFRESH_ENTITLEMENT`。
7. entitlement active 后解锁 unlimited conversions。

## 7. 页面结构

### 7.1 Popup

功能：

- 显示产品名。
- 显示免费剩余次数。
- 按钮：`Open Converter`。
- 按钮：`Upgrade`。
- 状态：Free / Pro。
- 隐私提示：Local-only, no upload。

建议文案：

英文：

- `Turn subtitles into Markdown articles.`
- `10 free conversions.`
- `Local-only. No upload.`

中文：

- `把字幕整理成 Markdown 文章。`
- `10 次免费转换。`
- `本地处理，不上传。`

### 7.2 Converter Page

结构：

1. Header
   - 产品名。
   - Free / Pro 状态。
   - Language switch。
2. Upload area
   - SRT file dropzone。
   - Optional video file dropzone。
3. Settings
   - Output type。
   - Keep timestamps。
   - Paragraph density。
   - Markdown frontmatter。
4. Preview
   - Markdown 输出预览。
5. Actions
   - Convert。
   - Copy Markdown。
   - Download `.md`。
6. Upgrade card
   - 只在免费额度用完时出现。

### 7.3 Options Page

第一版可以很轻：

- 默认语言。
- 默认输出模板。
- 是否保留 timestamps。
- 是否添加 frontmatter。

### 7.4 Paywall

触发条件：

- 免费转换次数超过 10。

显示内容：

- `You have used your 10 free conversions.`
- `Upgrade for unlimited subtitle-to-Markdown conversion.`
- `Local processing remains the same.`
- `Upgrade` 按钮跳网站 pricing 页。

## 8. 输出格式设计

### 8.1 Article Draft

```markdown
# {Title}

> Source: {filename}
> Converted: {date}

## Summary

Write a short summary here.

## Article

Paragraph one...

Paragraph two...
```

### 8.2 Obsidian Note

```markdown
---
source: "{filename}"
type: "video-note"
created: "{date}"
---

# {Title}

## Notes

...
```

### 8.3 Timestamped Notes

```markdown
# {Title}

## 00:00:00

Paragraph...

## 00:03:20

Paragraph...
```

## 9. SRT 解析逻辑

### 9.1 输入示例

```text
1
00:00:01,000 --> 00:00:03,000
Welcome to this tutorial.

2
00:00:03,500 --> 00:00:05,000
Today we will talk about...
```

### 9.2 内部结构

```json
{
  "index": 1,
  "startMs": 1000,
  "endMs": 3000,
  "text": "Welcome to this tutorial."
}
```

### 9.3 分段规则

默认规则：

- 如果两个字幕之间间隔超过 1800ms，允许分段。
- 如果合并文本超过 450 字符，尝试在句号、问号、感叹号处分段。
- 如果没有标点，按长度保守分段。
- 连续重复字幕只保留一次。

### 9.4 清洗规则

- 去掉字幕序号。
- 统一换行。
- 去掉多余空格。
- 合并单字幕内多行。
- 保留中英文标点。
- 不改写原意。

## 10. 权限设计

### 10.1 MVP 权限

建议只用：

```json
{
  "permissions": ["storage"]
}
```

原因：

- 文件通过用户主动选择，不需要 file system permission。
- 下载可以用 Blob + anchor，不需要 `downloads` 权限。
- 不读取网页，不需要 `activeTab`。
- 不注入脚本，不需要 `scripting`。
- 不访问外部 API，不需要 host permissions。

### 10.2 后续可选权限

如果以后要支持“从当前视频网站读取标题/页面链接”，再考虑：

```json
{
  "permissions": ["activeTab", "scripting"]
}
```

但不建议第一版就加。

## 11. 数据与隐私边界

### 11.1 本地数据

插件本地保存：

- 免费转换次数。
- 用户偏好设置。
- 最近一次输出模板。
- entitlement cache。

不保存：

- 原始视频文件。
- 原始 SRT 文件内容。
- 完整转换历史。

### 11.2 不上传

第一版承诺：

- 不上传视频。
- 不上传字幕。
- 不做云同步。
- 不把字幕内容发送到第三方 AI。

如果未来做 AI polish，必须作为网站端可选功能，并明确提示上传行为。

## 12. 会员与付费设计

### 12.1 Free

- 10 次转换。
- 单文件。
- 基础 Markdown 输出。
- 本地处理。

### 12.2 Pro

- Unlimited conversions。
- 更长字幕。
- 多模板。
- Obsidian frontmatter。
- Timestamped notes。
- 批量 SRT 处理可以作为后续 Pro 功能。

### 12.3 推荐定价

初期建议：

- Lifetime：$19

如果后续功能增加到批量处理 / AI polish，可以再引入：

- Monthly：$9
- Annual：$29
- Lifetime：$39.9

### 12.4 支付安全边界

- 插件 Upgrade 跳网站 pricing 页。
- 插件不直接打开 Waffo 裸链接。
- 插件不持有 Waffo secret。
- 插件不持有 Supabase service role。
- success page 不本地开会员。
- webhook 是 entitlement active 唯一依据。

## 13. 技术架构

### 13.1 文件结构建议

```text
extension/
  manifest.json
  popup.html
  popup.css
  popup.js
  converter.html
  converter.css
  converter.js
  options.html
  options.js
  src/
    i18n.js
    srtParser.js
    markdownRenderer.js
    paragraphBuilder.js
    quotaStore.js
    entitlementClient.js
    upgradeUrl.js
    download.js
```

### 13.2 核心模块

`srtParser.js`

- parse SRT blocks。
- convert timestamps。
- handle malformed blocks。

`paragraphBuilder.js`

- merge captions。
- split paragraphs。
- deduplicate repeated text。

`markdownRenderer.js`

- render article draft。
- render Obsidian note。
- render timestamped notes。

`quotaStore.js`

- track free conversions。
- store settings。

`entitlementClient.js`

- refresh membership。
- read active / free / invalid states。

`upgradeUrl.js`

- build website pricing URL。

## 14. Builder 策略

不建议第一步就扩展通用 builder。

建议顺序：

1. 先做单插件实现。
2. QA 通过后再沉淀 builder family。
3. 如果后面还会做更多“文件转换类插件”，再新增：
   - `local_file_transformer`
   - 或 `subtitle_markdown_transformer`

原因：

- 当前需求还需要验证真实用户付费意愿。
- 过早 builder 化会增加平台复杂度。

## 15. Chrome Web Store 审核风险

低风险点：

- 权限少。
- 本地处理。
- 单用途清楚。
- 不读取网页内容。
- 不抓取平台数据。
- 不涉及版权下载。

需要注意：

- 文案不能暗示可以绕过平台限制下载字幕。
- 不要声称支持所有视频平台。
- 不要写“自动生成高质量文章”这种夸大承诺。
- 如果支持上传视频，也必须写清楚视频不上传、不转码、不识别语音。

## 16. 网站页面设计

插件商城需要新增：

- `/products/srt-to-markdown-article`
- `/products/srt-to-markdown-article/pricing`

详情页重点：

- 把 SRT 字幕转成 Markdown 文章。
- 本地处理，不上传。
- 适合视频笔记、课程整理、知识库。
- 免费 10 次转换。
- Pro 解锁无限转换。

价格页重点：

- Free：10 conversions。
- Lifetime：unlimited conversions。
- No upload。
- No cloud sync。

## 17. MVP 验收标准

必须通过：

- 能解析标准 SRT。
- 能处理基本异常 SRT。
- 能输出 Markdown。
- 能复制 Markdown。
- 能下载 `.md`。
- 免费次数能记录。
- 第 11 次触发 paywall。
- Upgrade URL 指向网站 pricing 页。
- 无 host permissions。
- 无 service role / Waffo secret / merchant secret。
- 中英文 UI 可切换。

## 18. 第一轮开发建议

第一轮只做：

1. popup。
2. converter page。
3. SRT parser。
4. Markdown renderer。
5. local quota。
6. copy/download。
7. bilingual UI。
8. upgrade URL。

不做：

- 视频解析。
- AI 改写。
- 批量处理。
- 网站支付正式接入。
- Chrome upload。

## 19. 推荐下一步

下一步可以创建一个新的 design candidate run：

```powershell
npm run discovery:record-manual-evidence -- --candidate srt-to-markdown-article --source "manual_skill_to_extension_idea" --note "User requested a Chrome extension that converts SRT subtitles and optional video context into Markdown article drafts."
```

然后进入：

1. product brief。
2. implementation plan。
3. prototype build。
4. QA。
5. website product page。
6. human review。

建议先不要 upload / publish，先做本地可安装原型。

