/** Ignore membership responses from an earlier identity or an unmounted page. */
export function createMembershipStateLoader<T>(
  read: (userId: string) => Promise<T | null>,
  publish: (value: T | null) => void,
  schedule: (task: () => void) => void = task => { setTimeout(task, 0) },
) {
  let generation = 0
  let disposed = false
  return {
    load(userId: string | null) {
      const current = ++generation
      if (disposed) return
      publish(null)
      if (!userId) return
      // Defer Supabase reads until the synchronous auth callback has returned.
      schedule(() => {
        if (disposed || current !== generation) return
        void (async () => {
          try {
            const member = await read(userId)
            if (!disposed && current === generation) publish(member)
          } catch {
            if (!disposed && current === generation) publish(null)
          }
        })()
      })
    },
    dispose() { disposed = true; generation++ },
  }
}
