function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '')
  return base64ToArrayBuffer(clean)
}

export function parseWaffoSignature(header: string): { t?: string; v1?: string } {
  const result: { t?: string; v1?: string } = {}
  for (const part of header.split(',')) {
    const [key, ...rest] = part.split('=')
    result[key.trim() as 't' | 'v1'] = rest.join('=').trim()
  }
  return result
}

export async function verifyWaffoWebhookSignature(params: {
  rawBody: string
  signatureHeader: string | null
  publicKeyPem: string
  toleranceMs?: number
}) {
  const { rawBody, signatureHeader, publicKeyPem, toleranceMs = 5 * 60 * 1000 } = params
  if (!signatureHeader) return { ok: false, reason: 'MISSING_SIGNATURE' }

  const { t, v1 } = parseWaffoSignature(signatureHeader)
  if (!t || !v1) return { ok: false, reason: 'MALFORMED_SIGNATURE' }

  const timestamp = Number(t)
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'INVALID_TIMESTAMP' }
  if (Math.abs(Date.now() - timestamp) > toleranceMs) return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' }

  const key = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(publicKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const signatureInput = `${t}.${rawBody}`
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64ToArrayBuffer(v1),
    new TextEncoder().encode(signatureInput),
  )

  return ok ? { ok: true } : { ok: false, reason: 'SIGNATURE_MISMATCH' }
}
