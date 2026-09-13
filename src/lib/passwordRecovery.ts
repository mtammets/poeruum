import { getMerchantLoginUrl } from './storefrontUrl'

const RECOVERY_PARAM = 'reset_password'

export function isPasswordRecoveryLocation(location: Pick<Location, 'search' | 'hash'>) {
  return new URLSearchParams(location.search).get(RECOVERY_PARAM) === '1'
    || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery'
}

export function getPasswordResetRedirectUrl(location: Parameters<typeof getMerchantLoginUrl>[0]) {
  const target = new URL('/', getMerchantLoginUrl(location))
  target.searchParams.set(RECOVERY_PARAM, '1')
  return target.href
}

export function preservePasswordRecoveryIntent() {
  const url = new URL(window.location.href)
  url.searchParams.set(RECOVERY_PARAM, '1')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function clearPasswordRecoveryIntent() {
  const url = new URL(window.location.href)
  url.searchParams.delete(RECOVERY_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
}
