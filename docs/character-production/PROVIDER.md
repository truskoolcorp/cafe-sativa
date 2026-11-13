# Provider contract

The HeyGen adapter uses the inspected official connector inputs, not a guessed REST endpoint. Exact account, avatar look, model, canonical revision, portrait, voice and fixed 9:16/1080p/MP4 settings are bound into a versioned digest. Current inventory must contain one exact completed supported look and one exact ACTIVE voice. Names/defaults never substitute identity.

Creation and nonterminal status codecs are injected and require independently verified provider contracts. Only the observed completed envelope is supplied. No creation retry occurs. Status reads retain the original task, are throttled per adapter instance, and reject binding changes. Download accepts exact configured HTTPS origins, pins public IPv4 DNS, rejects redirects and bounds stream size/time before buffering.

## Important deployment gap

The canonical registry's voice identities are ElevenLabs identities. This text-voice HeyGen adapter must not be enabled by copying those IDs or substituting same-name HeyGen defaults. Approved provider voice equivalence or a separately reviewed canonical-audio workflow is required. Audio workflow additions are not part of this draft's approved scope. Provider inventory availability does not grant likeness, voice, upload, spending or publication permission.

Actual creation receipt and pending/failed contracts, selected look mappings, authorized no-retry transport, measured pricing and cross-process polling cadence remain deployment prerequisites. Requested duration is not a provider billing guarantee.
