/**
 * Café Sativa canonical asset resolver — server-side only.
 * Reads the authoritative Supabase registry, retrieves the exact approved bytes,
 * validates the SHA-256 digest and refuses substitutions.
 * No writes, billable generation, public publishing or fallback to invented art.
 */
import { createHash } from "node:crypto";

export type CanonicalAsset = {
  id: string; kind: string; subject: string; url: string;
  sha256: string; version: string; active: boolean;
  approved_at: string | null;
};

export class CanonicalAssetError extends Error {
  readonly code: string;\n  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function resolveCanonicalAsset(
  kind: string,
  subject: string,
  env = process.env,
): Promise<{ asset: CanonicalAsset; bytes: Uint8Array; sha256: string }> {
  const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new CanonicalAssetError("CONFIG_MISSING", "Server-only registry credentials unavailable");
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== "https:") throw new CanonicalAssetError("CONFIG_INVALID", "HTTPS registry required");

  const api = new URL("/rest/v1/cs_canonical_assets", baseUrl);
  api.searchParams.set("select", "id,kind,subject,url,sha256,version,active,approved_at");
  api.searchParams.set("kind", "eq." + kind);
  api.searchParams.set("subject", "eq." + subject);
  api.searchParams.set("active", "eq.true");
  api.searchParams.set("limit", "2");
  const resp = await fetch(api, { headers: { apikey: key, Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new CanonicalAssetError("REGISTRY_UNAVAILABLE", "Canonical registry request failed: HTTP " + resp.status);
  const matches = (await resp.json()) as CanonicalAsset[];
  if (matches.length !== 1) throw new CanonicalAssetError(matches.length ? "AMBIGUOUS" : "NOT_FOUND", "Exactly one active approved reference is required for " + kind + "/" + subject);
  const asset = matches[0];
  if (!asset.approved_at) throw new CanonicalAssetError("NOT_APPROVED", "Asset has no recorded approval");
  if (!/^[0-9a-f]{64}$/i.test(asset.sha256)) throw new CanonicalAssetError("INVALID_DIGEST", "Registry lacks valid SHA-256");
  const source = new URL(asset.url);
  if (source.protocol !== "https:" || source.host !== baseUrl.host ||
      !source.pathname.startsWith("/storage/v1/object/public/cafe-sativa-canon/") ||
      source.username || source.password) {
    throw new CanonicalAssetError("INVALID_SOURCE", "Canonical media URL is not the approved storage origin");
  }
  const media = await fetch(source, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!media.ok) throw new CanonicalAssetError("OBJECT_UNAVAILABLE", "Canonical media is unavailable: HTTP " + media.status);
  const bytes = new Uint8Array(await media.arrayBuffer());
  if (!bytes.length || bytes.length > 30_000_000) throw new CanonicalAssetError("OBJECT_SIZE", "Canonical media size invalid");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest.toLowerCase() !== asset.sha256.toLowerCase())
    throw new CanonicalAssetError("DIGEST_MISMATCH", "Canonical media did not match approved checksum");
  return { asset, bytes, sha256: digest };
}
