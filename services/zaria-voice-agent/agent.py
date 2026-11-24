"""Standalone private Zaria worker. Intentionally not referenced by deployment manifests."""
import asyncio
from contextlib import aclosing, asynccontextmanager
import json
import os

from core import AGENT, Bridge, Settings, Unavailable, parse_job
from dialogue import pcm_frames, SAMPLE_RATE
from turns import Turns

# Validate flags/isolated hosts before importing or configuring a client.
async def entrypoint(ctx):
    cfg = Settings.read(os.environ)
    grant = parse_job(ctx.job.metadata, ctx.room.name)
    import aiohttp
    from livekit import rtc
    from livekit.agents import Agent, AgentSession, StopResponse, room_io
    from livekit.plugins import deepgram, silero

    async def reject_redirect(*_):
        raise Unavailable("Private voice redirects unsupported")

    trace = aiohttp.TraceConfig()
    trace.on_request_redirect.append(reject_redirect)
    stopped = asyncio.Event()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5),
                                     trace_configs=[trace], trust_env=False) as http:
        bridge = Bridge(http, cfg.bridge_origin, grant, ctx.room.name)
        # Signed grants and live access are validated by the separate private app.
        guest = await bridge.admit()

        class Socket:
            def __init__(self, ws):
                self.ws = ws
            async def send(self, event):
                await self.ws.send_json(event)
            async def receive(self):
                return await self.ws.receive_json()

        @asynccontextmanager
        async def connect(url, headers):
            ws = await asyncio.wait_for(
                http.ws_connect(url, headers=headers, max_msg_size=530000,
                                timeout=aiohttp.ClientWSTimeout(ws_close=1.0)), timeout=3
            )
            try:
                yield Socket(ws)
            finally:
                await asyncio.wait_for(ws.close(), timeout=1.5)

        def interrupt():
            if session.current_speech and not session.current_speech.interrupted:
                session.interrupt()

        async def play(reply):
            async def frames():
                async with aclosing(pcm_frames(connect, cfg.tts_key, reply)) as stream:
                    try:
                        async for data in stream:
                            yield rtc.AudioFrame(data=data, sample_rate=SAMPLE_RATE, num_channels=1,
                                                 samples_per_channel=len(data) // 2)
                    except Exception:
                        stopped.set()
                        raise
            # No TTS object/LLM is passed to the SDK: every utterance streams
            # an explicitly supplied exact-model audio iterable from above.
            handle = session.say(reply, audio=frames(), allow_interruptions=True,
                                 add_to_chat_ctx=False)
            await handle.wait_for_playout()

        class Curator(Agent):
            async def on_user_turn_completed(self, turn_ctx, new_message):
                turns.replace(new_message.text_content)
                # No model-based second path. Shared web bridge supplies all answers.
                raise StopResponse()

        # No preemptive generation: must not answer before authenticated final turn.
        session = AgentSession(stt=deepgram.STT(api_key=cfg.stt_key, model="nova-3", language="en"),
                               vad=silero.VAD.load(), preemptive_generation=False)
        async def publish_links(sequence, links):
            # Scope the reliable packet to the exact admitted guest. Data is
            # optional: a failed packet must not discard a spoken answer.
            try:
                encoded = json.dumps({"sequence": sequence, "links": links},
                                     separators=(",", ":"), ensure_ascii=False).encode()
                if len(encoded) <= 2048:
                    await asyncio.wait_for(ctx.room.local_participant.publish_data(
                        encoded, reliable=True, destination_identities=[guest],
                        topic="cafe-sativa.zaria.gallery-links.v1"), timeout=0.5)
            except Exception:
                pass

        turns = Turns(bridge, play, interrupt, stopped.set, publish=publish_links)

        @session.on("user_state_changed")
        def on_user_state(event):
            if event.new_state == "speaking":
                turns.barge_in()

        @session.on("close")
        def on_close(_):
            stopped.set()

        try:
            async with asyncio.timeout(12):
                await ctx.connect()
                await session.start(
                    room=ctx.room, agent=Curator(instructions="Zaria; answers from the private Gallery bridge only."),
                    room_options=room_io.RoomOptions(
                        participant_identity=guest,
                        audio_input=True, text_input=False, video_input=False, text_output=False,
                    ),
                )
            # Small private pilot cap; no public rollout flag exists here.
            await asyncio.wait_for(stopped.wait(), timeout=300)
        except TimeoutError:
            pass
        finally:
            await turns.close()
            try:
                await asyncio.wait_for(session.aclose(), timeout=3)
            finally:
                await asyncio.wait_for(ctx.room.disconnect(), timeout=2)

def startup():
    try:
        cfg = Settings.read(os.environ)
    except Unavailable:
        raise SystemExit("Private Zaria worker unavailable") from None
    from livekit.agents import WorkerOptions, cli
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=AGENT, ws_url=cfg.room_url,
                              api_key=cfg.room_key, api_secret=cfg.room_secret,
                              drain_timeout=5, shutdown_process_timeout=8, max_retry=1))

if __name__ == "__main__":
    startup()
