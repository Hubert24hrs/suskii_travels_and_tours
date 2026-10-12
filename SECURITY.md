# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue or pull request.

- Use GitHub's private vulnerability reporting: the repository's **Security** tab, then
  **Report a vulnerability**.
- Include the affected app or route, steps to reproduce, the impact you see, and any proof of
  concept. Never include other people's personal data. Use your own test account and booking.

We acknowledge reports within 2 working days and give a first assessment within 5 working days.
We keep you informed until the fix ships, and credit you if you wish.

### Rules for testing

- Test only against accounts and bookings you own, in a test environment where one is offered.
- No denial of service, load testing, social engineering, or physical attacks.
- Do not access, change or keep other people's data. If you reach any, stop, tell us, and
  delete it.
- Do not make real payments or bookings to probe payment flows. Our providers' hosted pages
  are out of scope; report problems there to the provider.

We will not pursue legal action against good-faith research that follows these rules.

## Supported versions

| Component               | Supported                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Web, admin console, API | The deployed version only (continuous delivery from `main`)                                          |
| Mobile app              | The latest store release; older builds are blocked below `MOBILE_MIN_VERSION` when a fix requires it |

## Remediation time frames

Measured from confirmation, by severity (CVSS 4.0 base score, adjusted for how reachable the
issue is in this platform):

| Severity         | Fix in production                    | Applies to                                                   |
| ---------------- | ------------------------------------ | ------------------------------------------------------------ |
| Critical (9.0+)  | 2 days                               | Reported vulnerabilities, our own findings, and dependencies |
| High (7.0-8.9)   | 7 days                               | Same                                                         |
| Medium (4.0-6.9) | 30 days                              | Same                                                         |
| Low (below 4.0)  | 90 days, or the next planned release | Same                                                         |

Dependencies:

- CI blocks merges on any high or critical advisory in production dependencies.
- Dependabot opens update pull requests weekly.
- Libraries with no advisory still update at least once a quarter, so that a security fix never
  waits behind a major-version migration.
- When no fix exists, the advisory is recorded in `docs/security/dependency-exceptions.md` with
  why it cannot be reached and a review date of at most 30 days.

If a fix will miss its time frame, the owner approves the delay and its mitigations in writing,
recorded with the finding.

## How the platform is secured

- `docs/security/checklist.md`: OWASP ASVS 5.0 Level 2 and MASVS status with evidence.
- `docs/security/threat-model.md`: STRIDE threat model.
- `docs/security/`: cryptography, data classification, logging, external communications and
  business limits.
- `docs/runbooks/`: incident runbooks.
