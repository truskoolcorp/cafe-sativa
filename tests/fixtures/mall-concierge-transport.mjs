/** Café v2 text contract. This module never calls a model or a Mall proxy.
 * All network I/O is injected for tests. No automatic retries or polling.
 */
export const CONCIERGE_URL = 'https://www.cafe-sativa.com/api/concierge';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX = 'tru-skool:concierge:pending:v1:';
const HOSTS = ['laviche', 'ginger', 'ahnika'];
const REQUEST_KEYS = ['host', 'message', 'session_id', 'conversation_id', 'surface', 'room_id'];
const scoped = (host, session) => `${PREFIX}${encodeURIComponent(session)}:${host}:`;
const notice = (message, extra = {}) => ({ kind: 'notice', message, ...extra });
const validSession = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

export function createRequestIdentity(now = Date.now(), randomId = globalThis.crypto.randomUUID()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff || !UUID.test(randomId)) throw Error('Request identity unavailable');
  const timestamp = now.toString(16).padStart(12, '0');
  const request_id = `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${randomId.slice(15, 18)}-${((parseInt(randomId[19], 16) & 3) | 8).toString(16)}${randomId.slice(20)}`.toLowerCase();
  return { request_id, issued_at: now };
}

function validBody(body, mode) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = [...REQUEST_KEYS, ...(mode === 'durable' ? ['request_id', 'issued_at'] : [])];
  if (Object.keys(body).length !== keys.length || keys.some(key => !(key in body))) return false;
  if (!HOSTS.includes(body.host) || !validSession(body.session_id) || body.surface !== 'mall-3d'
    || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000
    || (body.conversation_id !== null && !UUID.test(body.conversation_id))
    || (body.room_id !== null && (typeof body.room_id !== 'string' || !body.room_id.trim() || body.room_id.length > 128 || /[\u0000-\u001f\u007f]/.test(body.room_id)))) return false;
  return mode === 'legacy' || (UUID7.test(body.request_id) && Number.isSafeInteger(body.issued_at)
    && body.issued_at === parseInt(body.request_id.slice(0, 8) + body.request_id.slice(9, 13), 16));
}

export function createPendingStore(getStorage) {
  const keyOf = record => scoped(record.host, record.session) + record.id;
  function validate(record) {
    if (!record || record.version !== 1 || !['legacy', 'durable'].includes(record.mode) || typeof record.body !== 'string' || !UUID.test(record.id)) throw Error('Invalid retained request');
    const body = JSON.parse(record.body);
    if (!validBody(body, record.mode) || record.host !== body.host || record.session !== body.session_id
      || record.requester !== `guest:${record.session}` || (record.mode === 'durable' && record.id !== body.request_id)) throw Error('Invalid retained request');
    if (record.outcome !== undefined) {
      const outcome = record.outcome;
      if (!outcome || !['reply', 'notice'].includes(outcome.kind) || outcome.resolved !== true
        || typeof outcome.message !== 'string' || !outcome.message.trim() || outcome.message.length > 20000
        || (outcome.conversationId != null && (typeof outcome.conversationId !== 'string' || !UUID.test(outcome.conversationId)))
        || (outcome.warning != null && typeof outcome.warning !== 'string')
        || Object.keys(outcome).some(key => !['kind', 'message', 'conversationId', 'warning', 'resolved', 'code', 'upgradeRequired', 'clearConversation'].includes(key))) throw Error('Invalid retained outcome');
    }
    return record;
  }
  function load(host, session) {
    const storage = getStorage(), prefix = scoped(host, session), records = [];
    if (storage.length > 4096) throw Error('Storage scan limit exceeded');
    const names = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix)) names.push(name);
    }
    for (const name of names.sort()) {
      const raw = storage.getItem(name);
      if (raw === null) continue;
      if (raw.length > 32768) throw Error('Retained request exceeds limit');
      const record = validate(JSON.parse(raw));
      if (name !== keyOf(record) || record.host !== host || record.session !== session) throw Error('Retained request scope changed');
      records.push(Object.freeze(record));
    }
    return records;
  }
  return {
    load,
    save(record) {
      validate(record);
      const storage = getStorage(), key = keyOf(record), value = JSON.stringify(record);
      if (value.length > 32768 || load(record.host, record.session).length || storage.getItem(key) !== null) throw Error('Unresolved request already retained');
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw Error('Request was not retained');
    },
    complete(record, outcome) {
      const storage = getStorage(), key = keyOf(record), raw = storage.getItem(key);
      if (raw === null) return;
      if (raw !== JSON.stringify(record)) throw Error('Retained request changed');
      const completed = validate({ ...record, outcome }), value = JSON.stringify(completed);
      if (value.length > 32768) throw Error('Retained outcome exceeds limit');
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw Error('Outcome was not retained');
    },
    clear(record) {
      const storage = getStorage(), key = keyOf(record), raw = storage.getItem(key);
      if (raw === null) return; // Another tab may have recovered this same reply.
      if (raw !== JSON.stringify(record)) throw Error('Retained request changed');
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw Error('Retained request could not be cleared');
    },
  };
}

