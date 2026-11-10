# ADR-105: The agent's data: conversations, memory, knowledge and retention

- Status: Accepted
- Date: 2026-11-10
- Deciders: Claude Code (implementer), pending owner review

## Context

An assistant that talks with travellers and staff creates new personal data (what people write),
new operational records (runs, tool calls, approvals, costs) and new reference data (policies it
answers from, sites it reads). Every Prisma model needs an entry in `DATA_REGISTRY` and every
encrypted column an entry in `ENCRYPTED_FIELDS` (ADR-029, ADR-038, ADR-039).

## Decision

### The records

| Model                                                                                             | Holds                                                                                                                         | For the person                                   |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `AgentConversation`, `AgentMessage`                                                               | A conversation and its messages; bodies encrypted per message                                                                 | exported; deleted with the account or on request |
| `AgentRun`, `AgentToolCall`                                                                       | Ids, timings, model, prompt version, tokens, cost, outcome; tool names and argument keys, never values that identify a person | kept as operations data, then purged             |
| `AgentApproval`                                                                                   | A pending or decided approval, who asked and who decided                                                                      | retained (audit)                                 |
| `AgentMemory`                                                                                     | Preferences a traveller agreed to keep                                                                                        | exported; editable; deleted with the account     |
| `AgentSetting`                                                                                    | Autonomy levels, flags and limits                                                                                             | no personal data                                 |
| `KnowledgeDocument`, `KnowledgeChunk`                                                             | Company policies and travel documents staff upload                                                                            | no personal data                                 |
| `PriceSource`, `SourcePolicy`, `ScrapeJob`, `ScrapeAttempt`, `PriceObservation`, `ProviderBudget` | Sites, rules, reads and prices (ADR-102)                                                                                      | no personal data                                 |
| `AssistedQuote`                                                                                   | A request to confirm a price (ADR-104)                                                                                        | exported; redacted on deletion                   |

Migrations are expand-only. The registry test and the encrypted-fields test fail until each
model is listed.

### What a model is shown

A message is stored as the traveller wrote it, encrypted (`agent-message:{id}:body`). The model
gets a scrubbed copy (`scrubQuery`): no address, phone number, card or document-like number.
Tool results reach the model as facts under keys (`booking.status`, `flight.1.departure`,
`quote.total`), as in ADR-085: never a name, a contact detail, a passport, a ticket number, a
confirmation code or a payment detail.

### Memory is separate, small and chosen

`AgentMemory` is not conversation text. It is a short list of named preferences (home airport,
cabin, seat, preferred airlines, budget band, currency and language), written only after the
traveller agrees, shown to them, editable and erasable. It never holds a sensitive category.
A meal preference can show a religion or a health condition (ADR-093), so it is not remembered
until counsel says how; that is an open question for the owner.

### Knowledge is searched with PostgreSQL

Staff upload documents through the console: virus-scanned (`AntivirusScanner`), size-limited,
stored in object storage behind signed links. Text is split into `KnowledgeChunk` rows with a
generated `tsvector` column and a GIN index; retrieval is PostgreSQL full-text search ranked by
`ts_rank`, filtered by locale and audience (customer or staff).

`pgvector` was evaluated and not adopted now: the PostgreSQL images used locally and in CI do
not carry it, embeddings would add a vendor that receives the text, and the knowledge base is
small (policies and FAQs). The chunk table can take an embedding column later without changing
its callers.

An answer cites the chunks it used. Retrieved text is reference, never proof of a booking or a
payment, and never an instruction (ADR-107).

### Retention

| Data                                         | Kept                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Conversations and messages                   | `AGENT_CONVERSATION_RETENTION_DAYS` after the last message (default 365), or until the traveller deletes them |
| Checkpoints                                  | until the thread has been idle 30 days (ADR-103)                                                              |
| Runs and tool calls                          | 400 days                                                                                                      |
| Scrape jobs and attempts                     | 90 days                                                                                                       |
| Price observations                           | 400 days, as fare history is (ADR-080)                                                                        |
| Page snapshots in object storage             | 7 days                                                                                                        |
| Approvals and assisted quotes with a booking | with the financial records                                                                                    |

## Rejected

- **Storing the scrubbed text only.** The traveller could not see or export what they wrote.
- **One store for memory and conversations.** Erasing a preference must not mean erasing a
  conversation, and the reverse.
- **A hosted vector database.** A paid service and a new recipient of text, for a problem
  full-text search answers at this size.

## Consequences

- Sixteen new tables, each with an owner in the registry and the records of processing.
- The model provider receives scrubbed conversation text and facts; it is already a recipient in
  the records of processing for AI trip search and the support assistant, and the purpose list
  grows.
- Knowledge answers are only as good as what staff upload; an empty base hands over to a person.
