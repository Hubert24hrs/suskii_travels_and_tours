# Documentation

Where to find what. The project's overview and quick start are in the
[README](../README.md); the working guide for developers and Claude Code, with the status of
every area and the owner's open questions, is [CLAUDE.md](../CLAUDE.md); the product and
engineering spec is [PROJECT_SPEC.json](../PROJECT_SPEC.json).

## For the owner

| Document                                                                 | Read it when                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Launch checklist](./owner/launch-checklist.md)                          | Opening an account or handing over a key: every owner step, in order               |
| [Going live: replace every stand-in](./owner/going-live.md)              | Before the public launch: every mock, sample and test switch, and what replaces it |
| [The backend on Google Cloud](./owner/deploy-backend-on-google-cloud.md) | Deploying or redeploying the testing backend from Cloud Shell                      |
| [What the assistant may cost](./owner/assistant-cost-estimate.md)        | Deciding Ask Suskii's caps and budget                                              |

## What was built and why

- **[Decisions](./decisions/)**: ADR-001 to ADR-118, one per decision, each with its context,
  what was decided, the consequences and the alternatives. The titled list is in
  [CLAUDE.md](../CLAUDE.md#key-decisions).
- **[Phase plans](./phases/)**: the plan, the risks and the outcome of each piece of work.

| Work                                              | Phase document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phases 0 to 13                                    | [phase-0](./phases/phase-0.md) to [phase-13](./phases/phase-13.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cars: buses, rides and car rental                 | [cars](./phases/cars.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Feature parity for flights, hotels and car rental | [feature-parity](./phases/feature-parity.md) (audit in [audits/feature-parity](./audits/feature-parity.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Combined trips                                    | [trip-builder](./phases/trip-builder.md), [trip-details-form](./phases/trip-details-form.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The assistant and price intelligence              | [ai-agent](./phases/ai-agent.md), [assistant-whole-trip](./phases/assistant-whole-trip.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The owner's changes of November 2026              | [owner-changes-2026-11](./phases/owner-changes-2026-11.md), [date-pickers](./phases/date-pickers.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Partner supply and hotels                         | [partner-supply](./phases/partner-supply.md), [expedia-rapid](./phases/expedia-rapid.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Standards for African markets                     | [all-in-pricing](./phases/all-in-pricing.md), [refund-offer](./phases/refund-offer.md), [payment-methods](./phases/payment-methods.md), [fast-on-slow-3g](./phases/fast-on-slow-3g.md), [languages](./phases/languages.md), [verified-reviews](./phases/verified-reviews.md), [company-accounts](./phases/company-accounts.md), [company-wallet](./phases/company-wallet.md), [growth](./phases/growth.md), [support](./phases/support.md), [uptime](./phases/uptime.md), [accessibility](./phases/accessibility.md), [compliance](./phases/compliance.md), [sms-fx-providers](./phases/sms-fx-providers.md) |
| Ideas not yet scheduled                           | [backlog](./phases/backlog.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Running it

- **[Runbooks](./runbooks/)**: what to do in an incident, a restore, a key rotation, a data
  rights request and more; the [runbook index](./runbooks/README.md) lists them.
- **[Release](./release/)**: the store listing and the privacy forms of both stores.
- **[Deployment](./deployment/)**: the AWS equivalents of the Google Cloud setup.

## Security, privacy and compliance

- **[Security](./security/)**: the threat model, the verification checklist and the
  inventories (data classification, authentication, access control, outbound hosts, keys,
  business limits). They change with the code they describe.
- **[Privacy](./privacy/)**: the records of processing (generated from code) and the Cars data map.
- **[Compliance](./compliance/)**: PCI DSS SAQ A and the privacy obligations per country.
- **[Accessibility](./accessibility/)**: the WCAG 2.2 AA conformance table.
- **[Legal](./legal/)**: the register of websites read for prices.

## For developers

- **[Guides](./guides/)**: adding an agent, a tool or a prompt version; adding a web-data vendor
  or a site to read.
- **[Audits](./audits/)** and **[research](./research/)**: the end to end audit, the feature
  parity audit and the partner supply research behind ADR-069.
