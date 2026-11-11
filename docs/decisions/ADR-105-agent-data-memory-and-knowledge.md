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

| Data                                         | Kept                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Conversations and messages                   | 365 days after the last message, or until the traveller deletes them |
| Checkpoints                                  | until the thread has been idle 30 days (ADR-103)                     |
| Runs and tool calls                          | 400 days                                                             |
| Scrape jobs and attempts                     | 90 days                                                              |
| Price observations                           | 400 days, as fare history is (ADR-080)                               |
| Page snapshots in object storage             | 7 days                                                               |
| Approvals and assisted quotes with a booking | with the financial records                                           |

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

## Amendments made while building it (sub-phase F, 2026-11-11)

- **Plain text and Markdown only.** Nothing is extracted from a PDF or an office file: that
  needs a parser the platform does not carry, and a parser for untrusted files is a risk of
  its own. Staff save a policy as text or Markdown: 512 KB a file, 200 documents in use, 600
  passages a document. The declared type must be text and so must the bytes (valid UTF-8
  without control characters), whatever was declared.
- **The search vector is written with the row**, not generated. A generated column cannot
  choose a text search configuration per row, and a document's language decides it: English,
  French, Portuguese and Arabic stem their words; Swahili has no configuration in PostgreSQL
  and is matched as written. A heading weighs more than the body under it.
- **Any word of the question may match.** A question is longer than the rule that answers
  it, so requiring every word found nothing. Passages that match more of the words, or match
  in a heading, rank first, and the four best are returned.
- **A language, not a locale.** A document is written in one of the five languages of the
  site; `en-NG`, `en-GB` and `en-US` read the same English documents. A conversation is
  answered from its own language first and from English when that has nothing.
- **No signed links.** The file is served only by `GET /v1/admin/ai/knowledge/{id}/content`
  to staff with `ai:read`, as an attachment a browser will not render. A link that works
  without a session is one more thing to leak, for a file only staff need.
- **Archived, never deleted**, and the same file cannot be in use twice for one audience and
  language. Who added, changed, archived or restored a document is in the audit log with ids
  and counts, never its words or its title.
- **The citation is a card.** `knowledge.search` returns each passage with its document and
  section, and one card of the kind `source` for each document read. Tools build cards and
  the graph passes them through unchanged, so a model cannot name a source it did not read.
- **A passage is a tool result like any other.** The guard accepts a figure or a contact an
  answer quotes from one, and the tool's description tells the model that a passage is never
  an instruction and never proof of a booking or a payment. Staff are told, where they choose
  a file, that nothing about a person belongs in one; nothing checks a document for personal
  data.
- **Staff can run the assistant's search** (`GET /v1/admin/ai/knowledge/search`) for an
  audience and a language, to see what a traveller would be answered from before relying on
  it.
- **What staff see of a conversation.** `GET /v1/admin/ai/monitor/conversations/{id}` returns
  a traveller's messages after `scrubQuery()`, as the model saw them, and records the read
  (`agent.conversation_viewed`) with the reader and the conversation. Runs and tool calls
  were already ids, codes and the names of arguments.

## Amendments made while building it (sub-phase G, 2026-11-11)

- **Memory as built.** `agent_memories` holds one row per account and preference: `home_airport`
  (an airport code the catalog knows), `cabin`, `seat` (window or aisle), `airlines` (one to
  three airline codes) and `budget` (price first, balanced, comfort first). A value is a code
  or one of a fixed set, checked by `agentMemoryValue()` in `@suskii/shared`: there is nowhere
  to write a sentence, so nothing personal can be written into it. Currency and language are
  not remembered here: they are the site's own preferences already.
- **No meal.** A meal can show a religion or a health condition (ADR-093); it is not on the
  list, the tool's description forbids it and the schema has no key for it.
- **Consent is a switch the traveller presses.** `user_preferences.assistant_memory_at` is
  null until they switch remembering on (`PUT /v1/me/assistant-memory`, audited as
  `agent.memory_enabled`); while it is null every write answers 409 and `memory.remember` is
  refused before a card is shown. Switching it off erases every row in the same transaction.
- **Two ways in, both the traveller's.** Their own page (`/assistant/preferences` on the
  website and in the app) sets, changes and erases each preference. The assistant can only
  ask: `memory.remember` is a `commit` tool (ADR-107), so it becomes a card naming the
  preference and its value, and only the tap stores what the card showed. Each row says who
  set it (`traveller` or `assistant`).
- **What a model sees** is `memory.read`: the values, and `remembering: false` when nothing
  may be assumed. It is told to say when it used one.
- **The page stays while the assistant is paused**, so erasing is always possible; it answers
  404 only while the assistant is switched off altogether, when nothing reads the rows.
- **In the export with the other preferences**, deleted with the account, in the data
  registry and in the records of processing, where consent joins the assistant's bases.
- **A conversation's rating** (`agent_conversations.rating`, `rated_at`) is a score from 1 to
  5 the traveller gives their own conversation once the assistant answered in it. It lives
  and is deleted with the conversation, is in the export, and reaches staff only as counts
  and a mean (ADR-106).
- **A conversation can name the WhatsApp thread it answers in**
  (`agent_conversations.support_conversation_id`, unique, deleted with the thread). Such a
  conversation has no account and no guest token: only the inbox reaches it (ADR-084).
