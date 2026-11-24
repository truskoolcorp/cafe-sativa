"""No provider or real microphone: exercise locally generated PCM and addressed data."""
import asyncio
from array import array
import json
import math

from livekit import api, rtc

URL = "ws://127.0.0.1:7880"
ROOM = "zaria-local-transport-check"
TOPIC = "cafe-sativa.zaria.gallery-links.v1"
AGENT = "cafe-sativa-zaria"


def token(identity, *, worker=False, observer=False):
    return (api.AccessToken("devkey", "secret")
            .with_identity(identity)
            .with_kind("agent" if worker else "standard")
            .with_attributes({"lk.agent.name": AGENT} if worker else {})
            .with_grants(api.VideoGrants(room_join=True, room=ROOM,
                                        can_publish=not observer, can_subscribe=True,
                                        can_publish_data=worker))
            .to_jwt())


def receive_audio(room, expected):
    done = asyncio.get_running_loop().create_future()
    readers = set()

    async def consume(track):
        stream = rtc.AudioStream(track=track, sample_rate=24000, num_channels=1)
        try:
            async for event in stream:
                if max((abs(x) for x in event.frame.data), default=0) > 250:
                    if not done.done():
                        done.set_result(True)
                    break
        finally:
            await stream.aclose()

    @room.on("track_subscribed")
    def subscribed(track, _publication, participant):
        if participant.identity == expected:
            task = asyncio.create_task(consume(track))
            readers.add(task)
            task.add_done_callback(readers.discard)

    return done, readers


async def send_tone(room):
    source = rtc.AudioSource(24000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("synthetic-not-a-mic", source)
    await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    data = array("h", (int(math.sin(i / 24000 * 2 * math.pi * 440) * 4800) for i in range(480))).tobytes()
    frame = rtc.AudioFrame(data=data, sample_rate=24000, num_channels=1, samples_per_channel=480)
    try:
        for _ in range(50):
            await source.capture_frame(frame)
            await asyncio.sleep(.02)
        await source.wait_for_playout()
    finally:
        await source.aclose()


async def verify():
    worker, guest, observer = rtc.Room(), rtc.Room(), rtc.Room()
    from_worker, guest_readers = receive_audio(guest, "worker")
    from_guest, worker_readers = receive_audio(worker, "guest")
    got = asyncio.get_running_loop().create_future()
    others = []
    observer_control = asyncio.Event()

    @guest.on("data_received")
    def guest_data(packet):
        if not got.done():
            got.set_result(packet)

    @observer.on("data_received")
    def observer_data(packet):
        if packet.topic == TOPIC + '.control':
            observer_control.set()
        else:
            others.append(packet)

    try:
        await observer.connect(URL, token("observer", observer=True))
        await guest.connect(URL, token("guest"))
        await worker.connect(URL, token("worker", worker=True))
        await asyncio.gather(send_tone(guest), send_tone(worker))
        await asyncio.wait_for(asyncio.gather(from_worker, from_guest), timeout=5)
        packet = {"sequence": 3, "links": [{"label": "Synthetic art", "path": "/gallery/synthetic"}]}
        await worker.local_participant.publish_data(json.dumps(packet), reliable=True,
                                                    destination_identities=["guest"], topic=TOPIC)
        received = await asyncio.wait_for(got, timeout=5)
        assert received.topic == TOPIC and json.loads(received.data) == packet
        assert received.participant.identity == "worker"
        assert received.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
        assert received.participant.attributes.get("lk.agent.name") == AGENT
        # Positive control: the observer must be able to receive data at all.
        await worker.local_participant.publish_data(b"control", reliable=True,
                                                    destination_identities=["observer"], topic=TOPIC + ".control")
        await asyncio.wait_for(observer_control.wait(), timeout=5)
        await asyncio.sleep(.3)
        assert not others, "Guest-only data reached another room participant"
        print("PASS: non-silent media in both directions, authenticated named agent and guest-only data")
    finally:
        tasks = guest_readers | worker_readers
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*(room.disconnect() for room in (worker, guest, observer)), return_exceptions=True)


async def main():
    async with asyncio.timeout(40):
        await verify()


if __name__ == "__main__":
    asyncio.run(main())
