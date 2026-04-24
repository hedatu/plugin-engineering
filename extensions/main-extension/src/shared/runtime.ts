import type { ExtensionMessageRequest, ExtensionMessageResponse } from '@membership/extension-sdk'
import { config } from '../config'

export function sendRuntimeMessage<T = unknown>(message: ExtensionMessageRequest) {
  return chrome.runtime.sendMessage(message) as Promise<ExtensionMessageResponse<T>>
}

export function openPortal(path: string) {
  const base = import.meta.env.SITE_URL ?? 'http://localhost:5173'
  window.open(`${base}${path}`, '_blank', 'noopener,noreferrer')
}

export function getProductPricingPortalPath(input?: { installationId?: string | null; extensionId?: string | null }) {
  const params = new URLSearchParams({
    source: 'chrome_extension',
  })

  if (input?.installationId) {
    params.set('installationId', input.installationId)
  }

  if (input?.extensionId) {
    params.set('extensionId', input.extensionId)
  } else if (chrome?.runtime?.id) {
    params.set('extensionId', chrome.runtime.id)
  }

  return `/products/${config.productSlug}/pricing?${params.toString()}`
}
