# Two-phase output capability (unmounted, review only)

Avoids sending MP4s through a Vercel request body. Authenticated trusted backend
accepts a small exact job/hash/size request; DB reserves one immutable upload
intent per claimed job. Existing server-only Storage client signs that exact
private path, upsert:false. Worker uploads directly using fixed project Storage
SDK and token. Backend finalize streams bounded readback, validates size, SHA256
and MP4 ftyp, then atomically checks current authorization and lease before the
existing pending_qa receipt. Nothing approves QA or publishes.

The backend's existing broad Storage credential remains server-only. This is an
application authorization boundary, NOT a claim that this backend is DB-isolated.
Generator gets only exact-path upload token, never broad credentials or arbitrary
URLs. A new narrow RPC grant is still required for these three functions; no
existing service-role access to the ledger is assumed. No grants, bucket, role,
route, credentials or activation are installed by this code.

## Capability lifetime and residual risk

Supabase createSignedUploadUrl takes upsert, NOT expiresIn, and its upload tokens
are valid for2 hours. The app's120-second lease controls finalize eligibility; it
DOES NOT revoke an issued upload token. After expiry/revocation, that token may
still insert arbitrary bytes at its ONE exact path until provider expiry, bounded
by the real bucket video/mp4 MIME and <=35MiB limit. Invalid bytes never attest;
one bad first upload can poison the path and requires human reconciliation, not
overwrite/retry or another path. A signature is not an upload or validated receipt.

Reserve is consumed before signing; timeout/unknown result means no re-signing.
Repeated reserve or changed hash/size fails. Concurrent DB claim yields one winner.
Finalize may be repeated only as fresh readback plus atomic current authority
checks; expired intents remain consumed. Locks follow approved-slot/budget/job
order during finalize. No counter reset, deletion, regeneration or provider spend.

## Remaining wiring before any live route

- Independent review plus disposable PG17 tests for exact proposal; install under
  existing owner and grant ONLY intended authenticated backend identity.
- Create/verify private character-production-private bucket with actual max bytes
  and MIME restrictions, and prove signed token cannot upsert on provider API.
- Mount separate authenticated small-JSON reserve/finalize handlers with bounded
  body, deadline, replay protections, exact expected provider/model scope and
  per-worker credential validation. No public or browser cookie-only endpoint.
- Existing factory compares claim token and all receipt identity fields using
  constant-time digest comparisons after authoritative SQL proof. SQL validates
  the submitted token against stored job before issuing the signing intent.
- Fixed-project worker SDK upload client; no automatic retry on ambiguous upload.
- Test real hosted Storage replay/overwrite/partial-write behavior in staging.

Official provider contract checked against installed SDK and docs:
https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl
