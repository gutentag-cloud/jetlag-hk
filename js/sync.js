/* ============================================================
   Sync layer — Firebase Realtime DB with localStorage fallback.
   Single shared game-state tree lives at  games/<room>.
   Writes target sub-paths (claims/<id>, coins/<team>, ...) so
   concurrent edits from different phones don't clobber each other.
   The whole tree is subscribed; onState(fullState) rebuilds the UI.
   ============================================================ */
const Sync = (function () {
  const LS_CFG = 'jetlag.fbconfig';
  const LS_ROOM = 'jetlag.room';
  const LS_LOCAL = 'jetlag.local';          // offline mirror, keyed by room

  let db = null;            // firebase database
  let ref = null;          // games/<room>
  let room = null;
  let online = false;
  let onStateCb = () => {};
  let onStatusCb = () => {};
  let local = {};          // offline state object

  /* ---- helpers ---- */
  function deepSet(obj, path, value) {
    const parts = path.split('/').filter(Boolean);
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    if (value === null) delete o[parts[parts.length - 1]];
    else o[parts[parts.length - 1]] = value;
  }
  function loadLocal(r) {
    try { const all = JSON.parse(localStorage.getItem(LS_LOCAL) || '{}'); return all[r] || {}; }
    catch (e) { return {}; }
  }
  function saveLocal(r, state) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(LS_LOCAL) || '{}'); } catch (e) {}
    all[r] = state;
    localStorage.setItem(LS_LOCAL, JSON.stringify(all));
  }
  function status() {
    onStatusCb({ online, room, mode: online ? 'cloud' : 'local' });
  }

  /* ---- public API ---- */
  function init({ onState, onStatus }) {
    onStateCb = onState || onStateCb;
    onStatusCb = onStatus || onStatusCb;
    room = localStorage.getItem(LS_ROOM) || 'hk-default';
    // 1) a config the user pasted on this device wins
    const cfgRaw = localStorage.getItem(LS_CFG);
    if (cfgRaw) {
      try { connect(JSON.parse(cfgRaw), room); return; }
      catch (e) { console.warn('Stored Firebase config failed, using local.', e); }
    }
    // 2) otherwise auto-connect from a baked-in config (unless user chose offline)
    const baked = window.JETLAG_FIREBASE;
    const forcedLocal = localStorage.getItem('jetlag.forceLocal') === '1';
    if (!forcedLocal && baked && baked.enabled && baked.config &&
        baked.config.databaseURL && !/PASTE_YOUR/.test(baked.config.databaseURL)) {
      try {
        room = localStorage.getItem(LS_ROOM) || baked.room || 'hk-default';
        connect(baked.config, room);
        return;
      } catch (e) { console.warn('Baked Firebase config failed, using local.', e); }
    }
    goLocal(room);
  }

  function goLocal(r) {
    online = false; room = r;
    local = loadLocal(r);
    // cross-tab sync within same browser
    window.addEventListener('storage', (e) => {
      if (e.key === LS_LOCAL && !online) { local = loadLocal(room); onStateCb(local); }
    });
    status();
    onStateCb(local);
  }

  function connect(config, r) {
    if (!window.firebase || !firebase.database) throw new Error('Firebase SDK not loaded');
    // (re)initialize
    try {
      if (firebase.apps && firebase.apps.length) { firebase.app().delete().catch(() => {}); }
    } catch (e) {}
    firebase.initializeApp(config);
    db = firebase.database();
    room = r;
    localStorage.setItem(LS_CFG, JSON.stringify(config));
    localStorage.setItem(LS_ROOM, r);
    localStorage.removeItem('jetlag.forceLocal');
    if (ref) ref.off();
    ref = db.ref('games/' + r);
    ref.on('value', (snap) => {
      online = true; status();
      onStateCb(snap.val() || {});
    }, (err) => {
      console.warn('Firebase read error → local fallback', err);
      goLocal(r);
    });
    // connection state indicator
    db.ref('.info/connected').on('value', (s) => { online = !!s.val(); status(); });
    status();
  }

  function disconnect() {
    if (ref) ref.off();
    localStorage.removeItem(LS_CFG);
    localStorage.setItem('jetlag.forceLocal', '1');   // don't auto-reconnect from baked config
    online = false;
    goLocal(room);
  }

  function changeRoom(r) {
    const cfgRaw = localStorage.getItem(LS_CFG);
    if (cfgRaw && db) { connect(JSON.parse(cfgRaw), r); }
    else { localStorage.setItem(LS_ROOM, r); goLocal(r); }
  }

  function write(path, value) {
    if (online && ref) { ref.child(path).set(value); }
    else { deepSet(local, path, value); saveLocal(room, local); onStateCb(local); }
  }
  function update(path, obj) {
    if (online && ref) { ref.child(path).update(obj); }
    else { Object.keys(obj).forEach(k => deepSet(local, path + '/' + k, obj[k])); saveLocal(room, local); onStateCb(local); }
  }
  function remove(path) { write(path, null); }
  function push(path, value) {
    if (online && ref) { ref.child(path).push(value); }
    else {
      const id = 'l' + Date.now() + Math.floor(performance.now() % 1000);
      deepSet(local, path + '/' + id, value); saveLocal(room, local); onStateCb(local);
    }
  }
  function resetGame() {
    if (online && ref) { ref.set(null); }
    else { local = {}; saveLocal(room, local); onStateCb(local); }
  }

  return { init, connect, disconnect, changeRoom, write, update, remove, push, resetGame,
           getRoom: () => room, isOnline: () => online };
})();
