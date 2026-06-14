/* ============================================================
   App — central controller (v2).
   Tabs: Game (shared) · My Team (your stuff) · Build (host editor).
   Identity/PIN gating via Auth; you can only change your own team.
   ============================================================ */
const App = (function () {
  const D = window.JETLAG_DATA;
  const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

  let raw = {};
  let ctx = {};
  let typing = false, pendingRender = false;
  let pending = null;            // pending roadblock placement {team, payload}

  const ui = {
    tab: 'game', buildView: 'challenges', mapMode: 'claim', shop: 'powerup',
    hostActing: null, showBordersFor: null, deckDistrict: '', deckSearch: '',
    transport: { mode: 0, minutes: 10, mtr: 10 }, powerN: {}, search: '', filterDistrict: '', stealTarget: null
  };

  /* ---------- utils ---------- */
  const now = () => Date.now();
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtArea(km2) { return (km2 || 0).toFixed(1); }
  function uid(p) { return p + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2400);
  }

  /* ---------- identity / permissions ---------- */
  function currentTeam() {
    const r = Auth.role();
    if (r === 'team') return Auth.teamId();
    if (r === 'host') { if (ui.hostActing && raw.teams && raw.teams[ui.hostActing]) return ui.hostActing; return Object.keys(raw.teams || {})[0] || null; }
    return null;
  }
  function requireActAs(tid) {
    if (Auth.canActAs(tid)) return true;
    toast('🔒 Log in as that team to do this (top-right).'); return false;
  }
  function requireHost() {
    if (Auth.isHost()) return true;
    toast('🔒 Host only — log in as Host (top-right).'); return false;
  }

  /* ---------- challenges ---------- */
  function mergedChallenges() {
    const edits = raw.challenges || {};
    const deleted = raw.deletedChallenges || {};
    const baseIds = new Set(D.challenges.map(c => c.id));
    const out = [];
    D.challenges.forEach(c => { if (!deleted[c.id]) out.push(Object.assign({}, c, edits[c.id] || {})); });
    Object.keys(edits).forEach(id => { if (!baseIds.has(id) && !deleted[id]) out.push(Object.assign({ id }, edits[id])); });
    return out;
  }

  /* ---------- derive ctx ---------- */
  function recompute() {
    const teams = raw.teams || {};
    const claims = raw.claims || {};
    const borders = raw.borders || {};
    const graph = Scoring.buildGraph(borders);
    const challenges = mergedChallenges();

    const ownedByTeam = {};
    Object.keys(teams).forEach(t => ownedByTeam[t] = []);
    Object.keys(claims).forEach(did => { const t = claims[did].team; (ownedByTeam[t] = ownedByTeam[t] || []).push(did); });
    const scores = {};
    Object.keys(teams).forEach(t => scores[t] = Scoring.teamScore(ownedByTeam[t] || [], graph));

    ctx = {
      teams, claims, steals: raw.steals || {}, coins: raw.coins || {}, effects: raw.effects || {},
      challengeDone: raw.challengeDone || {}, log: raw.log || {}, borders, graph, challenges,
      ownedByTeam, scores, showMarkers: true, ui,
      me: currentTeam(), role: Auth.role(), isHost: Auth.isHost(),
      showBordersFor: ui.showBordersFor
    };
  }

  /* ---------- render ---------- */
  function render() {
    recompute();
    GameMap.update(ctx);
    updateIdentityChip();
    if (typing) { pendingRender = true; return; }
    Game.render(ctx);
    if (ui.tab === 'team') Team.render(ctx);
    if (ui.tab === 'build') Build.render(ctx);
  }
  function onState(snapshot) { raw = snapshot || {}; Auth.setState(raw); render(); }

  /* ============================================================ ACTIONS ============ */
  function log(msg) { Sync.push('log', { t: now(), msg }); }

  /* teams */
  function createTeam(name, color, pin) {
    const id = uid('t');
    Sync.update('teams/' + id, { id, name: name || ('Team ' + (Object.keys(raw.teams || {}).length + 1)), color: color || PALETTE[Object.keys(raw.teams || {}).length % PALETTE.length], pin: String(pin || '') });
    Sync.write('coins/' + id, D.startingBudget);
    log((name || 'A team') + ' joined (start ' + D.startingBudget + ' coins).');
    return id;
  }
  function addTeamHost() {
    if (!requireHost()) return;
    const id = createTeam('Team ' + (Object.keys(raw.teams || {}).length + 1), null, '');
    ui.hostActing = id; render();
  }
  function renameTeam(id, name) { if (requireActAs(id)) Sync.write('teams/' + id + '/name', name); }
  function setTeamColor(id, color) { if (requireActAs(id)) Sync.write('teams/' + id + '/color', color); }
  function removeTeam(id) {
    if (!requireHost()) return;
    const claims = raw.claims || {};
    Object.keys(claims).forEach(did => { if (claims[did].team === id) Sync.remove('claims/' + did); });
    const eff = raw.effects || {};
    Object.keys(eff).forEach(eid => { if (eff[eid].by === id) Sync.remove('effects/' + eid); });
    Sync.remove('teams/' + id); Sync.remove('coins/' + id);
    log('A team was removed.');
  }
  function setHostActing(id) { ui.hostActing = id; render(); }

  /* claims */
  function claimDistrict(did, teamId, challengeId) {
    if (!teamId) { toast('🔒 Log in as a team (top-right) to claim.'); return; }
    if (!requireActAs(teamId)) return;
    Sync.write('claims/' + did, { team: teamId, via: challengeId || null, at: now() });
    if (challengeId) Sync.write('challengeDone/' + challengeId, teamId);
    if ((raw.steals || {})[did]) Sync.remove('steals/' + did);
    const tn = (raw.teams[teamId] || {}).name || 'Team';
    log(tn + ' claimed ' + Scoring.nameById[did] + (challengeId ? ' (challenge done)' : '') + '.');
    toast(tn + ' claimed ' + Scoring.nameById[did]);
  }
  function unclaim(did) {
    const c = (raw.claims || {})[did]; if (!c) return;
    if (!requireActAs(c.team)) return;
    Sync.remove('claims/' + did);
    log((raw.teams[c.team] || {}).name + ' released ' + Scoring.nameById[did] + '.');
  }
  function claimViaChallenge(challengeId) {
    const ch = ctx.challenges.find(c => c.id === challengeId); if (!ch) return;
    const steal = (raw.steals || {})[ch.districtId];
    if (steal) { completeSteal(ch.districtId, challengeId); return; }
    claimDistrict(ch.districtId, currentTeam(), challengeId);
    closePopups();
  }

  /* coins */
  function setCoins(teamId, val) { if (requireActAs(teamId)) Sync.write('coins/' + teamId, Math.round(val)); }
  function adjustCoins(teamId, delta, reason, silent) {
    if (!silent && !requireActAs(teamId)) return;
    const cur = (raw.coins || {})[teamId] || 0;
    Sync.write('coins/' + teamId, Math.round(cur + delta));
    if (reason) log((raw.teams[teamId] || {}).name + ': ' + (delta >= 0 ? '+' : '') + delta + ' coins — ' + reason + '.');
  }
  function canAfford(teamId, cost) { return ((raw.coins || {})[teamId] || 0) >= cost; }

  /* transport */
  function transportCost() {
    const t = D.transport[ui.transport.mode] || D.transport[0];
    if (t.rule === 'map') { const n = Number(ui.transport.mtr) || 0; return { cost: n * 2, label: t.mode }; }
    const mins = Number(ui.transport.minutes) || 0;
    const cost = t.rule === 'per2min' ? t.rate * mins / 2 : t.rate * mins;
    return { cost: Math.round(cost), label: t.mode };
  }
  function chargeTransport() {
    const team = currentTeam();
    if (!team) { toast('🔒 Log in as a team first.'); return; }
    const { cost, label } = transportCost();
    if (cost <= 0) { toast('Enter time / map number.'); return; }
    adjustCoins(team, -cost, 'transport · ' + label);
    toast('-' + cost + ' coins · ' + label);
  }

  /* powerups */
  function buyPowerup(teamId, pid) {
    if (!requireActAs(teamId)) return;
    const p = D.powerups.find(x => String(x.id) === String(pid)); if (!p) return;
    let cost = p.cost, label = p.name, nval = 0;
    if (p.formula) { nval = Math.max(1, Number(ui.powerN[pid]) || 1); cost = p.formula[0] + p.formula[1] * nval; label += ' (n=' + nval + ')'; }
    if (!canAfford(teamId, cost)) { toast('Not enough coins.'); return; }
    adjustCoins(teamId, -cost, 'powerup #' + pid + ' · ' + label, true);
    toast('Bought: ' + label + ' (-' + cost + ')');
  }

  /* roadblocks — buy then tap the map (Game tab) to drop */
  function buyRoadblock(teamId, kindId) {
    if (!requireActAs(teamId)) return;
    const rb = D.roadblocks.find(r => r.id === kindId);
    if (!canAfford(teamId, rb.cost)) { toast('Need ' + rb.cost + ' coins.'); return; }
    adjustCoins(teamId, -rb.cost, 'bought ' + rb.name, true);
    pending = { team: teamId, payload: rb };
    switchTab('game'); setMapMode('roadblock');
    toast('⛔ ' + rb.name + ' — tap the map to drop it.', 3500);
  }
  function placePending(latlng) {
    if (!pending) return;
    const rb = pending.payload, id = uid('e');
    Sync.write('effects/' + id, { type: 'roadblock', name: rb.name, kind: '⛔', effect: 'Opposing players may not pass.',
      by: pending.team, lat: latlng.lat, lon: latlng.lng, radiusKm: D.roadblockDiameterM / 2000, startedAt: now(), durationMin: D.roadblockMin });
    log((raw.teams[pending.team] || {}).name + ' dropped a ' + rb.name + '.');
    pending = null; setMapMode('claim');
  }
  function removeEffect(id) {
    const e = (raw.effects || {})[id];
    if (e && !Auth.canActAs(e.by)) { toast('🔒 Only the owner or Host can remove this.'); return; }
    Sync.remove('effects/' + id); closePopups();
  }
  function effectRemaining(e) {
    if (!e || !e.startedAt) return '';
    const ms = (e.startedAt + e.durationMin * 60000) - now();
    if (ms <= 0) return 'expired';
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0') + ' left';
  }

  /* steal */
  function stealInfo(did, teamId) {
    const owner = (raw.claims || {})[did];
    if (!owner || !teamId || owner.team === teamId)
      return { ok: false, reason: owner ? (owner.team === teamId ? 'You already own it.' : '') : 'Unclaimed — just claim it.' };
    const borders = Scoring.borderingOwned(did, ctx.ownedByTeam[teamId] || [], ctx.graph);
    if (!borders.length) return { ok: false, reason: 'You own no district bordering this one.', borders: [] };
    const n = Math.min(borders.length, 3);
    return { ok: true, borders, cost: D.steal[String(n)], n, owner: owner.team };
  }
  function startSteal(did, teamId) {
    if (!requireActAs(teamId)) return;
    const info = stealInfo(did, teamId);
    if (!info.ok) { toast(info.reason || 'Cannot steal.'); return; }
    if (!canAfford(teamId, info.cost)) { toast('Need ' + info.cost + ' coins to initiate.'); return; }
    adjustCoins(teamId, -info.cost, 'steal initiation on ' + Scoring.nameById[did], true);
    Sync.write('steals/' + did, { by: teamId, startedAt: now(), paid: info.cost });
    log((raw.teams[teamId] || {}).name + ' is stealing ' + Scoring.nameById[did] + ' (-' + info.cost + ').');
    toast('Steal started — complete a DIFFERENT location in ' + Scoring.nameById[did] + '.', 4000);
  }
  function completeSteal(did, challengeId) {
    const steal = (raw.steals || {})[did]; if (!steal) { claimDistrict(did, currentTeam(), challengeId); return; }
    if (!requireActAs(steal.by)) return;
    const cur = (raw.claims || {})[did];
    if (cur && cur.via && cur.via === challengeId) { toast('Must use a DIFFERENT location than the current claim.'); return; }
    Sync.write('claims/' + did, { team: steal.by, via: challengeId || null, at: now() });
    if (challengeId) Sync.write('challengeDone/' + challengeId, steal.by);
    Sync.remove('steals/' + did);
    log((raw.teams[steal.by] || {}).name + ' STOLE ' + Scoring.nameById[did] + '!');
    toast('Stolen: ' + Scoring.nameById[did]); closePopups();
  }
  function cancelSteal(did, defended) {
    const owner = (raw.claims || {})[did];
    if (owner && !Auth.canActAs(owner.team)) { toast('🔒 Only the owner or Host can lock this.'); return; }
    Sync.remove('steals/' + did);
    log(defended ? (Scoring.nameById[did] + ' was defended & locked.') : ('Steal on ' + Scoring.nameById[did] + ' cancelled.'));
  }

  /* deck / borders (host) */
  function editChallenge(id, field, value) {
    if (!requireHost()) return;
    const base = D.challenges.find(c => c.id === id);
    const merged = Object.assign({}, base, (raw.challenges || {})[id] || {});
    merged[field] = value;
    Sync.write('challenges/' + id, { name: merged.name, text: merged.text, districtId: merged.districtId,
      lat: merged.lat == null ? null : merged.lat, lon: merged.lon == null ? null : merged.lon, source: merged.source || 'custom' });
  }
  function addChallenge(districtId) {
    if (!requireHost()) return;
    const id = uid('cc');
    Sync.write('challenges/' + id, { name: 'New challenge', text: '', districtId: districtId || Scoring.allIds[0], lat: null, lon: null, source: 'custom' });
    toast('Challenge added.');
  }
  function deleteChallenge(id) { if (!requireHost()) return; Sync.write('deletedChallenges/' + id, true); Sync.remove('challenges/' + id); }
  function toggleChallengeDone(id) {
    const ch = ctx.challenges.find(c => c.id === id); const team = currentTeam();
    if (!team) { toast('🔒 Log in as a team.'); return; }
    const done = (raw.challengeDone || {})[id];
    if (done) { if (!Auth.canActAs(done) && !Auth.isHost()) { toast('🔒 Only the team that did it (or Host) can undo.'); return; } Sync.remove('challengeDone/' + id); }
    else Sync.write('challengeDone/' + id, team);
  }
  function setBorder(a, b, on) { if (requireHost()) Sync.write('borders/' + [a, b].sort().join('|'), on); }

  function resetGame() { if (!requireHost()) return; Sync.resetGame(); toast('Game reset.'); }
  function resetDeck() { if (!requireHost()) return; Sync.remove('challenges'); Sync.remove('deletedChallenges'); toast('Deck reset to defaults.'); }

  /* export / import */
  function exportDeck() {
    return { type: 'jetlag-deck', version: 2, generated: new Date().toISOString(),
      challenges: mergedChallenges().map(c => ({ name: c.name, districtId: c.districtId, text: c.text || '', lat: c.lat == null ? null : c.lat, lon: c.lon == null ? null : c.lon, source: c.source || 'custom' })) };
  }
  function exportGame() { return { type: 'jetlag-game', version: 2, generated: new Date().toISOString(), room: Sync.getRoom(), state: raw }; }
  function importDeck(obj) {
    if (!requireHost()) return;
    const arr = Array.isArray(obj) ? obj : (obj.challenges || []);
    if (!arr.length) { toast('No challenges in that JSON.'); return; }
    const baseByKey = {}; D.challenges.forEach(c => baseByKey[(c.name + '|' + c.districtId).toLowerCase()] = c.id);
    arr.forEach(c => {
      if (!c || !c.name) return;
      const did = Scoring.allIds.includes(c.districtId) ? c.districtId : Scoring.allIds[0];
      const id = baseByKey[(c.name + '|' + did).toLowerCase()] || uid('cc');
      Sync.write('challenges/' + id, { name: c.name, text: c.text || '', districtId: did, lat: c.lat == null ? null : c.lat, lon: c.lon == null ? null : c.lon, source: c.source || 'imported' });
    });
    toast('Imported.');
  }

  /* ---------- map routing ---------- */
  function setMapMode(m) {
    ui.mapMode = m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    const hint = { claim: 'Tap a district to claim it for your team. Tap your own to release.',
      roadblock: pending ? 'Tap the map to drop your roadblock.' : 'Buy a roadblock in My Team → Shops first.',
      info: 'Tap a district to see its borders (🟢 land · 🩵 sea) and challenges.' };
    const el = document.getElementById('mapHint'); if (el) el.textContent = hint[m] || '';
  }
  function handleDistrictTap(id, latlng) {
    if (ui.mapMode === 'roadblock') { if (pending) placePending(latlng); return; }
    if (ui.mapMode === 'info') { openDistrictInfo(id); return; }
    const c = (raw.claims || {})[id];
    const me = currentTeam();
    if (c && c.team === me) { unclaim(id); return; }
    if (c && c.team !== me) { openDistrictInfo(id); toast(Scoring.nameById[id] + ' is owned by ' + ((raw.teams[c.team] || {}).name || 'another team') + ' — use Steal in My Team.'); return; }
    claimDistrict(id, me, null);
  }
  function handleMapTap(latlng) { if (ui.mapMode === 'roadblock' && pending) placePending(latlng); }

  function openDistrictInfo(id) {
    ui.showBordersFor = id;
    const chs = ctx.challenges.filter(c => c.districtId === id);
    const claim = (raw.claims || {})[id];
    const steal = (raw.steals || {})[id];
    const owner = claim ? (raw.teams[claim.team] || {}).name : 'Unclaimed';
    const { land, sea } = Scoring.neighborsByType(id, ctx.graph);
    const nm = d => esc(Scoring.nameById[d]);
    let html = `<div class="popup-meta">${esc(owner)} · ${fmtArea(Scoring.areaById[id])} km²${steal ? ' · ⚔️ steal in progress' : ''}</div>`;
    html += `<div style="margin-top:6px"><b>Borders</b></div>`;
    html += `<div style="font-size:12px"><span style="color:#22c55e">🟢 Land:</span> ${land.length ? land.map(nm).join(', ') : '—'}</div>`;
    html += `<div style="font-size:12px"><span style="color:#22d3ee">🩵 Sea:</span> ${sea.length ? sea.map(nm).join(', ') : '—'}</div>`;
    html += `<div style="margin-top:6px;font-weight:600">Locations (${chs.length})</div>`;
    if (!chs.length) html += `<div class="popup-meta">No challenges yet.</div>`;
    chs.forEach(ch => {
      const done = (raw.challengeDone || {})[ch.id];
      const blocked = steal && claim && claim.via === ch.id;
      html += `<div style="margin-top:6px;border-top:1px solid #2a3040;padding-top:6px"><b>${esc(ch.name)}</b>${done ? ' ✅' : ''}<br>
        <span style="font-size:12px;color:#9aa7b4">${esc(ch.text || '—')}</span><br>
        <button class="popup-btn" ${blocked ? 'disabled' : ''} onclick="App.claimViaChallenge('${ch.id}')">${steal ? 'Steal' : 'Claim'} via this${blocked ? ' (used by owner)' : ''}</button></div>`;
    });
    GameMap.flyTo(id); GameMap.popupAtDistrict(id, html); render();
  }
  function clearBorders() { ui.showBordersFor = null; render(); }

  /* ---------- focus guard ---------- */
  document.addEventListener('focusin', e => { if (e.target.matches('input,textarea,[contenteditable="true"]')) typing = true; });
  document.addEventListener('focusout', e => { if (e.target.matches('input,textarea,[contenteditable="true"]')) { typing = false; if (pendingRender) { pendingRender = false; setTimeout(render, 0); } } });

  /* ---------- chrome ---------- */
  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['game', 'team', 'build'].forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab));
    if (tab === 'game') GameMap.invalidate();
    render();
  }
  function updateIdentityChip() {
    const chip = document.getElementById('idChip');
    if (!chip) return;
    chip.innerHTML = `<span class="conn-dot" style="background:${esc(Auth.color())}"></span><span>${esc(Auth.label())}</span>`;
  }

  function boot() {
    GameMap.init(); Game.init(); Team.init(); Build.init(); wireChrome();
    Auth.init(() => render());
    Sync.init({ onState, onStatus: updateConn });
    setInterval(() => { if (ui.tab === 'game') Game.tick(ctx); if (ui.tab === 'team') Team.tick(ctx); }, 1000);
  }
  function updateConn(s) {
    const dot = document.getElementById('connDot'); const label = document.getElementById('connLabel');
    if (dot) dot.className = 'conn-dot ' + (s.online ? 'on' : 'local');
    if (label) label.textContent = s.online ? ('Live · ' + s.room) : ('Local · ' + s.room);
  }
  function wireChrome() {
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMapMode(b.dataset.mode));
    document.getElementById('connBtn').onclick = openConnModal;
    document.getElementById('idChip').onclick = openLoginModal;
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModals);
    document.querySelectorAll('.modal-back').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    switchTab('game');
  }

  /* ---------- modals ---------- */
  function openModal(which) { document.getElementById(which).classList.remove('hidden'); }
  function closeModals() { document.querySelectorAll('.modal-back').forEach(m => m.classList.add('hidden')); }
  function closePopups() { document.querySelectorAll('.leaflet-popup-close-button').forEach(b => b.click()); }
  function genModal(title, html) { document.getElementById('genTitle').textContent = title; document.getElementById('genBody').innerHTML = html; openModal('genModal'); }

  function openLoginModal() {
    const teams = Object.values(raw.teams || {});
    const body = document.getElementById('connModalBody');
    document.querySelector('#connModal .modal-h span') && (document.querySelector('#connModal .modal-h').firstChild.textContent = 'Log in');
    body.innerHTML = `
      <div class="note">You are: <b style="color:${esc(Auth.color())}">${esc(Auth.label())}</b>.
        Logging in as a team lets you change <b>only your own</b> coins & districts. PINs are remembered on this device.</div>
      <label>Join as an existing team</label>
      <div style="display:flex;gap:8px">
        <select id="joinTeam" style="flex:1">${teams.length ? teams.map(t => `<option value="${t.id}">${esc(t.name)}${t.pin ? ' 🔒' : ' (set PIN)'}</option>`).join('') : '<option value="">— no teams yet —</option>'}</select>
        <input id="joinPin" placeholder="PIN" style="width:90px" inputmode="numeric" />
      </div>
      <button class="btn wide" id="joinBtn" style="margin-top:8px" ${teams.length ? '' : 'disabled'}>Log in to team</button>

      <label style="margin-top:16px">Create a new team</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="newName" placeholder="Team name" style="flex:1" />
        <input id="newColor" type="color" value="${PALETTE[teams.length % PALETTE.length]}" style="width:46px;height:40px;padding:2px" />
      </div>
      <input id="newPin" placeholder="Set a PIN (remember it)" style="margin-top:8px" inputmode="numeric" />
      <button class="btn wide good" id="createBtn" style="margin-top:8px">Create & log in</button>

      <label style="margin-top:16px">Host (full control)</label>
      <div style="display:flex;gap:8px">
        <input id="hostPin" placeholder="${(raw.meta || {}).hostPin ? 'Host PIN' : 'Choose a Host PIN'}" style="flex:1" inputmode="numeric" />
        <button class="btn" id="hostBtn">Host login</button>
      </div>
      <button class="btn ghost wide" id="spectateBtn" style="margin-top:16px">Spectate (view only)</button>`;
    document.querySelector('#connModal .modal-h').childNodes[0].nodeValue = 'Log in / Identity';
    openModal('connModal');
    const close = () => { closeModals(); render(); };
    document.getElementById('joinBtn').onclick = () => { const r = Auth.loginTeam(document.getElementById('joinTeam').value, document.getElementById('joinPin').value); r.ok ? close() : toast(r.error); };
    document.getElementById('createBtn').onclick = () => {
      const name = document.getElementById('newName').value.trim(); const pin = document.getElementById('newPin').value.trim();
      if (!name) { toast('Enter a team name.'); return; }
      if (!pin) { toast('Set a PIN.'); return; }
      const id = createTeam(name, document.getElementById('newColor').value, pin);
      Auth.loginTeam(id, pin); close();
    };
    document.getElementById('hostBtn').onclick = () => { const r = Auth.loginHost(document.getElementById('hostPin').value); r.ok ? close() : toast(r.error); };
    document.getElementById('spectateBtn').onclick = () => { Auth.logout(); close(); };
  }

  function openConnModal() {
    const room = Sync.getRoom(); const cfg = localStorage.getItem('jetlag.fbconfig') || '';
    document.querySelector('#genModal .modal-h').childNodes[0] && (document.getElementById('genTitle').textContent = 'Multi-device sync');
    genModal('Multi-device sync', `
      <div class="note">Connection: <b>${Sync.isOnline() ? 'Live cloud sync' : 'Offline (this device)'}</b> · room <span class="kbd">${esc(room)}</span>.
        Everyone on the same hosted link auto-syncs. Change the room to run a separate game.</div>
      <label>Room code</label>
      <input id="roomInput" value="${esc(room)}" />
      <div class="row-btns"><button class="btn" id="roomBtn">Switch room</button>
        <button class="btn bad" id="resetGameBtn">Reset whole game (Host)</button></div>
      <details style="margin-top:14px"><summary class="tiny">Advanced: paste a different Firebase config</summary>
        <textarea id="cfgInput" style="margin-top:8px" placeholder='{ "databaseURL": "...", ... }'>${esc(cfg)}</textarea>
        <div class="row-btns"><button class="btn" id="connectBtn">Connect</button>
          <button class="btn ghost" id="localBtn">Use offline</button></div></details>`);
    document.getElementById('roomBtn').onclick = () => { Sync.changeRoom(document.getElementById('roomInput').value.trim() || 'hk-game'); closeModals(); toast('Switched room.'); };
    document.getElementById('resetGameBtn').onclick = () => { if (!Auth.isHost()) { toast('🔒 Host only.'); return; } if (confirm('Reset the ENTIRE game? Challenge edits stay.')) { resetGame(); closeModals(); } };
    document.getElementById('connectBtn').onclick = () => { try { const c = parseConfig(document.getElementById('cfgInput').value.trim()); if (!c.databaseURL) throw new Error('needs databaseURL'); Sync.connect(c, document.getElementById('roomInput').value.trim() || 'hk-game'); closeModals(); } catch (e) { alert('Bad config: ' + e.message); } };
    document.getElementById('localBtn').onclick = () => { Sync.disconnect(); closeModals(); };
  }
  function parseConfig(txt) { const m = txt.match(/\{[\s\S]*\}/); if (m) txt = m[0]; try { return JSON.parse(txt); } catch (e) { return JSON.parse(txt.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}')); } }

  return {
    boot, render, esc, fmtArea, toast, ctx: () => ctx, ui, D, now, PALETTE,
    currentTeam, switchTab, openLoginModal, clearBorders, openDistrictInfo,
    createTeam, addTeamHost, renameTeam, setTeamColor, removeTeam, setHostActing,
    claimDistrict, unclaim, claimViaChallenge,
    setCoins, adjustCoins, canAfford, transportCost, chargeTransport,
    buyPowerup, buyRoadblock, removeEffect, effectRemaining,
    stealInfo, startSteal, completeSteal, cancelSteal,
    editChallenge, addChallenge, deleteChallenge, toggleChallengeDone, setBorder,
    handleDistrictTap, handleMapTap, setMapMode, genModal, resetGame, resetDeck,
    exportDeck, exportGame, importDeck
  };
})();

window.addEventListener('DOMContentLoaded', App.boot);
