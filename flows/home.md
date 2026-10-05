# Home page

The first journey in scope: a user navigates to a Batteries frontend's home
page. No business journey is built yet in any frontend; all three are still the
CDP scaffold.

**Owning frontend:** waste-batteries-reg-frontend · **Entry point:** `/`
**Last checked against source:** waste-batteries-reg-frontend@48f751e,
waste-batteries-submit-frontend@9f6695c, waste-batteries-obligations-fe@34ef3ea
on 2026-10-05

## Steps — registration frontend

1. **Home** (`GET /`, signed in or out) [IMPLEMENTED] — E2E: `tests/specs/home.e2e.js` (`@smoke`)
   - Title: "Home | waste-batteries-reg-frontend"; heading: "Home"
   - Caption under the heading: "waste-batteries-reg-frontend"
   - Service navigation: Home (current), About; Example only when signed in
   - Signed out: "Sign in" link under the header
   - **Branch — select "About":** → `/about` [IMPLEMENTED] — E2E: not written
     - Title: "About | waste-batteries-reg-frontend"; heading: "About";
       breadcrumbs Home › About
   - **Branch — select "Sign in":** → `/auth/sign-in` → Defra ID → back to `/`
     with the account bar (organisation, email, name, "Sign out")
     [BLOCKED: in Compose / CI the browser cannot reach the Defra ID stub —
     services use `cdp-defra-id-stub:3200`, which only resolves inside the
     Docker network]
   - **Branch — signed in, select "Example":** → `/example`
     [BLOCKED: needs sign-in, as above]

## Error branches

- Defra ID sign-in fails or is cancelled → "We could not sign you in"
  (`/auth/sign-in-oidc`, HTTP 401) [BLOCKED: needs sign-in, as above]

## Other frontends

Same scaffold and the same branches. Out of scope for E2E by decision
(2026-10-05: smoke test covers the registration home page only).

- **Submissions** `GET /` on `waste-batteries-submit-frontend` — title
  "Home | waste-batteries-submit-frontend" [IMPLEMENTED] — E2E: not written
- **Obligations** `GET /` on `waste-batteries-obligations-fe` — title
  "Home | waste-batteries-obligations-fe" [IMPLEMENTED] — E2E: not written

## Notes

- The home page is covered at integration level by each frontend's
  `src/server/routes/home/controller.test.js` (200 and `Home |` in the body).
  The E2E smoke test adds the deployed-service check: a real browser reaches
  the right service (full title) and the page renders its heading.
- `serviceName` is still the repo name; when the real service name lands,
  update the titles here first, then `tests/specs/home.e2e.js`.
- `/example` is CDP scaffold that saves through the backends' example
  endpoints. Expect it to change or disappear rather than gain a test.
