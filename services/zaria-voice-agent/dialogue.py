"""Bounded, one-utterance Eleven v4 dialogue transport."""
import asyncio
import base64
from binascii import Error as DecodeError
from core import MODEL, VOICE, Unavailable

SAMPLE_RATE = 24000
FRAME_BYTES = 960  # mono 16-bit PCM, 20 ms
URL = ("wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input"
       "?model_id=" + MODEL + "&output_format=pcm_24000")

async def pcm_frames(connect, key, reply):
    if not key or not isinstance(reply, str) or not 1 <= len(reply.strip()) <= 600:
        raise Unavailable("Exact voice unavailable")
    clock = asyncio.get_running_loop().time
    start = clock()
    async with connect(URL, {"xi-api-key": key}) as ws:
        async with asyncio.timeout(max(.001, 4 - (clock() - start))):
            await ws.send({"voices": [VOICE]})
            await ws.send({"inputs": [{"text": reply, "voice_id": VOICE}]})
            await ws.send({"close_socket": True})
        pending = bytearray()
        heard = False
        while True:
            seconds_left = (20 if heard else 4) - (clock() - start)
            if seconds_left <= 0:
                raise Unavailable("Exact voice deadline exceeded")
            event = await asyncio.wait_for(ws.receive(), timeout=seconds_left)
            if not isinstance(event, dict) or "error" in event or event.get("type") == "error":
                raise Unavailable("Exact voice provider unavailable")
            if "audio" in event:
                try:
                    part = event["audio"]
                    if not isinstance(part, str) or len(part) > 512000:
                        raise ValueError
                    pending.extend(base64.b64decode(part, validate=True))
                except (ValueError, DecodeError):
                    raise Unavailable("Invalid exact voice audio") from None
                while len(pending) >= FRAME_BYTES:
                    frame = bytes(pending[:FRAME_BYTES])
                    del pending[:FRAME_BYTES]
                    heard = True
                    yield frame
            if (event.get("is_final_audio_for_turn") is True
                or event.get("is_final") is True or event.get("isFinal") is True):
                break
        if len(pending) % 2:
            raise Unavailable("Truncated exact voice audio")
        if pending:
            heard = True
            yield bytes(pending)
        if not heard:
            raise Unavailable("Exact voice returned no audio")
