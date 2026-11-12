# ADR-113: A mailbox on the testing backend, so its first admin can confirm an address

- Status: Accepted
- Date: 2026-11-12
- Deciders: Claude Code (implementer), under the owner's standing instruction to deploy the
  backend and do everything that does not need the owner
- Amends: ADR-111 (the backend on one machine)

## Context

The console's first super admin is made with `staff:bootstrap` (ADR-060), which grants the role
only to an account whose email address is verified. That check is deliberate: an address nobody
confirmed may have been registered by someone else first (account pre-hijacking), and the
bootstrap must not hand the console to them.

The backend machine (ADR-111) sends no email: `EMAIL_PROVIDER=mock`, because a real provider is
an account and a contract only the owner can take out. So the address of an account made on the
machine can never be confirmed, and `staff:bootstrap` refuses every account. The owner's guide
told the owner to sign up and run the bootstrap; the bootstrap would have said "The account has
not verified its email yet", with no way forward.

A testing backend should not email real people anyway: testers' addresses, sample bookings and
password resets must not leave it.

## Decision

On a testing backend, the machine runs a mailbox. Every email the API sends lands in it and goes
no further; the owner reads it in a browser and opens the link that confirms the address.

- **Mailpit** (`axllent/mailpit:v1.31.6`), the same catcher the local stack uses, in the compose
  file under the profile `mailbox`: as user 1000 on a read-only file system with every capability
  dropped, its messages on the data disk, a week and 500 messages at most. It relays nothing.
- **The API** sends to it over the machine's private network with `EMAIL_PROVIDER=smtp`. Mailpit
  offers no TLS, so `SMTP_ALLOW_PLAINTEXT` joins the flags of ADR-038 that declare a private path
  (`DATABASE_ALLOW_PLAINTEXT`, `REDIS_ALLOW_PLAINTEXT`, `AGENT_ALLOW_PLAINTEXT`): without it,
  production still sends only with STARTTLS or implicit TLS. The transport's options are a pure
  function with tests (`smtpTransportOptions`).
- **Its page** is `mail.endpoints.<project>.cloud.goog`, a free Google name like the others, with
  a certificate from Caddy. Caddy checks basic authentication (user `suskii`, the password in the
  secret `MAILBOX_PASSWORD`, 40 random letters and digits made by `seed-secrets.mjs`) before
  anything reaches Mailpit. The release hashes the password with Caddy's own `hash-password`
  (bcrypt), on standard input, only when the password changes, and keeps the hash in files only
  root reads. Links in a message open elsewhere and never carry the mailbox's address as a
  referrer; the page asks search engines to stay away.
- **A check from outside**: each release asks the mailbox's address without the password from
  the machine, through the public front door. 401 is reported as locked. A page that answers 200
  is stopped at once and reported, so a mistake never leaves the mail open.
- **Switched off**, the release removes the container and deletes the mail it kept.
- **Never in production**: Terraform refuses `mailbox` in an environment named production, as it
  refuses the sample catalogue. Production's email goes to travellers through the owner's
  provider.

The first admin then is: sign up in the app with the address that should be the admin, open the
mailbox, open the confirming link, and run the bootstrap from the machine's SSH button.

## Consequences

- The console can get its first admin without the owner opening an email provider's account.
- Whoever holds the mailbox's password can read every message on the testing backend, including
  links that confirm addresses, reset passwords and open guest bookings. The mailbox is
  classified as secret (`docs/security/data-classification.md`): the password stays in Secret
  Manager, the page answers only over HTTPS, and nothing older than a week is kept.
- On a testing backend, "verified" means "confirmed by whoever reads the mailbox", not by the
  address's owner. The bootstrap's check still stops an account nobody confirmed, and the person
  running it is the one reading the mailbox.
- The release rehearsal (`docker-compose.release.yml`) keeps the mock: it checks releases, not
  mail.

## Alternatives considered

- **An email provider now.** Real delivery, but an account and terms only the owner can accept,
  and testers' messages would reach real inboxes.
- **A flag on the bootstrap that skips the verified address.** It would hand the console to
  whoever registered the address first; the check exists to stop exactly that.
- **TLS between the API and Mailpit.** A private certificate authority on the machine, given to
  the API, for a hop that never leaves the host: more to keep than the risk it removes.
- **Mailpit's own password file.** Version 1.31 reads only a file in htpasswd form, which still
  needs a hash made on the machine; Caddy already fronts every page and checks the password
  before any request reaches the mailbox.
