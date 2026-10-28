# Privacy obligations per country

What Nigeria's, Kenya's and South Africa's data protection laws ask of Suskii, where the platform
already meets it, and what only the owner can do (register, appoint, sign, file). The EU and UK
GDPR apply to travellers in Europe and to data hosted in London (ADR-059), and are listed for
comparison. Deadlines that code enforces live in one place (part 2 of item 13, ADR-089) and come
from this table.

This is an engineering summary, not legal advice. Sources are linked at the end; every row marked
"confirm" needs the owner's counsel before launch in that market.

## Shared foundations (all markets)

| Obligation                       | How the platform meets it                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know what is held and why        | `DATA_REGISTRY` lists every table's personal data, export section, deletion and retention (ADR-029, ADR-039); `docs/security/data-classification.md` |
| Access and portability           | Self-service data export from Account (JSON), with re-authentication (ADR-029)                                                                       |
| Rectification                    | Profile, saved travellers and contact details are editable; booking passenger details through support                                                |
| Erasure                          | Self-service account deletion; financial records kept without contact data for the legal period (ADR-029)                                            |
| Objection to marketing           | Per-channel preferences; marketing only with recorded consent (ADR-032); newsletter double opt-in (ADR-012); ads only after consent (ADR-079)        |
| Cookies and similar technologies | Consent before optional categories; catalogue of every cookie and key (ADR-042)                                                                      |
| Security of processing           | Encryption at rest per field, TLS everywhere, MFA for staff, audit log, rate limits (ADR-037, ADR-038, ADR-048)                                      |
| Retention limits                 | Daily retention sweep with a rule per growing table (ADR-039)                                                                                        |
| Processors and transfers         | `docs/security/external-communications.md` lists every outbound party and what it receives                                                           |
| Breach response                  | [Personal data breach runbook](../runbooks/personal-data-breach.md)                                                                                  |

## Nigeria: Nigeria Data Protection Act 2023 and the GAID 2025

The General Application and Implementation Directive (GAID) took effect on 19 September 2025 and
replaced the NDPR and its implementation framework.

| Obligation              | Rule                                                                                                                                                                                        | Platform                                                    | Owner                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Registration            | Data controllers and processors of major importance register with the NDPC; GAID tiers (ordinary, extra and ultra high level) depend on the number of data subjects in six months (confirm) | -                                                           | Register, pay the tier fee, update changes within 60 days |
| Data protection officer | Required for controllers of major importance                                                                                                                                                | -                                                           | Appoint and publish the DPO contact                       |
| Compliance audit return | Filed yearly by the higher tiers through a licensed data protection compliance organisation (due 31 March; confirm the first filing date)                                                   | Evidence pack: this page, the registers                     | Engage a DPCO; file                                       |
| Breach notification     | The NDPC within 72 hours of becoming aware (NDPA s. 40); data subjects immediately when the breach is likely to be high risk                                                                | Runbook; breach register with deadlines (part 2)            | Submit the notification                                   |
| Data subject requests   | Access, rectification, erasure, portability, objection; answered without undue delay (no fixed day count found; internal target 30 days)                                                    | Self-service export and deletion; request register (part 2) | -                                                         |
| Impact assessments      | Before processing likely to be high risk (for example automated payment risk scoring, ADR-040; the AI features, ADR-061 and ADR-085)                                                        | Design docs and ADRs as inputs                              | Commission the DPIAs                                      |
| Cross-border transfers  | Only with adequate protection or another basis in NDPA ss. 41 to 43; data is hosted in London and processed by suppliers abroad                                                             | Transfer register (part 2)                                  | Confirm the basis per recipient with counsel              |
| Privacy notice          | Purposes, bases, recipients, transfers, retention, rights and contacts                                                                                                                      | -                                                           | Publish the policy (open question since phase 4)          |

## Kenya: Data Protection Act 2019 and its 2021 regulations

