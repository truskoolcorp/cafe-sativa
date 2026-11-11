# Disabled character-production engine

This proposal adds injectable generation, canonical verification, durable budget/claim storage, provider collection and private QA ingestion. No route, cron, credential, migration application or publication activation is included. Default runtime opens no dependencies.

Each exact slot binds the character, script, canonical revision, portrait, voice, provider/model and provider binding revision, authorization expiry, period and quote/cap. Validation runs before a non-reclaimable durable claim and again afterward. Ambiguous submissions retain their reservation and do not regenerate. Collection uses only the original task and exact provider binding; private output stops at pending QA.

The PostgreSQL proposals live outside migrations and grant no execution access by default. Deployment requires explicit reviewed role grants, private bucket ACLs, approved provider/character mappings and price/cadence authority. Existing canonical normalization is injected from current application source, never a registry snapshot.

## Verification and reconstruction

This is a reconstructed candidate after the earlier local artifact became unavailable. It has the same proposed 35-file scope but is not byte-identical and does not inherit earlier test results. Tests and review must be run against this candidate. Changes include rewritten engine validation/queue handling and freshly written adversarial fixtures. See REVIEW.md and CI for current results. No whole-application build or real-provider acceptance is claimed.

The CI workflows use synthetic data and an ephemeral PostgreSQL service without production/provider secrets. Vercel suppression applies only to internal-character-production-engine-20261111. Main and existing crons are unchanged; this draft is not deployment approval.
