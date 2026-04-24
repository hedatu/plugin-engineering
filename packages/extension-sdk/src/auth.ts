import type { SessionSnapshot } from './types'

export function isSessionExpired(session: SessionSnapshot | null | undefined, skewMs = 60_000) {
  if (!session || session.expiresAt === null) {
    return true
  }

  return Date.now() + skewMs >= session.expiresAt
}

export function hasSession(session: SessionSnapshot | null | undefined) {
  return Boolean(session?.accessToken && session.refreshToken)
}

export function formatUserEmail(session: SessionSnapshot | null | undefined) {
  return session?.user.email ?? '未登录'
}

