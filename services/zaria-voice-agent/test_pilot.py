import asyncio
import base64
import json
import unittest
from unittest.mock import patch
from contextlib import aclosing, asynccontextmanager

from core import Settings, parse_job, Bridge, MODEL, PROTOCOL, VOICE, Unavailable
from dialogue import URL, pcm_frames
from turns import Turns

ENV = {
    "CS_ZARIA_WORKER_ENABLED": "true", "CS_ZARIA_WORKER_ENV": "private-staging",
    "CS_ZARIA_BRIDGE_ORIGIN": "https://test-gallery.example",
    "CS_ZARIA_APPROVED_BRIDGE_HOST": "test-gallery.example",
    "CS_ZARIA_LIVEKIT_URL": "wss://test-rtc.example",
    "CS_ZARIA_APPROVED_LIVEKIT_HOST": "test-rtc.example",
    "CS_ZARIA_LIVEKIT_KEY": "fake-key", "CS_ZARIA_LIVEKIT_SECRET": "fake-secret",
    "CS_ZARIA_ELEVENLABS_KEY": "fake-voice-key", "CS_ZARIA_DEEPGRAM_KEY": "fake-stt-key",
}
JOB = dict(site="cafe-sativa", host="zaria", voiceId=VOICE, voiceModel=MODEL, memoryGrant="x"*40)
BRIDGE = dict(version=PROTOCOL, audience="zaria-private-staging", authorized=True,
              room="room-1", host="zaria", voice_id=VOICE, model_id=MODEL,
              participant_identity="guest-1", speech="Take a look at the selected piece.")

def audio(raw):
    return {"audio": base64.b64encode(raw).decode()}

class Socket:
    def __init__(self, *events):
        self.events, self.sent, self.dials, self.closed = iter(events), [], 0, False
    @asynccontextmanager
    async def connect(self, url, headers):
        self.dials += 1
        assert url == URL and headers == {"xi-api-key": "mock"}
        try:
            yield self
        finally:
            self.closed = True
    async def send(self, event):
        self.sent.append(event)
    async def receive(self):
        event = next(self.events, None)
        if event is None:
            await asyncio.Future()
        return event

class FakeHTTP:
    def __init__(self):
        self.body = BRIDGE.copy()
        self.status = 200
        self.calls = []
        self.content = self
        self.content_type = "application/json"
    @asynccontextmanager
    async def post(self, url, *, json, headers, allow_redirects):
        self.calls.append((url, json, headers, allow_redirects))
        yield self
    async def iter_chunked(self, _):
        blob = json.dumps(self.body).encode()
        yield blob[:13]
        yield blob[13:]

