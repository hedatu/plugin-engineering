import type { ExtensionMessageRequest, ExtensionMessageResponse } from '@membership/extension-sdk'

export function sendRuntimeMessage<T = unknown>(message: ExtensionMessageRequest) {
  return chrome.runtime.sendMessage(message) as Promise<ExtensionMessageResponse<T>>
}

export function openPortal(path: string) {
  const base = import.meta.env.SITE_URL ?? 'http://localhost:5173'
  window.open(`${base}${path}`, '_blank', 'noopener,noreferrer')
}

