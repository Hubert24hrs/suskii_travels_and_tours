# ADR-046: Error reporting

- Status: Accepted
- Date: 2026-10-07
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/observability` asks for Sentry on web, mobile and API errors, with PII
scrubbing and source maps. Until phase 11, errors were only logged: nobody would hear about a
crash in a visitor's browser or in the app.

The official SDKs fit badly here:

- **`@sentry/browser`** is about 25 kB gzipped. The homepage has about 2 kB of headroom under
  its 170 kB budget (ADR-043).
- **`@sentry/node`** sets up its own OpenTelemetry, which clashes with the API's (ADR-047).
- **`@sentry/react-native`** needs native modules and a new development build, which this
  container cannot produce or test.
- **Defaults.** Each SDK collects request data, breadcrumbs and user context unless told not
  to.

## Decisions

1. **One small client for every service.**
   - `@suskii/shared/error-reporting` posts events to Sentry's envelope endpoint over `fetch`.
     It runs unchanged in Node, browsers and Hermes.
   - Authentication goes in the query string and the body is plain text. Browsers therefore send
     a simple request with no CORS preflight.
   - At most 20 events leave per minute, the same error once a minute, and a 429 pauses reporting
     for a minute. Reporting never throws.
   - Each service wraps it in its own `ErrorReporter`: the API's injectable, the worker's,
     `lib/error-reporter.ts` in the web app and the console, and `src/lib/error-reporting.ts` in
     the app. An official SDK can replace the client behind that interface later.
2. **What an event holds, and nothing else.**
   - The error type, a scrubbed message, the stack (V8 and JavaScriptCore/Hermes formats, query
     strings removed), and up to three causes.
   - The service, release and environment.
   - Allowlisted tags: request id, route template, method, status, queue, job, task, kind and
     digest.
   - Never request bodies, headers, cookies, users, IP addresses, full URLs or breadcrumbs.
3. **Scrubbing.** Messages and tag values lose:
   - e-mail addresses, phone numbers and long digit runs;
   - IPv4 and IPv6 addresses;
   - bearer tokens, JWTs and long opaque secrets;
   - the query strings and fragments of URLs.

   UUIDs stay: they are record ids and grant nothing. A non-error value thrown as an object is
   reported by its kind only, never its contents.

4. **What is reported.**
   - **API:** 5xx responses that are not deliberate problem responses (a supplier being down is
     a metric, not a bug), failed background tasks, and uncaught exceptions. After an uncaught
     exception the process still exits.
   - **Worker:** jobs that have used up their attempts (tagged with the queue, the job name and
     the API request id), and uncaught exceptions.
   - **Web and console servers:** Next's `onRequestError` (rendering, route handlers, actions,
     the proxy), tagged with the route template and the request id the proxy assigned.
   - **Browsers:** uncaught errors, unhandled rejections and errors caught by the web app's
     error boundary. The reporter loads only after an error, so pages carry just two event
     listeners. Errors from browser extensions are ignored. The tag is the page template (web)
     or the path with ids replaced (console).
   - **App:** React Native's global handler. A fatal error waits up to 1.5 s for its report before
     the default handler ends the app. Release builds also report unhandled rejections.
5. **Configuration.**
   - `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` for the API and the worker
     (validated; a malformed DSN is refused without echoing it).
   - `NEXT_PUBLIC_SENTRY_*` for the web app and the console, and `EXPO_PUBLIC_SENTRY_DSN` for the
     app. A DSN's key is public by design.
   - Without a DSN nothing is sent. The web and console CSPs add the DSN's origin to
     `connect-src` only when one is set.
6. **Request ids.**
   - **Worker:** every API call sends `X-Request-Id: worker-<uuid>`. The API logs that id and the
     worker's failure logs carry it.
   - **Web and console proxies:** give each page request an id, reusing a well-formed one from the
     load balancer, and return it as `X-Request-Id`.
   - **Web server reads:** these are cached and shared across visitors (Next includes headers in
     the fetch cache key), so they carry no per-visitor id.
   - **Browsers:** they already receive the API's id in every problem response.

## Consequences

- **Source maps.** Readable stacks need them uploaded per release. That is a deployment step
  (phase 12: `sentry-cli sourcemaps upload` with `SENTRY_RELEASE` set to the git SHA).
- **Native crashes** in the app are not covered. Adding `@sentry/react-native` is a store-release
  decision for the owner: it needs a development build, its config plugin and a review of what it
  collects.
- **No breadcrumbs or performance traces in Sentry.** Traces come from OpenTelemetry (ADR-047).
- **Open for the owner:**
  - the Sentry organisation, its projects and data region;
  - the retention period;
  - who receives alerts.
