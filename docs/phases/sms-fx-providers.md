# Text and exchange-rate providers

Production refused to start with a mock text, exchange-rate or WhatsApp notification provider,
and those three had no real adapter, so production could not start at all. This item builds the
adapters, so going live needs only the owner's accounts and keys (decision in ADR-091).

## Plan

| Step | Work                                                                                                                                 | Files                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 1    | Termii and Africa's Talking adapters behind `SmsProvider`, routing by calling code, failures as codes without the number or the text | `src/notifications/sms*.ts`                 |
| 2    | Sign-in codes: a failed send deletes the code and the cooldown and answers 503 `sms-unavailable`                                     | `src/auth/otp.service.ts`, the three routes |
| 3    | Open Exchange Rates adapter behind `FxProvider`, exact decimal rates, owner-fixed rates on top (`FX_RATE_OVERRIDES`)                 | `src/pricing/fx-providers.ts`               |
| 4    | `WHATSAPP_PROVIDER=none`: the notification channel off, logged as `channel_off`, accepted in production                              | `src/notifications/whatsapp.ts`, dispatcher |
| 5    | Settings with boot checks (credentials for every provider named, TLS, no sandbox host or mock route in production)                   | `src/config/env.schema.ts`, `.env.example`  |
| 6    | Owner check with real keys: `sandbox:messaging` and the manual `messaging-sandbox.yml` workflow                                      | `scripts/messaging-sandbox.ts`, workflow    |
| 7    | Terraform example, Helm values, secret-name guards, outbound hosts, records of processing, ADR, changelog                            | `infra`, `docs`                             |

## Risks

- **Formats read from client libraries.** The providers' documentation sites were unreachable
  from the build environment. The adapters follow Africa's Talking's official SDK, two
  independent Termii clients and four Open Exchange Rates clients. The first check with real keys
  confirms them.
- **DND numbers in Nigeria.** Without Termii's DND route, codes do not reach numbers on the
  Do-Not-Disturb list. The adapter defaults to `dnd`, which Termii activates on request.
- **Rates with floats.** Provider rates arrive as JSON numbers. The adapter keeps each rate's
  source text, so no rate is rounded through a double.

## Outcome

Built as planned.

| Check                                        | Result                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| API typecheck and lint (changed files)       | clean                                                                     |
| New unit tests (adapters, routing, settings) | 39 of 39 with the settings and notification specs                         |
| API e2e: phone codes, channel off            | 15 of 15 and 1 of 1 (503 then an immediate retry; WhatsApp `channel_off`) |
| Records of processing                        | regenerated; the privacy tests pass                                       |
| Check script without keys                    | names every missing key and exits 1                                       |

What waits for the owner (also in `docs/owner/launch-checklist.md`): a Termii account with an
approved sender ID and the DND route; an Africa's Talking account for numbers outside Nigeria (or
one provider for all); an Open Exchange Rates app id; whether to pin the naira to the bank's
settlement rate; and one run of the check workflow with a real phone.