class PilotTests(unittest.IsolatedAsyncioTestCase):
    def test_config_and_job_are_exact(self):
        self.assertEqual(Settings.read(ENV).bridge_origin, "https://test-gallery.example")
        for edits in [
            {"CS_ZARIA_WORKER_ENABLED":"false"}, {"CS_ZARIA_WORKER_ENV":"production"},
            {"CS_ZARIA_ELEVENLABS_KEY":""}, {"CS_ZARIA_APPROVED_BRIDGE_HOST":"other.example"},
            {"CS_ZARIA_APPROVED_LIVEKIT_HOST":"other.example"},
            {"CS_ZARIA_BRIDGE_ORIGIN":"https://www.cafe-sativa.com",
             "CS_ZARIA_APPROVED_BRIDGE_HOST":"www.cafe-sativa.com"},
            {"CS_ZARIA_BRIDGE_ORIGIN":"https://virtual-cafe-sativa-glyph-protocol.vercel.app",
             "CS_ZARIA_APPROVED_BRIDGE_HOST":"virtual-cafe-sativa-glyph-protocol.vercel.app"},
            {"CS_ZARIA_BRIDGE_ORIGIN":"http://test-gallery.example"},
            {"CS_ZARIA_BRIDGE_ORIGIN":"https://test-gallery.example/other"},
        ]:
            with self.subTest(edits=edits), self.assertRaises(Unavailable):
                Settings.read(ENV | edits)
        self.assertEqual(parse_job(json.dumps(JOB), "room-1"), "x"*40)
        for edits in [{"host":"ahnika"}, {"voiceId":"other"}, {"voiceModel":"eleven_v4_turbo"},
                      {"memoryGrant":""}, {"site":"other"}]:
            with self.subTest(edits=edits), self.assertRaises(Unavailable):
                parse_job(json.dumps(JOB | edits), "room-1")

    async def test_bridge_refreshes_grant_and_rejects_wrong_attestation(self):
        http = FakeHTTP()
        bridge = Bridge(http, "https://test-gallery.example", "test-bearer", "room-1")
        self.assertEqual(await bridge.admit(), "guest-1")
        self.assertEqual(await bridge.answer("Where should I go?", "event-1"), BRIDGE["speech"])
        for url, body, headers, redirects in http.calls:
            self.assertTrue(url.startswith("https://test-gallery.example/api/concierge/zaria/voice-v1/"))
            self.assertEqual(body["room"], "room-1")
            self.assertEqual(headers, {"Authorization":"Bearer test-bearer"})
            self.assertFalse(redirects)
        for key in ("authorized", "room", "voice_id", "model_id", "audience", "version"):
            http.body = BRIDGE | {key: "wrong"}
            with self.subTest(key=key), self.assertRaises(Unavailable):
                await bridge.answer("Where?", "event-2")
        http.status = 307
        with self.assertRaises(Unavailable):
            await bridge.admit()

    async def test_bridge_has_distinct_bounded_admit_and_turn_deadlines(self):
        class HeaderOrBody(FakeHTTP):
            delay = .025
            stall = False

            @asynccontextmanager
            async def post(self, url, **kwargs):
                self.calls.append(url)
                if not self.stall:
                    await asyncio.sleep(self.delay)
                yield self

            async def iter_chunked(self, size):
                if self.stall:
                    await asyncio.sleep(60)
                async for chunk in super().iter_chunked(size):
                    yield chunk

        http = HeaderOrBody()
        bridge = Bridge(http, "https://test-gallery.example", "test-bearer", "room-1")
        with patch("core.ADMIT_TIMEOUT_SEC", .01), patch("core.TURN_TIMEOUT_SEC", .12):
            with self.assertRaisesRegex(Unavailable, "deadline exceeded"):
                await bridge.admit()
            self.assertEqual(await bridge.answer("Where?", "event-1"), BRIDGE["speech"])
            http.stall = True
            with self.assertRaisesRegex(Unavailable, "deadline exceeded"):
                await bridge.answer("Where next?", "event-2")
        self.assertEqual(len(http.calls), 3)  # no hidden duplicate inference attempt

    async def test_no_dial_for_bad_input_and_no_voice_fallback(self):
        ws = Socket({"type":"error"})
        for key, text in [("", "ok"), ("mock", " "), ("mock", "x"*601)]:
            with self.assertRaises(Unavailable):
                await anext(pcm_frames(ws.connect, key, text))
        self.assertEqual(ws.dials, 0)
        with self.assertRaises(Unavailable):
            await anext(pcm_frames(ws.connect, "mock", "Real test reply."))
        self.assertEqual(ws.dials, 1)
        self.assertEqual(ws.sent[0], {"voices":[VOICE]})
        self.assertEqual(ws.sent[1]["inputs"][0]["voice_id"], VOICE)
        self.assertTrue(ws.closed)

    async def test_interrupt_disposes_socket_and_no_stale_pcm(self):
        old = Socket(audio(b"x"*503), audio(b"x"*457))
        async with aclosing(pcm_frames(old.connect, "mock", "First reply.")) as stream:
            self.assertEqual(await anext(stream), b"x"*960)
            blocked = asyncio.create_task(anext(stream))
            await asyncio.sleep(0)
            blocked.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await blocked
        self.assertTrue(old.closed)
        new = Socket(audio(b"y"*964), {"is_final_audio_for_turn":True})
        self.assertEqual([b async for b in pcm_frames(new.connect, "mock", "New reply.")],
                         [b"y"*960, b"y"*4])
        self.assertTrue(new.closed)

    async def test_turn_replaced_even_if_bridge_late_and_drains(self):
        class Late:
            async def answer(self, text, _):
                if text == "old":
                    try:
                        await asyncio.Future()
                    except asyncio.CancelledError:
                        return "stale answer"
                if text == "denied":
                    raise Unavailable
                return text + " answer"
        played, interrupted, failed = [], [], []
        async def play(text):
            played.append(text)
        turns = Turns(Late(), play, lambda: interrupted.append(True), lambda: failed.append(True))
        turns.replace("old")
        await asyncio.sleep(0)
        turns.replace("new")
        await asyncio.sleep(.01)
        self.assertEqual(played, ["new answer"])
        self.assertTrue(interrupted)
        turns.replace("denied")
        await asyncio.sleep(.01)
        turns.replace("would send if not closed")
        await turns.close()
        self.assertEqual(played, ["new answer"])
        self.assertEqual(failed, [True])

    async def test_superseded_companion_links_are_not_published(self):
        first = asyncio.Event()
        released = asyncio.Event()
        class BridgeWithLinks:
            async def answer_turn(self, text, _):
                if text == "old":
                    first.set()
                    try:
                        await released.wait()
                    except asyncio.CancelledError:
                        # Deliberately model a provider that still returns after cancellation.
                        await released.wait()
                return text, [{"path": "/gallery/" + text, "label": text}]

        sent, played = [], []
        async def publish(sequence, links):
            sent.append((sequence, links))
        async def play(reply):
            played.append(reply)
        turns = Turns(BridgeWithLinks(), play, lambda: None, lambda: self.fail(), publish)
        turns.replace("old")
        await first.wait()
        turns.replace("new")
        released.set()
        for _ in range(6):
            await asyncio.sleep(0)
        await turns.close()
        self.assertEqual(played, ["new"])
        self.assertEqual([links for _, links in sent if links], [[{"path": "/gallery/new", "label": "new"}]])
        self.assertGreater(next(seq for seq, links in sent if links), 2)

if __name__ == "__main__":
    unittest.main()

