# Driver document backlog

**Alert:** `DriverDocumentBacklog` (the oldest scanned driver document has waited more than 2
days, or more than 100 are waiting).
**Dashboard:** Suskii operations, Cars row: driver documents to review.
**Background:** ADR-050 (driver onboarding, KYC and documents).

## How review works

- An applicant uploads five documents (licence, vehicle registration, insurance,
  roadworthiness, selfie) from driver mode. Each is encrypted with its own key and virus-scanned
  in the background; a clean file waits for a reviewer as `clean`.
- Approval needs verified identity and licence checks (or a reviewer's manual check when the KYC
  provider could not answer), every document approved and an approved vehicle. Approving grants
  the `driver` role and needs a fresh authenticator code (step-up).
- Documents whose background scan was lost are scanned again every few minutes by the worker
  (`driver-documents-scan` on the `rides` queue, `/v1/internal/drivers/documents/scan-due`).

## 1. Is it reviewers or scanning?

1. `suskii_driver_documents_awaiting_review` high: documents are clean and waiting for people.
   Go to step 2.
2. Applicants say their documents stay at "Checking the file": scanning is stuck. Check the
   worker log for `driver documents scanned` and the antivirus provider (`ANTIVIRUS_PROVIDER`).
   Run one pass by hand:

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
     "$API_INTERNAL_URL/v1/internal/drivers/documents/scan-due"
   ```

## 2. Work the queue

1. Console, **Drivers**, filter `Pending`. The list shows documents and vehicles to review per
   applicant; oldest applications first.
2. Open each applicant, download documents (each download is audited), approve or reject each
   with a reason, then approve or reject the application.
3. Reviewers need `drivers:review` (operations and super admins). If the queue is beyond the
   team, the operations lead can grant the operations role temporarily (console, Users; the
   change is audited and needs step-up).
4. Never approve without opening the documents, and never tick a manual identity or licence
   check unless the provider really could not answer: a `mismatch` or `not_found` cannot be
   overridden.

## 3. Verify

- `suskii_driver_documents_oldest_age_seconds` under a day and falling.
- Approved drivers can go online (they sign in again to pick up the driver role).
