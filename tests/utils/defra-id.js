import { defraId, frontendUrls } from '#utils/env.js'

const stubUrl = `${defraId.url}/cdp-defra-id-stub`
// The stub only needs a redirect URI to put the code on; nothing follows it.
const redirectUri = `${frontendUrls.submissions}/auth/sign-in-oidc`

/**
 * Signs in to the Defra ID stub over HTTP, as the browser journey would, and
 * returns an access token for the backends.
 *
 * Stub flow: GET /authorize?user=<email> (optionally via an organisation step)
 * redirects to redirect_uri?code=..., which is exchanged at POST /token. The
 * stub has no client_credentials grant. Redirects are not followed so the code
 * is read from the Location header and never reaches a real frontend.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<string>}
 */
async function getAccessToken(request) {
  const login = await request.get(`${stubUrl}/authorize`, {
    params: {
      serviceId: 'stub-service-id',
      client_id: defraId.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: 'api-tests',
      scope: 'openid offline_access',
      user: defraId.user
    },
    maxRedirects: 0
  })
  let location = login.headers().location

  // Users with an organisation to choose are sent to /organisations first.
  if (location?.startsWith('/')) {
    const organisations = await request.get(
      new URL(location, defraId.url).href,
      { maxRedirects: 0 }
    )
    location = organisations.headers().location
  }

  const code = location && new URL(location).searchParams.get('code')
  if (!code) {
    throw new Error(
      `Defra ID stub gave no authorization code for "${defraId.user}" ` +
        `(status ${login.status()}, location ${location}). ` +
        'Check the user exists on the stub (DEFRA_ID_USER).'
    )
  }

  const token = await request.post(`${stubUrl}/token`, {
    form: {
      grant_type: 'authorization_code',
      client_id: defraId.clientId,
      client_secret: defraId.clientSecret,
      code,
      redirect_uri: redirectUri
    }
  })
  if (!token.ok()) {
    throw new Error(`Defra ID stub token request failed: ${token.status()}`)
  }

  const { access_token: accessToken } = await token.json()
  return accessToken
}

export { getAccessToken }
