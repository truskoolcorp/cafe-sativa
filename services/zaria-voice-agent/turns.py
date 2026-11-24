"""Own exactly one cancellable answer/playout task in an interruptible private room."""
import asyncio
import uuid

class Turns:
    def __init__(self, bridge, play, interrupt, fail):
        self.bridge, self.play, self.interrupt, self.fail = bridge, play, interrupt, fail
        self.tasks = set()
        self.active = None
        self.generation = 0
        self.closed = False
        self.count = 0

    def barge_in(self):
        self.generation += 1  # invalidate waiting replies before interrupting audio
        if self.active is not None and not self.active.done():
            self.active.cancel()
            self.interrupt()
        self.active = None

    def replace(self, utterance):
        if self.closed or not isinstance(utterance, str) or not 1 <= len(utterance.strip()) <= 1600:
            return
        self.barge_in()
        self.count += 1
        if self.count > 12 or len(self.tasks) >= 3:
            self.closed = True
            self.fail()
            return
        self.active = asyncio.create_task(self._run(self.generation, utterance))
        self.tasks.add(self.active)
        self.active.add_done_callback(self.tasks.discard)

    async def _run(self, generation, utterance):
        try:
            async with asyncio.timeout(25):
                reply = await self.bridge.answer(utterance, str(uuid.uuid4()))
                if self.generation == generation and not self.closed:
                    await self.play(reply)
        except Exception:
            if self.generation == generation and not self.closed:
                self.closed = True
                self.interrupt()
                self.fail()

    async def close(self):
        self.closed = True
        self.barge_in()
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks, timeout=2)