| Obligation             | Rule                                                                                                                                                                                                                          | Platform                              | Owner                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------- |
| Registration           | Controllers and processors register with the Office of the Data Protection Commissioner unless exempt by turnover and staff; some sectors must register regardless (confirm whether travel and transport services are listed) | -                                     | Register before selling in Kenya |
| Access requests        | Within **7 days** of the request, free of charge (General Regulations, reg. 9(4) and (6))                                                                                                                                     | Self-service export answers at once   | -                                |
| Rectification          | Within **14 days** (reg. 10(4))                                                                                                                                                                                               | Request register (part 2)             | -                                |
| Erasure                | Within **14 days** (reg. 12(3))                                                                                                                                                                                               | Self-service deletion answers at once | -                                |
| Breach notification    | The Data Commissioner without delay and within 72 hours of becoming aware (DPA s. 43); processors tell the controller within 48 hours; data subjects without undue delay where there is a real risk of harm                   | Runbook; breach register (part 2)     | Submit the notification          |
| Direct marketing       | Only with consent and an easy way to stop (confirm the section)                                                                                                                                                               | Recorded consent, preferences         | -                                |
| Impact assessments     | Before high-risk processing (DPA s. 31)                                                                                                                                                                                       | Inputs as for Nigeria                 | Commission the DPIAs             |
| Cross-border transfers | Only with proof of safeguards or another basis (DPA ss. 48 to 50); processing for the state's strategic interests must stay in Kenya (confirm it does not apply to travel bookings)                                           | Transfer register (part 2)            | Confirm the basis per recipient  |

## South Africa: POPIA and its regulations (amended 17 April 2025)

| Obligation             | Rule                                                                                                                                                                                                                     | Platform                                                    | Owner                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| Information Officer    | The Information Officer and deputies are registered with the Information Regulator (s. 55)                                                                                                                               | -                                                           | Register the Information Officer              |
| PAIA manual            | A manual describing records held and how to request them                                                                                                                                                                 | `DATA_REGISTRY` as the record list                          | Publish the manual                            |
| Security compromises   | The Regulator and data subjects as soon as reasonably possible (s. 22); reports go through the Regulator's eServices portal, and the Regulator expects every compromise reported; an investigation need not finish first | Runbook; breach register (part 2), internal target 72 hours | Report through the portal                     |
| Access requests        | Through the PAIA procedure, answered within 30 days (confirm the section for private bodies)                                                                                                                             | Self-service export                                         | -                                             |
| Direct marketing       | Unsolicited electronic marketing needs prior consent (s. 69); opt-out is not consent (amended reg. 6); a non-customer may be asked for consent only once                                                                 | Recorded opt-in only; no pre-ticked boxes                   | Never buy or import contact lists             |
| Operators              | Written agreements with every processor (ss. 20 and 21)                                                                                                                                                                  | External communications list                                | Sign data processing terms with each supplier |
| Cross-border transfers | Only to a recipient bound by adequate law or a binding agreement, with consent, or as needed for the contract (s. 72)                                                                                                    | Transfer register (part 2)                                  | Confirm the basis per recipient               |

## For comparison: EU GDPR and UK GDPR

Breach notification to the supervisory authority within 72 hours (Art. 33), data subjects without
undue delay when the risk is high (Art. 34), requests answered within one month, extendable by two
(Art. 12(3)), and an EU or UK representative when selling to people there without an establishment
(Art. 27).

## Sources

- PCI and SAQ A: [SecurityMetrics on the 2025 SAQ A](https://msfw.securitymetrics.com/blog/big-changes-for-saq-a), [TrustedSec](https://trustedsec.com/blog/the-hidden-trap-in-the-pci-dss-saq-a-changes)
- Nigeria: [NDPC: NDPA and GAID 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf), [Banwo & Ighodalo synoptic analysis](https://www.banwo-ighodalo.com/grey-matter/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025/), [Adeola Oyinlade & Co](https://www.adeolaoyinlade.com/en/key-regulatory-updates-under-the-2025-general-application-and-implementation-directive-gaid-issued-by-the-nigeria-data-protection-commission-ndpc/)
- Kenya: [Data Protection (General) Regulations 2021, Kenya Law](https://new.kenyalaw.org/akn/ke/act/ln/2021/263/eng@2022-01-14), [Bowmans on breaches](https://bowmanslaw.com/insights/kenya-a-few-insights-on-navigating-data-breaches-in-kenya-under-the-kenyan-data-protection-law/)
- South Africa: [Information Regulator: POPIA](https://inforegulator.org.za/popia/), [Cliffe Dekker Hofmeyr on the 2025 amendments](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Sectors/Technology-Communications/Technology-and-Communications-Alert-21-May-Important-POPIA-amendments-to-note), [Baker McKenzie](https://insightplus.bakermckenzie.com/bm/data-technology/south-africa-amendments-to-the-popia-regulations-key-changes-you-need-to-know)

Researched 28 October 2026. Some primary sites (the ODPC and some law firm pages) could not be
reached from the build environment; their rows rely on the gazetted text published by Kenya Law
and on the commentary linked above.
