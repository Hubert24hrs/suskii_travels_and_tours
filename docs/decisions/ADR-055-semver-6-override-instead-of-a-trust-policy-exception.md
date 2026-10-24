# ADR-055: Semver 6 override instead of a trust policy exception

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review

## Context

Next.js 16.3.8 and Storybook 10.6.0 had open critical and high advisories (audit F1, F2). Installing
the fixed releases (16.4.1, 10.6.3) re-resolves the Babel graph, and pnpm's trust policy
(`trustPolicy: no-downgrade`) refuses `semver@6.3.1`: it was published in 2023, after semver 7.5.x
releases that carried provenance, and has none itself. It is the only semver 6 release with the
ReDoS fix (CVE-2022-25883), so no other 6.x version is acceptable either.

The options were an exception for that exact version (`trustPolicyExclude`), waiting for Babel 8,
or moving its users off semver 6.

## Decision

Override every semver below 7 with the trusted 7.x line (`semver@<7: ^7.8.5` in
`pnpm-workspace.yaml`). The packages that pin semver 6 are Babel 7 (core, compilation targets,
class and regexp feature helpers, transform-runtime, the corejs2 polyfill plugin),
`eslint-plugin-import`, `eslint-plugin-react`, `istanbul-lib-instrument` and `node-exports-info`.
They call `satisfies`, `intersects`, `lt`, `gt`, `valid` and `parse`, whose behaviour semver 7 keeps.

## Consequences

- The trust policy stays unchanged and nothing without provenance is admitted.
- Next.js 16.4.1 and Storybook 10.6.3 are installed; F1 and F2 are closed.
- Every Babel consumer (Next.js builds, Metro and the app bundle, Jest through babel-jest,
  coverage through istanbul, Storybook) runs on semver 7. The full build, unit, e2e and bundle
  checks were run after the change.
- Drop the override once Babel 8 (which depends on semver 7) replaces Babel 7 everywhere.
