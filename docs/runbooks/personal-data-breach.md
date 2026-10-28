# Personal data breach

Use when personal data may have been read, copied, changed, lost or destroyed without
authority: a leaked export or backup, an account takeover that viewed bookings, a misdirected
email, a supplier reporting a compromise, a stolen staff device, a script tampering with a payment
page. The clock for regulators starts when Suskii becomes **aware**, not when the investigation
ends.

## First hour

1. **Open an incident** (see [every incident](README.md#every-incident)) and name an incident
   lead. Record the time you became aware in UTC. Never copy the personal data itself into the
   incident record, chat or ticket: ids, counts and categories only.
2. **Contain.** Use the runbook that fits the cause: [session revocation](session-revocation.md)
   for taken-over accounts or staff, [key rotation](key-rotation.md) for leaked keys or secrets,
   pausing a provider or supplier (`PAYMENT_PROVIDERS_PAUSED`, `*_SUPPLIERS`) for a third-party
   compromise. A suspected script on a payment page: deploy the last good release
   ([deploy and roll back](deploy-and-rollback.md)) and check the page policy in `lib/csp.ts`.
3. **Preserve evidence.** Keep the audit log, access logs and the affected release; do not delete
   accounts or rows while the investigation runs (the retention sweep can be paused).
4. **Tell the data protection officer** (Nigeria), the Information Officer (South Africa) and the
   owner.

## Assess (within 24 hours)

- **What data:** which `DATA_REGISTRY` tables and fields. Passport numbers, identity numbers,
  driver documents, visa documents, payment references and precise locations are high risk.
- **Whose:** how many people, and in which countries (account country, booking contact country,
  passenger nationality). That decides which regulators to tell.
- **Encrypted?** Fields encrypted with `FieldEncryption` whose keys were not exposed lower the
  risk; say so in the notification.
- **Likely harm:** identity fraud, financial loss, physical safety (rides), discrimination.

## Notify

| Where the affected people are | Regulator and deadline                                                                                             | Data subjects                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Nigeria                       | Nigeria Data Protection Commission, within 72 hours of awareness (NDPA s. 40)                                      | Immediately when the breach is likely high risk        |
| Kenya                         | Office of the Data Protection Commissioner, within 72 hours, with reasons for any delay (DPA s. 43)                | Without undue delay where there is a real risk of harm |
| South Africa                  | Information Regulator, through its eServices portal, as soon as reasonably possible (POPIA s. 22); target 72 hours | As soon as reasonably possible                         |
| EU or UK                      | The lead supervisory authority or the ICO, within 72 hours (GDPR Art. 33)                                          | Without undue delay when the risk is high (Art. 34)    |
| Card data suspected           | The acquirer and the payment provider at once                                                                      | As the acquirer directs                                |

A notification does not wait for the full picture: send what is known and update it. Each one
says what happened and when, the categories and approximate numbers of people and records, the
likely consequences, what Suskii has done and will do, and the contact (DPO or Information
Officer). Messages to travellers say what they should do (change a password, watch for phishing,
contact their bank). A breach notice is not marketing and goes to everyone affected regardless of
channel preferences; until the console can send one (item 13, part 2), send it by email from the
support address with the list exported by an operator job, never from a laptop.

Processors that find a breach in Suskii's data tell Suskii within 48 hours (Kenya) or at once
(South Africa); Suskii reports to the regulators.

## Close

- Keep a record of every breach, notified or not: facts, effects, decision and remedy. NDPA,
  POPIA and GDPR all expect it.
- Review within five working days; feed findings into `docs/security/threat-model.md` and the
  tests.

Obligations and sources: [privacy obligations per country](../compliance/privacy-obligations.md).
