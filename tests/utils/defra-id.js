import { randomUUID } from 'node:crypto'

import { defraId, frontendUrls } from '#utils/env.js'

const stubUrl = `${defraId.url}/cdp-defra-id-stub`
// The stub only needs a redirect URI to put the code on; nothing follows it.
const redirectUri = `${frontendUrls.submissions}/auth/sign-in-oidc`

/**
 * Asks the stub to sign `defraId.user` in, without following redirects so the
 * code is read from the Location header and never reaches a real frontend.
 * Users with an organisation to choose are sent to /organisations first.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<{ status: number, location: string | undefined }>}
 */
async function authorize(request) {
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

  if (location?.startsWith('/')) {
    const organisations = await request.get(
      new URL(location, defraId.url).href,
      { maxRedirects: 0 }
    )
    location = organisations.headers().location
  }
  return { status: login.status(), location }
}

/**
 * Registers `defraId.user` through the stub's set-up form. The stub keeps users
 * temporarily, so they can be missing on a fresh or restarted stub.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function registerUser(request) {
  const form = await request.get(`${stubUrl}/register`)
  const csrfToken = /name="csrfToken" value="([^"]+)"/.exec(
    await form.text()
  )?.[1]
  if (!csrfToken) {
    throw new Error(`Defra ID stub register form unavailable: ${form.status()}`)
  }

  const registered = await request.post(`${stubUrl}/register`, {
    form: {
      csrfToken,
      userId: randomUUID(),
      contactId: randomUUID(),
      email: defraId.user,
      firstName: 'Batteries',
      lastName: 'Autotests',
      uniqueReference: randomUUID(),
      loa: '1',
      aal: '1',
      enrolmentCount: '1',
      enrolmentRequestCount: '1'
    },
    maxRedirects: 0
  })
  // Success redirects to /register/<id>/relationship; failure back to /register.
  if (!registered.headers().location?.includes('/relationship')) {
    throw new Error(
      `Defra ID stub could not register "${defraId.user}" ` +
        `(status ${registered.status()}).`
    )
  }
}

/**
 * Signs in to the Defra ID stub over HTTP, as the browser journey would, and
 * returns an access token for the backends.
 *
 * Stub flow: GET /authorize?user=<email> (optionally via an organisation step)
 * redirects to redirect_uri?code=..., which is exchanged at POST /token. The
 * stub has no client_credentials grant. If the user is unknown to the stub
 * (400), it is registered first and the sign-in retried.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<string>}
 */
async function getAccessToken(request) {
  let { status, location } = await authorize(request)
  if (status === 400) {
    await registerUser(request)
    ;({ status, location } = await authorize(request))
  }

  const code = location && new URL(location).searchParams.get('code')
  if (!code) {
    throw new Error(
      `Defra ID stub gave no authorization code for "${defraId.user}" ` +
        `(status ${status}, location ${location}). ` +
        'Check the stub is reachable and DEFRA_ID_USER is valid.'
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
