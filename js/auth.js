/* ============================================================
   Auth — lightweight per-device identity + PIN.
   Roles: 'spectator' (view only), 'team' (acts as one team),
   'host' (full control). PINs live in the synced state so they
   work across devices: teams/<id>/pin and meta/hostPin.
   Identity (who THIS device is) is local-only.
   Enforcement is in-app (honor system), not cheat-proof.
   ============================================================ */
const Auth = (function () {
  const LS = 'jetlag.identity';
  let state = {};                 // latest synced snapshot (teams, meta)
  let identity = load();
  let onChange = () => {};

  function load() {
    try { return JSON.parse(localStorage.getItem(LS)) || { role: 'spectator' }; }
    catch (e) { return { role: 'spectator' }; }
  }
  function save() { localStorage.setItem(LS, JSON.stringify(identity)); }

  function setState(raw) {
    state = raw || {};
    // if our team was deleted, drop back to spectator
    if (identity.role === 'team' && (!state.teams || !state.teams[identity.teamId])) {
      identity = { role: 'spectator' }; save();
    }
    onChange();
  }
  function init(cb) { onChange = cb || onChange; }

  function get() { return identity; }
  function role() { return identity.role; }
  function isHost() { return identity.role === 'host'; }
  function teamId() { return identity.role === 'team' ? identity.teamId : null; }

  /* Can this device act as <tid> (claim/spend/etc)? */
  function canActAs(tid) { return identity.role === 'host' || (identity.role === 'team' && identity.teamId === tid); }
  function canEditDeck() { return identity.role === 'host'; }

  /* Log in as an existing team; sets the PIN on first login if none exists. */
  function loginTeam(tid, pin) {
    const t = (state.teams || {})[tid];
    if (!t) return { ok: false, error: 'That team no longer exists.' };
    pin = String(pin || '').trim();
    if (!t.pin) {
      if (!pin) return { ok: false, error: 'Set a PIN for this team.' };
      Sync.write('teams/' + tid + '/pin', pin);              // claim the team with this PIN
    } else if (t.pin !== pin) {
      return { ok: false, error: 'Wrong PIN for ' + t.name + '.' };
    }
    identity = { role: 'team', teamId: tid }; save(); onChange();
    return { ok: true };
  }

  function loginHost(pin) {
    pin = String(pin || '').trim();
    const set = (state.meta || {}).hostPin;
    if (!set) {
      if (!pin) return { ok: false, error: 'Choose a Host PIN.' };
      Sync.write('meta/hostPin', pin);
    } else if (set !== pin) {
      return { ok: false, error: 'Wrong Host PIN.' };
    }
    identity = { role: 'host' }; save(); onChange();
    return { ok: true };
  }

  function logout() { identity = { role: 'spectator' }; save(); onChange(); }

  function label() {
    if (identity.role === 'host') return 'Host';
    if (identity.role === 'team') { const t = (state.teams || {})[identity.teamId]; return t ? t.name : 'Team'; }
    return 'Spectator';
  }
  function color() {
    if (identity.role === 'team') { const t = (state.teams || {})[identity.teamId]; return t ? t.color : '#9aa7b4'; }
    if (identity.role === 'host') return '#fbbf24';
    return '#6b7785';
  }

  return { init, setState, get, role, isHost, teamId, canActAs, canEditDeck,
           loginTeam, loginHost, logout, label, color };
})();
