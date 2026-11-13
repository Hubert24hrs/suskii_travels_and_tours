# ADR-115: Session cookies on the parent domain the website, the console and the API share

- Status: Accepted
- Date: 2026-11-13
- Deciders: Claude Code (implementer), after the owner's report that signing in on the testing
  website led back to the sign-in page
- Implements: ADR-033 (the parent domain it names for `COOKIE_DOMAIN`) in every deployment
- Amends: ADR-111 (the backend on one machine)

## Context

The website and the console sign people in through the API, which answers with three
`__Secure-` cookies: the access token, the refresh token (only on `/v1/auth`) and a CSRF token
that the page's JavaScript reads and sends back in `X-CSRF-Token` (ADR-007). A page knows that
someone is signed in by that readable cookie (`hasSession()` in `apps/web/lib/session-cookie.ts`
and the console's `lib/session.ts`).

ADR-033 says that in production `COOKIE_DOMAIN` is the parent domain, so the website and the
console can read it. No deployment set it: not the machine (`infra/gcp/vm`), not the platform
module behind the edge, not the Helm chart. Without it the cookies stay on the API's own name
(`api.endpoints.suskii-travels-staging.cloud.goog`), where the website
(`web.endpoints.suskii-travels-staging.cloud.goog`) cannot see them. Sign-in succeeded, the
account page found no session and sent the traveller back to sign in, with no error. Locally
and in the release rehearsal everything runs on one name (`localhost`, `127.0.0.1`), and a
cookie ignores the port, so no test met it.

Setting it raises a second problem for browsers that already hold the cookies on the API's own
name. A cookie with a domain is another cookie than one without, so both stay. A browser sends
the older one of a name first and the API reads the first: the old refresh token, rotated once,
would be presented again, and the API ends a session whose refresh token comes back (reuse
detection). The traveller would be signed out at every refresh until the old cookie expired, in
up to 90 days.

## Decision

1. **Every deployment derives the domain from its three names.** `COOKIE_DOMAIN` is the closest
   parent that the website's, the console's and the API's names share, counted in labels from
   the top: `endpoints.<project>.cloud.goog` for Google's free names on the machine,
   `suskii.com` for `suskii.com`, `admin.suskii.com` and `api.suskii.com`. One rule, written in
   `infra/terraform/vm/main.tf` and `infra/terraform/modules/platform/run.tf`; the Helm chart
   takes it as `global.cookieDomain` (it has no names to derive from, only URLs).
2. **Names that share no parent are refused before anything changes.** A Terraform precondition
   stops the plan (on the machine while the sites run, behind the edge always): such a website
   could never keep anyone signed in, and the failure would only show in a browser.
3. **Where there is no website, the cookies stay on the API's name.** The machine with the sites
   off and the platform without the edge (ADR-110) set nothing.
4. **The API expires the copies on its own name.** With `COOKIE_DOMAIN` set, every response that
   sets or clears the session (sign-in, refresh, sign-out, account deletion) also clears the
   three cookies without a domain (`expireHostOnlyCopies()` in `apps/api/src/auth/cookies.ts`).
   That never touches the shared cookies, costs three short headers, and covers any browser that
   signed in before the setting existed, without asking anyone to clear their cookies.

## Consequences

- The testing website and console keep a person signed in after the next deploy of the machine.
  A browser that signed in before it is sent to sign in once more; from then on it holds only
  the shared cookies.
- Every name under the parent receives the session cookies. On the testing machine that
  includes the mailbox (`mail.`, ADR-113), which is ours, behind its own password, and logs no
  requests. A future name under the parent receives them too: a third-party service never gets
  a name there.
- The console and the website share one session in a browser, as ADR-033 decided: signing in on
  one replaces the session of the other. Admin routes still take a cookie session only from the
  console's origin.
- A move to another parent (from Google's free names to the owner's domain) leaves the old
  cookies on names nobody visits any more: nothing to clear. A change of parent under the same
  names would need the old parent cleared the same way.
- The public suffix list is not consulted: names under one owner's domain or one project's free
  names never share only a public suffix. The precondition's message names the rule.

## Alternatives considered

- **The website calls the API through its own name** (a proxy for `/v1` on the website's host).
  Cookies would need no domain, but every client and the content security policy name the API's
  origin, payments and webhooks would cross two proxies, and the console would need the same.
  A much larger change for the same result.
- **A setting the owner gives by hand.** One more thing to know and to get wrong; the names
  already say what the parent is.
- **Telling the owner to clear the site's cookies.** Works for one person once, not for every
  browser that signed in before the change.
