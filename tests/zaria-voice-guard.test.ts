import { test } from "node:test";
import { strict as assert } from "node:assert";
import { assertZariaVoiceCanon, ZARIA_VOICE_CANON } from "../lib/zaria-voice-guard.ts";
test("canonical configured voice passes", () => assert.doesNotThrow(() => assertZariaVoiceCanon(ZARIA_VOICE_CANON)));
test("old Niki audition fails closed", () => assert.throws(() => assertZariaVoiceCanon({...ZARIA_VOICE_CANON,voiceId:"Okp1kfPgMQ81kjya7BBo"}), /ZARIA_VOICE_CANON_DRIFT/));
test("original Bree audition ID cannot silently replace configured voice", () => assert.throws(() => assertZariaVoiceCanon({...ZARIA_VOICE_CANON,voiceId:"PHAPuAHARHKi7JvhoY4v"}), /ZARIA_VOICE_CANON_DRIFT/));
test("non-v4 model fails", () => assert.throws(() => assertZariaVoiceCanon({...ZARIA_VOICE_CANON,modelId:"eleven_multilingual_v2"}), /ZARIA_VOICE_CANON_DRIFT/));
