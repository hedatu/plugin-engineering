import type { ConsumeUsageResponse } from './types'

export function isUsageAllowed(result: ConsumeUsageResponse | null | undefined) {
  return Boolean(result?.allowed)
}

export function getUsageErrorMessage(result: ConsumeUsageResponse | null | undefined) {
  switch (result?.errorCode) {
    case 'FEATURE_NOT_ENABLED':
      return '当前套餐未开通这个功能。'
    case 'QUOTA_EXCEEDED':
      return '额度已用完。'
    case 'ENTITLEMENT_INACTIVE':
      return '会员状态不可用。'
    case 'LOGIN_REQUIRED':
      return '请先登录。'
    case 'INSTALLATION_NOT_REGISTERED':
      return '当前设备未注册。'
    default:
      return '请求失败，请稍后重试。'
  }
}

