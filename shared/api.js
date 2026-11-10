/* =========================================================
   Client side of the demo API, shared by the member app and the back office.

   Server mode  · POST ../api/<method> on the bundled Node server (server/server.js),
                  live updates pushed over Server-Sent Events.
   Local mode   · no server answered (static hosting, file://): the very same
                  core (shared/core.js) runs in the browser against localStorage,
                  and other tabs on the same device hear about changes.
   Offline mode · the app was last used against a server and the network is gone:
                  calls fail fast, and the app falls back to what it cached.
   ========================================================= */
import { handle, seed, sweep, ApiError, VERSION } from './core.js';

export { ApiError };

const LS_DB = 'sv.demo.db.v2';
const LS_MODE = 'sv.demo.mode';
const origin = Math.random().toString(36).slice(2);
const listeners = new Set();
let base = '../api/';
let mode = null;
let tokenKey = 'sv.token';
let token = null;
let memoryDb = null;

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
  json(k, fallback = null) { try { const v = JSON.parse(this.get(k)); return v ?? fallback; } catch { return fallback; } },
};

export async function connect(opts = {}) {
  base = opts.base || base;
  tokenKey = opts.tokenKey || tokenKey;
  token = store.get(tokenKey);
  const want = new URLSearchParams(location.search).get('mode');
  if (location.protocol !== 'file:' && want !== 'local') {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(base + 'ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const data = await res.json();
      if (res.ok && data && data.result && data.result.ok) mode = 'server';
    } catch { /* no server here */ }
  }
  if (mode === 'server') {
    store.set(LS_MODE, 'server');
    openStream();
  } else if (store.get(LS_MODE) === 'server' && want !== 'local') {
    // this device was talking to a server: stay on its data instead of silently switching to local
    mode = 'offline';
    addEventListener('online', () => location.reload(), { once: true });
  } else {
    mode = 'local';
    store.set(LS_MODE, 'local');
    addEventListener('storage', e => { if (e.key === LS_DB) emit(['all']); });
    // local timers: payment locks, confirmation deadlines and refunds still expire with no server around
    setInterval(() => {
      const db = loadDb();
      const changed = sweep(db, Date.now() + ((db.clock && db.clock.offsetMs) || 0));
      if (changed.length) { saveDb(db); emit(changed); }
    }, 10e3);
  }
  return mode;
}

export const getMode = () => mode;
export const auth = {
  get token() { return token; },
  set(t) { token = t; store.set(tokenKey, t); },
  clear() { token = null; store.set(tokenKey, null); },
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(changed) { listeners.forEach(fn => { try { fn(changed); } catch (e) { console.error(e); } }); }

export async function call(method, args = {}) {
  if (mode === 'server') {
    let res;
    try {
      res = await fetch(base + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sv-origin': origin, ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(args),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('offline', '网络不可用，请稍后再试', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok || !data || data.error) {
      const e = (data && data.error) || {};
      throw new ApiError(e.code || 'error', e.message || `请求失败（${res.status}）`, res.status, e.rule || null);
    }
    return data.result;
  }
  if (mode === 'offline') throw new ApiError('offline', '网络不可用，正在显示离线内容', 0);
  const db = loadDb();
  let out;
  try {
    out = handle(db, { token, method, args, now: Date.now() });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error(e);
    throw new ApiError('error', '出了点问题，请稍后再试', 500);
  }
  if (out.changed.length) saveDb(db);
  await new Promise(r => setTimeout(r, 60)); // feel like a network round-trip
  return JSON.parse(JSON.stringify(out.result));
}

function loadDb() {
  const raw = store.get(LS_DB);
  if (raw) {
    try { const db = JSON.parse(raw); if (db && db.version === VERSION) return db; } catch { /* corrupted: reseed */ }
  }
  if (!memoryDb) { memoryDb = seed(Date.now()); saveDb(memoryDb); }
  return memoryDb;
}
function saveDb(db) {
  memoryDb = db;
  store.set(LS_DB, JSON.stringify(db));
}

function openStream() {
  if (!('EventSource' in window)) return;
  const es = new EventSource(base + 'stream');
  es.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data);
      if (d.origin !== origin && d.changed && d.changed.length) emit(d.changed);
    } catch { /* keep-alive */ }
  };
}
