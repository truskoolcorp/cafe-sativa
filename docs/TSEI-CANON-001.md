# TSEI-CANON-001 — Canonical Source Only
Effective: 2026-10-10. Owner: Tru Skool Entertainment International Corporation.

## Mandatory rules
1. The current owner-approved GLYPH / Tru Skool Studio registry is the only authority for existing character identities, including Keith, Laviche and all other registered personas.
2. Café Sativa's approved virtual twin and brand registry are the only authorities for established spaces, geometry, materials, signage and logos.
3. Never substitute screenshots, historical drafts, generated lookalikes, inferred likenesses, improvised identities or unapproved venue renders for primary canonical assets.
4. Resolve authoritative asset IDs, approval state, provenance, storage availability and versions **server-side** before character- or venue-dependent image/video generation. Missing, conflicting or inaccessible evidence is a hard block, not a text-only prompt warning.
5. Attach approved reference media to the selected provider. If that route cannot support the reference requirements, fail closed instead of silently using text-to-image, text-to-video, or a provider with weakened reference fidelity.
6. Validate every generated asset against source records before approval or publication. A provider success is not a canonical-quality pass. Human approval remains necessary for uncertain likeness or scene fidelity. Do not claim pixel-perfect preservation is guaranteed.
7. Project wardrobe variants require owner authorization and must never overwrite the original product master. Hit 'Em Laviche dress: official FF print, button front, no pockets, longer hem, one-sided drawstrings only.
8. Keep project assets and outputs versioned and traceable to master IDs. Generated results never automatically become canon.
9. Apply these rules to previews, scheduled content, publishing, B-roll, marketing and all integration endpoints, not only interactive UI.
10. Exceptions require explicit owner approval and audit logging; no hidden bypass or automated softening.

## Mandatory deployment acceptance tests
- Missing primary asset → generation blocked.
- Primary asset ID mismatch → generation blocked.
- Unapproved reference or inaccessible blob → generation blocked.
- Caller-supplied lookalike overrides → blocked.
- Multi-character jobs must verify all subjects; an unverified existing subject must block.
- Venue/brand jobs must resolve approved virtual-twin/version and exact logo.
- Provider lacking required image conditioning → blocked.
- Failed visual QA → never publish or mark approved.
- Scheduled and asynchronous routes must follow the same checks.
- Verify enforcement on live production endpoints after deploy; code presence alone is not proof.

Policy language is not a substitute for wiring each generation/publish pathway.