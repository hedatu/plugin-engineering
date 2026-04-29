import { storageGet, storageSet } from "./storage.js";

export const LANGUAGE_KEY = "srt_md_language";

export const messages = {
  en: {
    productName: "SRT to Markdown Article",
    popupTitle: "Turn subtitles into Markdown articles.",
    popupSubtitle: "Local-only conversion for SRT files. No upload.",
    openConverter: "Open Converter",
    upgrade: "Upgrade",
    freeUses: "Free conversions left",
    proActive: "Pro active",
    localOnly: "Local-only. No upload.",
    converterTitle: "Convert SRT to Markdown",
    converterSubtitle: "Upload an SRT file, clean the transcript, and export a Markdown article draft.",
    srtFile: "SRT subtitle file",
    videoFile: "Optional video preview",
    videoHelp: "Video stays local and is only used for preview or filename context.",
    outputType: "Output type",
    articleDraft: "Article draft",
    obsidianNote: "Obsidian note",
    timestampedNotes: "Timestamped notes",
    settings: "Settings",
    paragraphDensity: "Paragraph density",
    compact: "Compact",
    balanced: "Balanced",
    spacious: "Spacious",
    keepTimestamps: "Keep section timestamps",
    includeFrontmatter: "Add Markdown frontmatter",
    convert: "Convert to Markdown",
    copy: "Copy Markdown",
    download: "Download .md",
    preview: "Markdown preview",
    emptyPreview: "Upload an SRT file and convert it to preview Markdown here.",
    noSrt: "Upload an SRT file first.",
    parsed: "Parsed {count} captions into {paragraphs} Markdown sections.",
    copied: "Markdown copied.",
    downloaded: "Markdown downloaded.",
    quotaUsed: "Free conversion used. {left} left.",
    paywallTitle: "Free conversions used",
    paywallBody: "You have used your 10 free conversions. Upgrade for unlimited local subtitle-to-Markdown conversion.",
    openPricing: "Open pricing",
    optionsTitle: "SRT to Markdown settings",
    language: "Language",
    saveSettings: "Save settings",
    settingsSaved: "Settings saved.",
    malformedWarning: "Some subtitle blocks were skipped because they were malformed.",
    ready: "Ready."
  },
  zh: {
    productName: "字幕转 Markdown 文章",
    popupTitle: "把字幕整理成 Markdown 文章。",
    popupSubtitle: "本地转换 SRT 字幕，不上传。",
    openConverter: "打开转换器",
    upgrade: "升级",
    freeUses: "剩余免费转换",
    proActive: "Pro 已开通",
    localOnly: "本地处理，不上传。",
    converterTitle: "SRT 转 Markdown",
    converterSubtitle: "上传 SRT 字幕，清洗转写内容，并导出 Markdown 文章草稿。",
    srtFile: "SRT 字幕文件",
    videoFile: "可选视频预览",
    videoHelp: "视频只在本地预览或辅助文件名，不上传、不转码。",
    outputType: "输出类型",
    articleDraft: "文章草稿",
    obsidianNote: "Obsidian 笔记",
    timestampedNotes: "带时间戳笔记",
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
    emptyPreview: "上传 SRT 文件并转换后，这里会显示 Markdown。",
    noSrt: "请先上传 SRT 文件。",
    parsed: "已解析 {count} 条字幕，生成 {paragraphs} 个 Markdown 段落。",
    copied: "Markdown 已复制。",
    downloaded: "Markdown 已下载。",
    quotaUsed: "已使用 1 次免费转换，还剩 {left} 次。",
    paywallTitle: "免费次数已用完",
    paywallBody: "你已经用完 10 次免费转换。升级后可无限进行本地字幕转 Markdown。",
    openPricing: "打开价格页",
    optionsTitle: "字幕转 Markdown 设置",
    language: "语言",
    saveSettings: "保存设置",
    settingsSaved: "设置已保存。",
    malformedWarning: "部分字幕块格式异常，已跳过。",
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