/** A recovery denial never fences a delayed original. Only committed/terminal
 * evidence can release it. Fresh known pre-dispatch denials are safe to release.
 */
export function requestResolved(status, data, recovery) {
  if (status === 200 && typeof data.message === 'string' && data.message.trim()) return true;
  if (data.terminal === true) return true;
  if (recovery) return false;
  return data.admitted === false || status === 400 || (status === 429 && data.rate_limited === true)
    || ['origin_not_allowed', 'conversation_unavailable', 'missing_session', 'not_configured'].includes(data.code);
}

function outcomeMessage(status, data, resolved, mode) {
  if (resolved && (data.code === 'request_upgrade_required' || data.code === 'mode_changed')) return 'Chat changed versions. Reload before sending a new message. The original message was not admitted.';
  if (data.code === 'text_maintenance') return 'Text chat is paused. Your original message is retained; check its status later. Other Mall rooms remain available.';
  if (data.code === 'requester_changed') return 'The chat session changed. Return to the original session to check this message. It has not been resent.';
  if (data.code === 'durable_disabled') return 'Recovery is temporarily unavailable. The original message may have completed. It is retained and will not be resent.';
  if (!resolved && ['request_expired', 'gone', 'expired'].includes(data.code)) return 'This message cannot be safely replayed. It is retained; contact support to resolve its outcome.';
  if (data.terminal === true) return 'This message has ended without an available reply. You can write a new message.';
  if (status === 429 && resolved) return 'The message limit has been reached. No reply was generated for this attempt. Try a new message later.';
  if (resolved && ['capacity_busy', 'quota_exceeded'].includes(data.code)) return 'Chat is busy or at its message limit. This attempt was not admitted. Try a new message later.';
  if (resolved && data.code === 'conversation_unavailable') return 'This conversation is unavailable for the current session. Start a new conversation when you are ready.';
  if (resolved) return 'This message was not accepted. You can edit it and try a new message.';
  if (mode === 'legacy') return 'The reply could not be confirmed. It may have been processed. To avoid sending it twice, this conversation is paused. Contact support; do not resend the message.';
  if (data.code === 'save_pending') return 'The reply is awaiting safe storage. Check the original message shortly.';
  return 'Your message is unresolved and may still be processing. Check the original message before sending another.';
}

