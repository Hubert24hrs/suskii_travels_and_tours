# ADR-026: Visa assistance and document security

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for an eligibility checker (nationality x destination x purpose) backed by an
admin-maintained rules table, visa assistance products with a document checklist, secure document
upload (virus-scanned, encrypted, signed URLs), status tracking and officer notes, and a clear
disclaimer that the issuing government decides. Acceptance: documents are encrypted and only
accessible through signed URLs, by their owner and by visa officers. Passports and visa documents
are among the most sensitive data the platform holds.

## Decisions

1. **Eligibility.** `visa_rules` rows (nationality, destination, purpose, requirement:
   `visa_free`, `visa_on_arrival`, `e_visa`, `visa_required` or `not_available`, maximum stay,
   notes, last verified date) are maintained by visa officers. Without a rule the API answers
   `unknown` and the page offers to confirm by contacting us; it never guesses.
2. **Products and applications.** A `visa_products` row (destination, purposes, processing time,
   service fee, document checklist) is bought like any product: the booking pays the assistance
   fee and, when confirmed, opens one `visa_applications` row per applicant. Statuses:
   `awaiting_documents`, `submitted`, `in_review`, `action_required`, `lodged` (with the
   authority), `approved`, `refused`, `withdrawn`. Every change is a `visa_application_events` row
   (and an audit entry); officers write messages the customer sees and internal notes they do not.
3. **Upload.** Owners (session, or the guest booking token) upload one file per checklist item
   through the API: at most `VISA_DOCUMENT_MAX_BYTES` (10 MB), type sniffed from the bytes (PDF,
   JPEG, PNG; the declared type and extension are ignored), the file name reduced to a safe form
   and stored encrypted.
4. **Encryption.** Each document gets a random 256-bit data key; the bytes are encrypted with
   AES-256-GCM (the document id as additional data) and stored in private object storage; the
   data key is wrapped by `FieldEncryption` with the context `visa-document:{id}` (envelope
   encryption, moving to the cloud KMS with the rest of field encryption). A SHA-256 of the
   plaintext detects tampering. Storage never holds plaintext.
5. **Scanning.** `AntivirusScanner` with `ClamAvScanner` (clamd `INSTREAM` over TCP) and
   `MockAntivirusScanner` (flags the EICAR test file), selected by `ANTIVIRUS_PROVIDER`;
   production refuses the mock unless `ALLOW_MOCK_PROVIDERS=true`. New documents are
   `pending_scan` and scanned in the background right after upload; a worker job retries pending
   ones. Until a document is `clean` it cannot be linked, reviewed or counted for submission; an
   infected file is deleted, marked `infected` and audited, and the customer is asked for another.
6. **Signed URLs.** Bytes are only served by `GET /v1/visa/documents/{id}/content` with
   `expires`, `viewer` and `signature` query parameters: an HMAC (per-purpose key
   `visa-document-url`) over the document id, the expiry and the viewer, valid for
   `VISA_DOCUMENT_URL_TTL_SECONDS` (five minutes). Links are minted only for the application's
   owner (booking owner session or guest token) or a visa officer (`visa:process` through
   `AdminRoute`: staff, MFA session, IP allowlist); anyone else gets 404. The content route
   decrypts, verifies the hash and answers with `Content-Disposition: attachment`,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and a sandbox CSP. Minting and
   every access are audited with the viewer.
7. **Retention.** Documents are deleted `VISA_DOCUMENT_RETENTION_DAYS` (90) after the
   application closes (approved, refused or withdrawn) by a worker job; the application keeps only
   metadata.
8. **Disclaimer.** Product pages, checkout, the application page, PDFs and emails state that Suskii
   provides assistance and the issuing government decides.

## Consequences

- Staff never download files outside audited, expiring links; the admin console (phase 10) uses
  the same officer routes.
- Real eligibility rules and product checklists must be entered by the owner's visa team; demo data
  is flagged as sample.
- ClamAV needs about 1 GB of memory for its signatures; local development uses the mock scanner by
  default and `docker compose --profile av` runs ClamAV when needed.
