type MessageIdentity = { id: string; created_at: string };

// Either the realtime INSERT or the POST response can arrive first.
export function confirmLoungeMessage<T extends MessageIdentity>(
  messages: T[], localId: string, saved: MessageIdentity,
): T[] {
  const hasRealtime = messages.some(message => message.id === saved.id);
  return messages.flatMap(message => {
    if (message.id !== localId) return [message];
    return hasRealtime ? [] : [{ ...message, ...saved }];
  });
}

// A failed delete must not overwrite messages received while it was pending.
export function restoreLoungeMessage<T extends MessageIdentity>(messages: T[], removed: T): T[] {
  if (messages.some(message => message.id === removed.id)) return messages;
  return [...messages, removed].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
