# ADR-033: Admin console, staff sessions and origin isolation

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for an "RBAC-gated Next.js admin with MFA enforcement". The API already guards
`/v1/admin` routes with `@AdminRoute(...)`: a staff role, an MFA-verified session, the permission
and, when set, an IP allowlist (ADR-007). The website signs travellers in with httpOnly cookies on
the API host plus a readable CSRF cookie. In production `COOKIE_DOMAIN` is the parent domain so
the website can read that CSRF cookie, which means the admin console, the website and the API all
see the same cookies. A staff member signed in on both would therefore carry an admin-capable
session into the public website, whose larger surface (third-party scripts later, user content)
makes it the likelier place for an XSS.

## Decisions

1. **One sign-in, MFA required.** Staff sign in on the console through the existing auth routes:
   email and password, then the authenticator code. A staff account without TOTP gets a session
   without MFA; the console sends it straight to enrolment (`/v1/me/mfa/totp`), and confirming the
   code marks the session MFA-verified. Admin routes refuse any session without MFA. Staff cannot
   turn MFA off (phase 2); `users:manage` can reset it, which forces re-enrolment.
2. **Browser calls with the session cookies.** The console is a client-rendered Next.js app that
   calls the API from the browser with credentials, the CSRF header on writes and a single-flight
   refresh, the same model as the website's account area. No admin token is ever stored in
   JavaScript-readable storage.
3. **Origin isolation for admin routes.** `ADMIN_ORIGINS` lists the console's origins (default
   `http://localhost:3001`). When an admin route is called with cookie authentication, the
   `Origin` header must be one of them, for every method including GET; a missing or other origin
   answers 403 and is audited as `rbac.access_denied` with the reason `origin_not_allowed`. The
   browser sets `Origin` on every cross-origin fetch and a page cannot forge it, so a script on the
   public website can neither read nor change admin data, even with the staff member's cookies
   attached. Bearer-token requests (no browser) are not origin-checked; they still need staff,
   MFA and the permission.
4. **Production settings.** `ADMIN_ORIGINS` is required in production, like `CORS_ORIGINS`, and
   the admin origins must also be in `CORS_ORIGINS`. `ADMIN_IP_ALLOWLIST` stays optional (office
   or VPN egress once known).
5. **Console hardening.** `noindex` everywhere, a nonce CSP like the website, no third-party
   scripts, and sign-out that revokes the session. Navigation is filtered by the caller's
   permissions for convenience only; the API decides.

## Consequences

- Staff can stay signed in on the website and the console in the same browser without the website
  being able to use the admin session.
- A staff member using a non-browser client must use bearer tokens (`transport: token`).
- Shorter idle timeouts for staff sessions and step-up confirmation for the riskiest actions are
  left for phase 11 (hardening).
