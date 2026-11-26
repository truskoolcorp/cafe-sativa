"""Zaria-only admission and private bridge; no provider or SDK dependencies."""
import asyncio
from dataclasses import dataclass, field
from ipaddress import ip_address
import json
import re
from urllib.parse import urlsplit

VOICE = "5zneNR4v1Uw5AjIZ9Un4"
MODEL = "eleven_v4"
HOST = "zaria"
AGENT = "cafe-sativa-zaria"
PROTOCOL = "zaria-gallery-turn-v1"
PREVIEW_AUDIENCE = "zaria-private-staging"
PRODUCTION_AUDIENCE = "zaria-approved-production"
ADMIT_TIMEOUT_SEC = 5
TURN_TIMEOUT_SEC = 18  # allows the web bridge's 12s model timeout plus bounded overhead
BRIDGE_PREFIX = "/api/concierge/zaria/voice-v1"
DNS = re.compile(r"(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+")
ROOM = re.compile(r"^[\w-]{1,120}$", re.ASCII)

class Unavailable(Exception):
    """Safe generic diagnostic. Do not show underlying provider or payload errors."""

def origin(raw, scheme):
    try:
        u = urlsplit(raw)
        h = u.hostname
        if (u.scheme != scheme or not h or not DNS.fullmatch(h) or u.username
            or u.password or u.port is not None or u.query or u.fragment
            or u.path not in ("", "/") or u.netloc != h or h.endswith((".local", ".localhost"))
            or h in ("localhost", "cafe-sativa.com", "www.cafe-sativa.com")
            or h.endswith(".cafe-sativa.com")
            or h == "virtual-cafe-sativa-glyph-protocol.vercel.app"):
            raise ValueError
        try:
            ip_address(h)
        except ValueError:
            return f"{scheme}://{h}"
        raise ValueError
    except (TypeError, ValueError):
        raise Unavailable("Private origin unavailable") from None

@dataclass(frozen=True)
class Settings:
    bridge_origin: str
    room_url: str
    room_key: str = field(repr=False)
    room_secret: str = field(repr=False)
    tts_key: str = field(repr=False)
    stt_key: str = field(repr=False)
    vercel_bypass: str = field(repr=False)
    audience: str

    @classmethod
    def read(cls, env):
        worker_env = env.get("CS_ZARIA_WORKER_ENV")
        if (env.get("CS_ZARIA_WORKER_ENABLED") != "true"
            or worker_env not in ("private-staging", "approved-production")):
            raise Unavailable("Private pilot disabled")
        raw_bridge = env.get("CS_ZARIA_BRIDGE_ORIGIN", "")
        approved_bridge = env.get("CS_ZARIA_APPROVED_BRIDGE_HOST", "")
        if not raw_bridge or not approved_bridge:
            raise Unavailable("Private bridge setting missing")
        if raw_bridge != "https://" + approved_bridge:
            raise Unavailable("Private bridge settings disagree")
        try:
            parsed_bridge = urlsplit(raw_bridge)
            if (parsed_bridge.scheme != "https" or parsed_bridge.hostname != approved_bridge
                or not approved_bridge.endswith((".vercel.app", ".example")) or parsed_bridge.username
                or parsed_bridge.password or parsed_bridge.port is not None
                or parsed_bridge.path not in ("", "/") or parsed_bridge.query
                or parsed_bridge.fragment or (worker_env == "private-staging" and approved_bridge in (
                    "virtual-cafe-sativa-glyph-protocol.vercel.app",
                    "virtual-cafe-sativa.vercel.app",
                )) or (worker_env == "approved-production" and
                    approved_bridge != "virtual-cafe-sativa-glyph-protocol.vercel.app")):
                raise ValueError
        except (TypeError, ValueError):
            raise Unavailable("Private bridge not allowlisted") from None
        bridge = raw_bridge
        mode = env.get("CS_ZARIA_LIVEKIT_CREDENTIALS", "isolated-explicit")
        explicit = ("CS_ZARIA_LIVEKIT_URL", "CS_ZARIA_LIVEKIT_KEY", "CS_ZARIA_LIVEKIT_SECRET")
        if mode == "cloud-injected":
            if any(name in env for name in explicit):
                raise Unavailable("Private project credential sources cannot be mixed")
            names = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
        elif mode == "isolated-explicit":
            names = explicit
        else:
            raise Unavailable("Private project credential source unavailable")
        approved_room = env.get("CS_ZARIA_APPROVED_LIVEKIT_HOST", "")
        try:
            parsed_room = urlsplit(env.get(names[0], ""))
            if (parsed_room.scheme not in ("wss", "https")
                or parsed_room.hostname != approved_room
                or not approved_room.endswith(".livekit.cloud")
                or parsed_room.username or parsed_room.password
                or parsed_room.port is not None or parsed_room.path not in ("", "/")
                or parsed_room.query or parsed_room.fragment):
                raise ValueError
        except (TypeError, ValueError):
            raise Unavailable("Private LiveKit project not allowlisted") from None
        room = "wss://" + approved_room
        keys = [env.get(k, "") for k in (*names[1:], "CS_ZARIA_ELEVENLABS_KEY", "CS_ZARIA_DEEPGRAM_KEY")]
        if any(not k or k != k.strip() for k in keys):
            raise Unavailable("Private credentials unavailable")
        bypass = env.get("CS_ZARIA_VERCEL_BYPASS_SECRET", "")
        if worker_env == "private-staging" and (len(bypass) < 32 or bypass != bypass.strip() or any(c.isspace() for c in bypass)):
            raise Unavailable("Private bridge bypass unavailable")
        # LiveKit cannot delete one stored secret without replacing the complete
        # set. A revoked canary value may remain stored, but production drops it
        # here and never places it on an HTTP request.
        if worker_env == "approved-production":
            bypass = ""
        audience = PREVIEW_AUDIENCE if worker_env == "private-staging" else PRODUCTION_AUDIENCE
        return cls(bridge, room, *keys, bypass, audience)

