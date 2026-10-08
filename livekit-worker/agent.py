"""Isolated Café Sativa LiveKit agent — development scaffold, NOT production-ready.

The Next.js API must authorize and mint room tokens before users can join.
Until the canonical persona and persistence gateway is wired, this worker MUST
not be deployed publicly. No owner/Anya biometrics or privileged tools.
"""
import logging
import os
import re

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import deepgram, elevenlabs, openai, silero

LOG = logging.getLogger("cafe-sativa-voice")
HOSTS = ("laviche", "ginger", "ahnika")
ROOM_PATTERN = re.compile(r"^cafe-sativa-(laviche|ginger|ahnika)-[a-f0-9]{32}$")

# IMPORTANT: These are temporary minimal prompts for integration smoke testing.
# Production requires the canonical prompts from lib/concierge/personas.ts via
# an authenticated configuration service, together with existing memory/quota.
TEST_PERSONAS = {
    "laviche": "You are Laviche, the Café Sativa maître d'. Be warm, concise, and clear.",
    "ginger": "You are Ginger, the Café Sativa travel concierge. Be concise and helpful.",
    "ahnika": "You are Ahnika, the Café Sativa wellness host. Be concise and helpful.",
}


def host_for_room(room_name: str) -> str:
    match = ROOM_PATTERN.fullmatch(room_name)
    if not match:
        raise ValueError("Unauthorized Café Sativa room format")
    return match.group(1)


def voice_id_for(host: str) -> str:
    if host not in HOSTS:
        raise ValueError("Unrecognized host")
    voice_id = os.environ.get(f"ELEVENLABS_VOICE_{host.upper()}")
    if not voice_id:
        raise RuntimeError(f"Missing canonical ElevenLabs voice ID for {host}")
    return voice_id


def validate_configuration() -> None:
    required = (
        "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
        "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY",
    )
    absent = [key for key in required if not os.getenv(key)]
    if absent:
        raise RuntimeError("Worker configuration incomplete: " + ", ".join(absent))
    for host in HOSTS:
        voice_id_for(host)
    # This explicit gate prevents an incomplete worker becoming publicly live.
    if os.getenv("CAFE_SATIVA_VOICE_INTEGRATION_READY") != "1":
        raise RuntimeError("Integration gate closed: persona, quotas and persistence not yet connected")


class Concierge(Agent):
    def __init__(self, host: str):
        super().__init__(instructions=TEST_PERSONAS[host])


async def entrypoint(ctx: JobContext):
    validate_configuration()
    host = host_for_room(ctx.room.name)
    # Never trust a client's claimed host; derive the host from the server-minted room.
    await ctx.connect()
    session = AgentSession(
        stt=deepgram.STT(model="nova-3"),
        llm=openai.LLM(model=os.getenv("CAFE_SATIVA_VOICE_LLM_MODEL", "gpt-4o-mini")),
        tts=elevenlabs.TTS(
            voice_id=voice_id_for(host),
            api_key=os.environ["ELEVENLABS_API_KEY"],
        ),
        vad=silero.VAD.load(),
    )
    await session.start(agent=Concierge(host), room=ctx.room)
    LOG.info("Café Sativa audio session started for host=%s", host)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
