import { createHash, timingSafeEqual } from 'node:crypto'
export function workerAuthenticated(req: Request): boolean {
  const expected = process.env.CAFE_SATIVA_VOICE_WORKER_SECRET
  const actual = req.headers.get('x-cafe-worker-secret')
  if (!expected || expected.length < 32 || !actual) return false
  const a = createHash('sha256').update(actual).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