export function createConciergeTransport({
  fetcher = (...args) => globalThis.fetch(...args),
  getStorage = () => globalThis.localStorage,
  locks = globalThis.navigator?.locks,
  now = () => Date.now(),
  randomUUID = () => globalThis.crypto.randomUUID(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const store = createPendingStore(getStorage), running = new Set();
  function inspect(host, session) {
    try {
      if (!HOSTS.includes(host) || !validSession(session)) throw Error('Invalid chat session');
      return { pending: store.load(host, session), blocked: false };
    } catch {
      return { pending: [], blocked: true, message: 'Retained chat data could not be read safely. Check browser storage or contact support before sending another message.' };
    }
  }
  async function locked(host, session, action) {
    const key = scoped(host, session);
    if (running.has(key)) return notice('A request is already being checked. Please wait.', { busy: true });
    // Storage writes alone cannot atomically claim a cross-tab send. Fail closed
    // on browsers without Web Locks rather than inventing an expiring lease.
    if (!locks?.request) return notice('This browser cannot safely coordinate chat tabs. Open the Mall in an up-to-date browser to use text chat.', { blocked: true });
    running.add(key);
    try {
      return await locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => lock
        ? action() : notice('This chat is active in another tab. Wait there, then check the original message here.', { busy: true }));
    } catch {
      return notice('Chat could not be opened safely. No automatic retry was made. Check the original message before trying anything else.', { blocked: true });
    } finally { running.delete(key); }
  }
  async function read(url, init, timeout) {
    const controller = new AbortController(), timer = setTimer(() => controller.abort(), timeout);
    try {
      const response = await fetcher(url, { ...init, credentials: 'omit', cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data: data && typeof data === 'object' && !Array.isArray(data) ? data : {} };
    } finally { clearTimer(timer); }
  }
  function initFor(record) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Concierge-Durable': record.mode === 'durable' ? '1' : '0', 'X-Concierge-Requester': record.requester }, body: record.body };
  }
  function formatOutcome(record, status, data, resolved) {
    if (status === 200 && typeof data.message === 'string' && data.message.trim()) return {
      kind: 'reply', message: data.message, conversationId: typeof data.conversation_id === 'string' && UUID.test(data.conversation_id) ? data.conversation_id : null,
      warning: data.memory_saved === false ? 'The reply arrived, but its conversation history was not saved.' : null,
      resolved: true,
    };
    return notice(outcomeMessage(status, data, resolved, record.mode), {
      resolved, ...(typeof data.code === 'string' ? { code: data.code } : {}),
      upgradeRequired: resolved && ['mode_changed', 'request_upgrade_required'].includes(data.code),
      clearConversation: resolved && data.code === 'conversation_unavailable',
    });
  }
  function retainKnownOutcome(record, result, recovery) {
    if (requestResolved(result.status, result.data, recovery)) {
      store.complete(record, formatOutcome(record, result.status, result.data, true));
    }
  }
  async function execute(record, recovery, stillCurrent) {
    try {
      let result;
      if (recovery) {
        result = await read(`${CONCIERGE_URL}/status`, initFor(record), 15000);
        if (!stillCurrent()) {
          retainKnownOutcome(record, result, true);
          return { kind: 'stale' };
        }
        if (result.status === 202 && result.data.recovery_required === true) {
          // Exact stored body/identity, never the current draft or room.
          result = await read(CONCIERGE_URL, initFor(record), 65000);
        }
      } else result = await read(CONCIERGE_URL, initFor(record), 65000);
      if (!stillCurrent()) {
        // A real terminal response remains useful even when its old UI left.
        // Store it only with that original host/session/request, not the new one.
        retainKnownOutcome(record, result, recovery);
        return { kind: 'stale' };
      }
      const { status, data } = result, resolved = requestResolved(status, data, recovery);
      if (resolved) store.clear(record);
      return { ...formatOutcome(record, status, data, resolved), record };
    } catch {
      if (!stillCurrent()) return { kind: 'stale' };
      return notice(record.mode === 'durable'
        ? 'The reply could not be confirmed. Your original message is retained. Check it to recover safely; it will not be sent as a new message.'
        : outcomeMessage(0, {}, false, 'legacy'), { record, resolved: false });
    }
  }
  return {
    inspect,
    async send(body, stillCurrent = () => true, onRetained = () => {}) {
      return locked(body.host, body.session_id, async () => {
        const state = inspect(body.host, body.session_id);
        if (state.blocked) return notice(state.message, { blocked: true });
        if (state.pending.length) return notice('An original message is still unresolved. Check it before sending another.', { record: state.pending[0], resolved: false });
        let capability;
        try {
          capability = await read(`${CONCIERGE_URL}/status`, { method: 'GET' }, 10000);
          if (capability.status !== 200 || typeof capability.data.durable_enabled !== 'boolean'
            || typeof capability.data.text_admissions_enabled !== 'boolean'
            || (capability.data.durable_enabled && capability.data.durable_payload_version !== 2)) throw Error('Unknown capability');
        } catch { return notice('Chat availability could not be verified. No message was sent. Try checking again later.'); }
        if (!stillCurrent()) return { kind: 'stale' };
        if (!capability.data.text_admissions_enabled) return notice('Text chat is paused. No message was sent. Other Mall rooms remain available.');
        const mode = capability.data.durable_enabled ? 'durable' : 'legacy';
        let record;
        try {
          const identity = mode === 'durable' ? createRequestIdentity(now(), randomUUID()) : {};
          const wire = { ...identity, host: body.host, message: body.message.trim(), session_id: body.session_id,
            conversation_id: body.conversation_id ?? null, surface: 'mall-3d', room_id: body.room_id ?? null };
          record = Object.freeze({ version: 1, mode, id: identity.request_id ?? randomUUID(), host: body.host,
            session: body.session_id, requester: `guest:${body.session_id}`, body: JSON.stringify(wire) });
          store.save(record); // Persist before POST, including legacy uncertainty.
        } catch { return notice('This message could not be retained safely. Nothing was sent. Check browser storage before sending.', { blocked: true }); }
        if (!stillCurrent()) return { kind: 'stale' }; // Keep original; never silently discard.
        try { onRetained(record); } catch { /* UI failures do not change request identity. */ }
        return execute(record, false, stillCurrent);
      });
    },
    async recover(host, session, stillCurrent = () => true) {
      return locked(host, session, async () => {
        const state = inspect(host, session);
        if (state.blocked) return notice(state.message, { blocked: true });
        const record = state.pending[0];
        if (!record) return notice('There is no unresolved message in this chat session.');
        if (record.outcome) {
          if (!stillCurrent()) return { kind: 'stale' };
          try { store.clear(record); }
          catch { return notice('The saved result could not be safely cleared. It remains retained; check browser storage before continuing.', { record, resolved: false }); }
          return { ...record.outcome, record };
        }
        if (record.mode === 'legacy') return notice(outcomeMessage(0, {}, false, 'legacy'), { record, resolved: false });
        if (!stillCurrent()) return { kind: 'stale' };
        return execute(record, true, stillCurrent);
      });
    },
  };
}
