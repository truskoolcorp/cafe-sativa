# Café Sativa character storage and replica audit — 2026-10-25

## Production assets
Supabase project: `nwfxvhqbjtfvoopcadff`, production `cafe-sativa-prod`.
Private bucket `cafe-sativa-characters` exists with 10 MB limit and PNG/JPEG/WebP/JSON allowed. **Zero objects uploaded** on the verification query. Supabase Storage paths do not appear as directories until object bytes are uploaded. Do not create object metadata without real bytes, and never migrate/replace venue masters during character upload.
Owner-approved Zaria source images are five Foxy files (`Zaria_Conon_4-5.jpeg` and variants -1,-2,-3,-5). The generated Gallery image is a candidate, not approved canon. An upload-ready package exists in the conversation attachments but is not itself a Supabase upload.

## Database separation
Neon Tru Skool org project `twilight-dream-09426151` is named `cafe-sativa-staging`, **not production**. It contains schemas `cs_replication_v1` and `cs_validation`. The replication checkpoint has 0 rows, inbox has 0 rows, outbox has 6 rows; all six outbox events are isolated test streams dated 2026-10-17. This is not evidence of successful current Supabase-to-Neon or Neon-to-Supabase replication.
Supabase production contains the `public.cs_character_promo_drafts` table and 11 draft records; Neon staging does **not** contain that table. Supabase production lacks `cs_replication_v1` schema.
**Conclusion:** active synchronization, cross-database consistency and failover are not established. Do not flip primary/fallback, enable dual-writes or promote Neon staging as current production automatically.
To establish recovery: decide authoritative system/table inventory; compare schemas and record-level hashes, implement idempotent event replication with ack checkpoints and conflict fences, run isolated replay and controlled failover rehearsal; preserve publication approval gates.

## Next authorized low-risk actions
1. Upload real approved files to private `cafe-sativa-characters/zaria-solenne/approved/` through an authenticated Storage client, then read back and SHA-256 compare; do not invent placeholders.
2. Keep Gallery portrait in `venue-references/` as candidate until approved match confirmed.
3. Create equivalents for other hosts only from their separately owner-approved masters.
4. Keep Facebook/Instagram/TikTok deliveries `blocked_assets` until video QA and publication gates are satisfied.