def parse_job(raw, room):
    try:
        if not isinstance(raw, str) or len(raw) > 4096 or not ROOM.fullmatch(room):
            raise ValueError
        job = json.loads(raw)
        if (job["site"] != "cafe-sativa" or job["host"] != HOST
            or job["voiceId"] != VOICE or job["voiceModel"] != MODEL
            or not isinstance(job["memoryGrant"], str)
            or not 16 <= len(job["memoryGrant"]) <= 2048
            or any(c.isspace() for c in job["memoryGrant"])):
            raise ValueError
        return job["memoryGrant"]
    except (KeyError, TypeError, ValueError):
        raise Unavailable("Invalid Zaria dispatch") from None

class Bridge:
    """Versioned proposal, not compatible with the shared memory-only endpoint."""
    def __init__(self, http, origin_, grant, room, vercel_bypass, audience=PREVIEW_AUDIENCE):
        self.http, self.url, self.room = http, origin_ + BRIDGE_PREFIX, room
        self.audience = audience
        self.headers = {"Authorization": "Bearer " + grant}
        if vercel_bypass:
            self.headers["x-vercel-protection-bypass"] = vercel_bypass

    async def _call(self, action, extra):
        limit = ADMIT_TIMEOUT_SEC if action == "admit" else TURN_TIMEOUT_SEC
        try:
            async with asyncio.timeout(limit):
                return await self._request(action, extra)
        except TimeoutError:
            raise Unavailable("Private Gallery bridge deadline exceeded") from None

    async def _request(self, action, extra):
        payload = {"version": PROTOCOL, "room": self.room, **extra}
        async with self.http.post(self.url + "/" + action, json=payload,
                                  headers=self.headers, allow_redirects=False) as resp:
            if resp.status != 200 or resp.content_type != "application/json":
                raise Unavailable("Private Gallery bridge not ready")
            body = bytearray()
            async for chunk in resp.content.iter_chunked(4096):
                body.extend(chunk)
                if len(body) > 32768:
                    raise Unavailable("Private Gallery response too large")
            try:
                data = json.loads(body)
            except ValueError:
                raise Unavailable("Invalid private Gallery response") from None
        if (not isinstance(data, dict) or data.get("version") != PROTOCOL
            or data.get("authorized") is not True or data.get("audience") != self.audience
            or data.get("room") != self.room or data.get("host") != HOST
            or data.get("voice_id") != VOICE or data.get("model_id") != MODEL):
            raise Unavailable("Private Gallery identity not attested")
        return data

    async def admit(self):
        data = await self._call("admit", {})
        identity = data.get("participant_identity")
        if not isinstance(identity, str) or not ROOM.fullmatch(identity):
            raise Unavailable("Private guest identity unavailable")
        return identity

    async def answer(self, utterance, event_id):
        speech, _ = await self.answer_turn(utterance, event_id)
        return speech

    async def answer_turn(self, utterance, event_id):
        if not isinstance(utterance, str) or not 1 <= len(utterance.strip()) <= 1600:
            raise Unavailable("Turn outside pilot limits")
        result = await self._call("turn", {"utterance": utterance, "event_id": event_id})
        reply = result.get("speech")
        if not isinstance(reply, str) or not 1 <= len(reply.strip()) <= 600:
            raise Unavailable("No valid curator reply")
        raw = result.get("gallery_links")
        links, seen = [], set()
        for item in raw[:3] if isinstance(raw, list) else []:
            if not isinstance(item, dict) or set(item) != {"label", "path"}:
                continue
            path, label = item["path"], item["label"]
            if (isinstance(path, str) and re.fullmatch(r"/gallery(?:/[a-z0-9][a-z0-9-]{0,95})?", path)
                    and path not in seen and isinstance(label, str) and 1 <= len(label.strip()) <= 120
                    and len(label) <= 120 and not re.search(r"[\x00-\x1f\x7f]", label)):
                links.append({"path": path, "label": label})
                seen.add(path)
        return reply, links

