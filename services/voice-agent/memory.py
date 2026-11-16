"""Fixed-origin, bounded, idempotent Café Sativa conversation transport."""
import json
import uuid

ENDPOINT = "https://www.cafe-sativa.com/api/concierge/livekit/memory"
HOSTS = {"laviche", "ginger", "ahnika"}


class MemoryUnavailable(Exception):
    pass


def dispatch(raw):
    try:
        data = json.loads(raw)
        if (data.get("site") != "cafe-sativa" or data.get("host") not in HOSTS
                or not isinstance(data.get("voiceId"), str) or not data["voiceId"]
                or not isinstance(data.get("memoryGrant"), str)
                or not 1 <= len(data["memoryGrant"]) <= 2048):
            raise ValueError()
        return data
    except (ValueError, TypeError, AttributeError):
        raise MemoryUnavailable("Invalid voice dispatch") from None


def validate_context(data, metadata):
    try:
        canonical = data["canonical"]
        if (data["host"] != metadata["host"]
                or canonical["voiceId"] != metadata["voiceId"]
                or not isinstance(canonical["context"], str)
                or not canonical["context"].strip()):
            raise ValueError()
        messages = data["messages"]
        if not isinstance(messages, list) or len(messages) > 20:
            raise ValueError()
        for message in messages:
            if (message["role"] not in {"user", "assistant"}
                    or not isinstance(message["content"], str)
                    or len(message["content"]) > 4000):
                raise ValueError()
        return canonical["context"], messages
    except (KeyError, ValueError, TypeError):
        raise MemoryUnavailable("Canonical voice context unavailable") from None


class MemoryClient:
    def __init__(self, http, metadata):
        self.http = http
        self.metadata = metadata
        self.headers = {"Authorization": "Bearer " + metadata["memoryGrant"]}

    async def load(self):
        async with self.http.get(ENDPOINT, headers=self.headers, allow_redirects=False) as response:
            if response.status != 200:
                raise MemoryUnavailable("Voice authorization unavailable")
            return validate_context(await response.json(), self.metadata)

    async def save(self, event, sleep):
        # Never regenerate an event ID during retries; no identity is caller supplied.
        for attempt in range(4):
            try:
                async with self.http.post(ENDPOINT, headers=self.headers, json=event,
                                          allow_redirects=False) as response:
                    status = response.status
                    if status in {200, 201}:
                        return
                    if status not in {429, 503}:
                        raise MemoryUnavailable("Voice memory authorization ended")
            except (TimeoutError, OSError):
                pass
            if attempt < 3:
                await sleep(min(2 ** attempt, 4))
        raise MemoryUnavailable("Voice memory temporarily unavailable")


def turn(role, content):
    if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
        return None
    if len(content) > 4000:
        raise MemoryUnavailable("Voice turn exceeds memory limit")
    return {"event_id": str(uuid.uuid4()), "role": role, "content": content}
