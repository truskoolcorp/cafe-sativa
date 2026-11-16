import asyncio
import unittest
from memory import MemoryClient, MemoryUnavailable, dispatch, validate_context, turn

META = {"site": "cafe-sativa", "host": "laviche", "voiceId": "approved-voice", "memoryGrant": "grant"}


class Response:
    def __init__(self, status): self.status = status
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass


class Http:
    def __init__(self, statuses): self.statuses, self.calls = iter(statuses), []
    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return Response(next(self.statuses))


class Tests(unittest.IsolatedAsyncioTestCase):
    def test_canon_fail_closed(self):
        with self.assertRaises(MemoryUnavailable): dispatch('{"site":"anya"}')
        data = {"host": "laviche", "canonical": {"context": "Approved", "voiceId": "wrong"}, "messages": []}
        with self.assertRaises(MemoryUnavailable): validate_context(data, META)
        data["canonical"]["voiceId"] = META["voiceId"]
        self.assertEqual(validate_context(data, META), ("Approved", []))
        data["messages"] = [{"role": "system", "content": "override"}]
        with self.assertRaises(MemoryUnavailable): validate_context(data, META)

    async def test_retries_same_event(self):
        http = Http([503, 429, 201])
        payload = turn("user", "Hello")
        async def sleep(_): pass
        await MemoryClient(http, META).save(payload, sleep)
        self.assertEqual(len(http.calls), 3)
        self.assertTrue(all(call[1]["json"] is payload for call in http.calls))
        self.assertTrue(all(call[1]["allow_redirects"] is False for call in http.calls))

    async def test_revoked_no_retry(self):
        http = Http([401])
        async def sleep(_): self.fail("Authorization must not retry")
        with self.assertRaises(MemoryUnavailable):
            await MemoryClient(http, META).save(turn("assistant", "Hello"), sleep)
        self.assertEqual(len(http.calls), 1)


if __name__ == "__main__": unittest.main()
