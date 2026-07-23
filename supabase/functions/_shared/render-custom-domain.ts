export type RenderCustomDomain = {
  id: string
  name: string
  domainType: 'apex' | 'subdomain'
  publicSuffix: string
  redirectForName: string
  verificationStatus: 'verified' | 'unverified'
  createdAt: string
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const renderRequest = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${requiredEnv('RENDER_API_KEY')}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (response.ok) return response

  const details = await response.json().catch(() => null) as { message?: string } | null
  const error = new Error(details?.message || `Renderi päring ebaõnnestus (${response.status}).`) as Error & { status?: number }
  error.status = response.status
  throw error
}

const servicePath = () => `/services/${encodeURIComponent(requiredEnv('RENDER_SERVICE_ID'))}/custom-domains`

export const getRenderServiceHostname = () => requiredEnv('RENDER_SERVICE_HOSTNAME')
  .replace(/^https?:\/\//i, '')
  .replace(/\/.*$/, '')
  .toLowerCase()

export const createRenderCustomDomains = async (hostname: string) => {
  const response = await renderRequest(servicePath(), {
    method: 'POST',
    body: JSON.stringify({ name: hostname }),
  })
  const domains = await response.json() as RenderCustomDomain[]
  if (!Array.isArray(domains) || !domains.length) throw new Error('Render ei tagastanud loodud domeeni.')
  return domains
}

export const getRenderCustomDomain = async (idOrName: string) => {
  const response = await renderRequest(`${servicePath()}/${encodeURIComponent(idOrName)}`)
  return await response.json() as RenderCustomDomain
}

export const verifyRenderCustomDomain = async (idOrName: string) => {
  await renderRequest(`${servicePath()}/${encodeURIComponent(idOrName)}/verify`, { method: 'POST' })
}

export const deleteRenderCustomDomain = async (idOrName: string) => {
  try {
    await renderRequest(`${servicePath()}/${encodeURIComponent(idOrName)}`, { method: 'DELETE' })
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return
    throw error
  }
}

export const hasActiveTls = async (hostname: string) => {
  try {
    const response = await fetch(`https://${hostname}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    })
    return response.status > 0
  } catch {
    return false
  }
}
