import { storageGet, storageSet } from "./storage.js";

export const LANGUAGE_KEY = "transcript_md_language";

export const messages = {
  en: {
    productName: "Transcript to Markdown Studio",
    popupTitle: "Turn transcripts into Markdown articles.",
    popupSubtitle: "Local-only conversion for SRT, VTT, and TXT files. No upload.",
    openConverter: "Open Studio",
    upgrade: "Upgrade",
    freeUses: "Free conversions left",
    proActive: "Pro active",
    localOnly: "Local-only. No upload.",
    converterTitle: "Transcript to Markdown",
    converterSubtitle: "Drop SRT, VTT, or TXT transcripts and turn them into clean Markdown articles, notes, outlines, or minutes.",
    transcriptFiles: "Transcript files",
    transcriptHelp: "Choose one or more .srt, .vtt, or .txt files",
    videoFile: "Optional video preview",
    videoHelp: "Video stays local and is only used for preview or filename context.",
    outputType: "Output type",
    articleDraft: "Article draft",
    obsidianNote: "Obsidian note",
    timestampedNotes: "Timestamped notes",
    blogOutline: "Blog outline",
    meetingMinutes: "Meeting minutes",
    settings: "Settings",
    paragraphDensity: "Paragraph density",
    compact: "Compact",
    balanced: "Balanced",
    spacious: "Spacious",
    keepTimestamps: "Keep section timestamps",
    includeFrontmatter: "Add Markdown metadata",
    convert: "Convert to Markdown",
    copy: "Copy Markdown",
    download: "Download .md",
    preview: "Markdown preview",
    emptyPreview: "Choose transcript files and convert them to preview Markdown here.",
    noTranscript: "Choose at least one SRT, VTT, or TXT file first.",
    unsupportedFile: "Only SRT, VTT, and TXT transcript files are supported in this version.",
    parsed: "Parsed {files} file(s) and {count} transcript items into {paragraphs} Markdown sections.",
    copied: "Markdown copied.",
    downloaded: "Markdown downloaded.",
    quotaUsed: "Free conversion used. {left} left.",
    paywallTitle: "Free conversions used",
    paywallBody: "You have used your 10 free conversions. Upgrade for unlimited local transcript-to-Markdown conversion.",
    openPricing: "Open pricing",
    optionsTitle: "Transcript to Markdown settings",
    language: "Language",
    saveSettings: "Save settings",
    settingsSaved: "Settings saved.",
    malformedWarning: "Some transcript blocks were skipped because they were malformed.",
    ready: "Ready."
  },
  zh: {
    productName: "转录稿转 Markdown 工作台",
    popupTitle: "把字幕和转录稿整理成 Markdown 文章。",
    popupSubtitle: "本地转换 SRT、VTT、TXT 文件，不上传。",
    openConverter: "打开工作台",
    upgrade: "升级",
    freeUses: "剩余免费转换",
    proActive: "Pro 已开通",
    localOnly: "本地处理，不上传。",
    converterTitle: "转录稿转 Markdown",
    converterSubtitle: "导入 SRT、VTT 或 TXT 转录稿，整理成文章、笔记、大纲或会议纪要。",
    transcriptFiles: "转录稿文件",
    transcriptHelp: "选择一个或多个 .srt、.vtt、.txt 文件",
    videoFile: "可选视频预览",
    videoHelp: "视频只在本地预览或辅助文件名，不上传、不转码。",
    outputType: "输出类型",
    articleDraft: "文章草稿",
    obsidianNote: "Obsidian 笔记",
    timestampedNotes: "带时间戳笔记",
    blogOutline: "博客大纲",
    meetingMinutes: "会议纪要",
    settings: "设置",
    paragraphDensity: "段落密度",
    compact: "紧凑",
    balanced: "均衡",
    spacious: "宽松",
    keepTimestamps: "保留章节时间戳",
    includeFrontmatter: "添加 Markdown 元数据",
    convert: "转换为 Markdown",
    copy: "复制 Markdown",
    download: "下载 .md",
    preview: "Markdown 预览",
    emptyPreview: "选择转录稿文件并转换后，这里会显示 Markdown。",
    noTranscript: "请先选择至少一个 SRT、VTT 或 TXT 文件。",
    unsupportedFile: "当前版本只支持 SRT、VTT、TXT 转录稿文件。",
    parsed: "已解析 {files} 个文件、{count} 条内容，生成 {paragraphs} 个 Markdown 段落。",
    copied: "Markdown 已复制。",
    downloaded: "Markdown 已下载。",
    quotaUsed: "已使用 1 次免费转换，还剩 {left} 次。",
    paywallTitle: "免费次数已用完",
    paywallBody: "你已经用完 10 次免费转换。升级后可无限进行本地转录稿转 Markdown。",
    openPricing: "打开价格页",
    optionsTitle: "转录稿转 Markdown 设置",
    language: "语言",
    saveSettings: "保存设置",
    settingsSaved: "设置已保存。",
    malformedWarning: "部分转录块格式异常，已跳过。",
    ready: "已准备好。"
  }
};

export async function getLanguage() {
  const stored = await storageGet([LANGUAGE_KEY]);
  const language = stored[LANGUAGE_KEY];
  return language === "zh" ? "zh" : "en";
}

export async function setLanguage(language) {
  await storageSet({ [LANGUAGE_KEY]: language === "zh" ? "zh" : "en" });
}

export function t(language, key, params = {}) {
  const template = messages[language]?.[key] ?? messages.en[key] ?? key;
  return Object.entries(params).reduce((text, [name, value]) => {
    return text.replaceAll(`{${name}}`, `${value}`);
  }, template);
}

export function applyI18n(language, root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(language, node.dataset.i18n);
  }
  for (const node of root.querySelectorAll("[data-i18n-title]")) {
    node.title = t(language, node.dataset.i18nTitle);
  }
}
