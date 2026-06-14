/* ============================================================
   App — central controller. Holds the synced snapshot (`raw`),
   derives a render context (`ctx`), exposes all game actions
   (which write through Sync), and orchestrates rendering.
   ============================================================ */
const App = (function () {
  const D = window.JETLAG_DATA;
  const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

  let raw = {};            // synced game state
  let ctx = {};            // derived context for views
  let typing = false;      // suppress re-render while editing fields
  let pendingRender = false;
  let pending = null;      // {type:'tower'|'roadblock', team, payload}

  const ui = {
    tab: 'play', buildView: 'challenges', mapMode: 'claim', shop: 'powerup',
    selectedTeam: null,
    transport: { mode: 0, minutes: 10, mtr: 10 },
    powerN: {}, search: '', filterDistrict: ''
  };

  /* ---------- utils ---------- */
  const now = () => Date.now();
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtArea(km2) { return (km2 || 0).toFixed(1); }
  function uid(p) { return p + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }

  /* ---------- challenge merge ---------- */
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
    Object.keys(claims).forEach(did => {
      const t = claims[did].team;
      (ownedByTeam[t] = ownedByTeam[t] || []).push(did);
    });
    const scores = {};
    Object.keys(teams).forEach(t => scores[t] = Scoring.teamScore(ownedByTeam[t] || [], graph));

    if (!ui.selectedTeam || !teams[ui.selectedTeam]) ui.selectedTeam = Object.keys(teams)[0] || null;

    ctx = {
      teams, claims, steals: raw.steals || {}, coins: raw.coins || {}, effects: raw.effects || {},
      challengeDone: raw.challengeDone || {}, log: raw.log || {}, borders, graph, challenges,
      ownedByTeam, scores, selectedTeam: ui.selectedTeam, selectedDistrict: ui.selectedDistrict,
      mapMode: ui.mapMode, showMarkers: true, ui
    };
  }

  /* ---------- render orchestration ---------- */
  function render() {
    recompute();
    GameMap.update(ctx);
    if (typing) { pendingRender = true; return; }   // don't yank focus while editing
    Play.render(ctx);
    if (ui.tab === 'build') Build.render(ctx);
  }

  function onState(snapshot) {
    raw = snapshot || {};
    render();
  }

  /* ============================================================
     ACTIONS  (each writes through Sync → snapshot → render)
     ============================================================ */
  function log(msg) { Sync.push('log', { t: now(), msg: msg }); }

  function addTeam() {
    const teams = raw.teams || {};
    const n = Object.keys(teams).length;
    const id = uid('t');
    Sync.update('teams/' + id, { id, name: 'Team ' + (n + 1), color: PALETTE[n % PALETTE.length] });
    Sync.write('coins/' + id, D.startingBudget);
    ui.selectedTeam = id;
    log('Team ' + (n + 1) + ' joined (start ' + D.startingBudget + ' coins).');
  }
  function renameTeam(id, name) { Sync.write('teams/' + id + '/name', name); }
  function setTeamColor(id, color) { Sync.write('teams/' + id + '/color', color); }
  function removeTeam(id) {
    const claims = raw.claims || {};
    Object.keys(claims).forEach(did => { if (claims[did].team === id) Sync.remove('claims/' + did); });
    const eff = raw.effects || {};
    Object.keys(eff).forEach(eid => { if (eff[eid].by === id) Sync.remove('effects/' + eid); });
    Sync.remove('teams/' + id); Sync.remove('coins/' + id);
    if (ui.selectedTeam === id) ui.selectedTeam = null;
    log('A team was removed.');
  }

  function selectTeam(id) { ui.selectedTeam = id; render(); }

  function claimDistrict(did, teamId, challengeId) {
    if (!teamId) { toast('Pick a team first (chips above the map).'); return; }
    Sync.write('claims/' + did, { team: teamId, via: challengeId || null, at: now() });
    if (challengeId) Sync.write('challengeDone/' + challengeId, teamId);
    if ((raw.steals || {})[did]) Sync.remove('steals/' + did);   // fresh claim cancels a pending steal
    const tn = (raw.teams[teamId] || {}).name || 'Team';
    log(tn + ' claimed ' + Scoring.nameById[did] + (challengeId ? ' (challenge done)' : '') + '.');
    toast(tn + ' claimed ' + Scoring.nameById[did]);
  }
  function unclaim(did) {
    const c = (raw.claims || {})[did]; if (!c) return;
    Sync.remove('claims/' + did);
    log((raw.teams[c.team] || {}).name + ' released ' + Scoring.nameById[did] + '.');
  }
  function claimViaChallenge(challengeId) {
    const ch = ctx.challenges.find(c => c.id === challengeId); if (!ch) return;
    const steal = (raw.steals || {})[ch.districtId];
    if (steal) { completeSteal(ch.districtId, challengeId); return; }
    claimDistrict(ch.districtId, ui.selectedTeam, challengeId);
    document.querySelectorAll('.leaflet-popup-close-button').forEach(b => b.click());
  }

  /* coins */
  function setCoins(teamId, val) { Sync.write('coins/' + teamId, Math.round(val)); }
  function adjustCoins(teamId, delta, reason) {
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
    let cost = t.rule === 'per2min' ? t.rate * mins / 2 : t.rate * mins;
    return { cost: Math.round(cost), label: t.mode };
  }
  function chargeTransport() {
    if (!ui.selectedTeam) { toast('Pick a team first.'); return; }
    const { cost, label } = transportCost();
    if (cost <= 0) { toast('Enter time / map number.'); return; }
    adjustCoins(ui.selectedTeam, -cost, 'transport · ' + label);
    toast('-' + cost + ' coins · ' + label);
  }

  /* powerups */
  function buyPowerup(teamId, pid) {
    const p = D.powerups.find(x => String(x.id) === String(pid)); if (!p) return;
    let cost = p.cost, label = p.name, nval = 0;
    if (p.formula) { nval = Math.max(1, Number(ui.powerN[pid]) || 1); cost = p.formula[0] + p.formula[1] * nval; label += ' (n=' + nval + ')'; }
    if (!canAfford(teamId, cost)) { toast('Not enough coins.'); return; }
    adjustCoins(teamId, -cost, 'powerup #' + pid + ' · ' + label);
    toast('Bought: ' + label + ' (-' + cost + ')');
  }

  /* towers / roadblocks — buy then tap map to place */
  function drawTower(teamId) {
    if (!teamId) { toast('Pick a team.'); return; }
    if (!canAfford(teamId, D.towerCost)) { toast('Need ' + D.towerCost + ' coins.'); return; }
    const tw = D.towers[Math.floor(Math.random() * D.towers.length)];
    adjustCoins(teamId, -D.towerCost, 'drew ' + tw.name);
    pending = { type: 'tower', team: teamId, payload: tw };
    setMapMode('tower');
    toast('🗼 ' + tw.name + ' drawn — tap the map to drop it.', 3500);
  }
  function buyRoadblock(teamId, kindId) {
    if (!teamId) { toast('Pick a team.'); return; }
    const rb = D.roadblocks.find(r => r.id === kindId);
    if (!canAfford(teamId, rb.cost)) { toast('Need ' + rb.cost + ' coins.'); return; }
    adjustCoins(teamId, -rb.cost, 'bought ' + rb.name);
    pending = { type: 'roadblock', team: teamId, payload: rb };
    setMapMode('roadblock');
    toast('⛔ ' + rb.name + ' — tap the map to drop it.', 3500);
  }
  function placePending(latlng) {
    if (!pending) return;
    const id = uid('e');
    if (pending.type === 'tower') {
      const tw = pending.payload;
      Sync.write('effects/' + id, { type: 'tower', name: tw.name, kind: '🗼', effect: tw.effect,
        by: pending.team, lat: latlng.lat, lon: latlng.lng, radiusKm: tw.radiusKm,
        startedAt: now(), durationMin: D.towerMaxMin });
      log((raw.teams[pending.team] || {}).name + ' dropped a ' + tw.name + '.');
    } else {
      const rb = pending.payload;
      Sync.write('effects/' + id, { type: 'roadblock', name: rb.name, kind: '⛔', effect: 'Opposing players may not pass.',
        by: pending.team, lat: latlng.lat, lon: latlng.lng, radiusKm: D.roadblockDiameterM / 2000,
        startedAt: now(), durationMin: D.roadblockMin });
      log((raw.teams[pending.team] || {}).name + ' dropped a ' + rb.name + '.');
    }
    pending = null; setMapMode('claim');
  }
  function removeEffect(id) {
    Sync.remove('effects/' + id);
    document.querySelectorAll('.leaflet-popup-close-button').forEach(b => b.click());
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
      return { ok: false, reason: owner ? (owner.team === teamId ? 'You already own it.' : '') : 'District is unclaimed — just claim it.' };
    const borders = Scoring.borderingOwned(did, ctx.ownedByTeam[teamId] || [], ctx.graph);
    if (!borders.length) return { ok: false, reason: 'You own no district bordering this one.', borders: [] };
    const n = Math.min(borders.length, 3);
    const cost = D.steal[String(n)];
    return { ok: true, borders, cost, n, owner: owner.team };
  }
  function startSteal(did, teamId) {
    const info = stealInfo(did, teamId);
    if (!info.ok) { toast(info.reason || 'Cannot steal.'); return; }
    if (!canAfford(teamId, info.cost)) { toast('Need ' + info.cost + ' coins to initiate.'); return; }
    adjustCoins(teamId, -info.cost, 'steal initiation on ' + Scoring.nameById[did]);
    Sync.write('steals/' + did, { by: teamId, startedAt: now(), paid: info.cost });
    log((raw.teams[teamId] || {}).name + ' is stealing ' + Scoring.nameById[did] + ' (-' + info.cost + ').');
    toast('Steal started — complete a DIFFERENT location challenge in ' + Scoring.nameById[did] + '.', 4000);
  }
  function completeSteal(did, challengeId) {
    const steal = (raw.steals || {})[did]; if (!steal) { claimDistrict(did, ui.selectedTeam, challengeId); return; }
    const cur = (raw.claims || {})[did];
    if (cur && cur.via && cur.via === challengeId) { toast('Must use a DIFFERENT location than the current claim.'); return; }
    Sync.write('claims/' + did, { team: steal.by, via: challengeId || null, at: now() });
    if (challengeId) Sync.write('challengeDone/' + challengeId, steal.by);
    Sync.remove('steals/' + did);
    log((raw.teams[steal.by] || {}).name + ' STOLE ' + Scoring.nameById[did] + '!');
    toast('Stolen: ' + Scoring.nameById[did]);
    document.querySelectorAll('.leaflet-popup-close-button').forEach(b => b.click());
  }
  function cancelSteal(did, defended) {
    Sync.remove('steals/' + did);
    log(defended ? (Scoring.nameById[did] + ' was defended & locked.') : ('Steal on ' + Scoring.nameById[did] + ' cancelled.'));
  }

  /* build: challenges & borders */
  function editChallenge(id, field, value) {
    const base = D.challenges.find(c => c.id === id);
    const cur = (raw.challenges || {})[id] || {};
    const merged = Object.assign({}, base, cur);
    merged[field] = value;
    // store only the editable fields
    const store = { name: merged.name, text: merged.text, districtId: merged.districtId,
                    lat: merged.lat == null ? null : merged.lat, lon: merged.lon == null ? null : merged.lon,
                    source: merged.source || 'custom' };
    Sync.write('challenges/' + id, store);
  }
  function addChallenge(districtId) {
    const id = uid('cc');
    Sync.write('challenges/' + id, { name: 'New challenge', text: '', districtId: districtId || Scoring.allIds[0], lat: null, lon: null, source: 'custom' });
    toast('Challenge added — edit it below.');
  }
  function deleteChallenge(id) {
    Sync.write('deletedChallenges/' + id, true);
    Sync.remove('challenges/' + id);
  }
  function toggleChallengeDone(id) {
    const done = (raw.challengeDone || {})[id];
    if (done) Sync.remove('challengeDone/' + id);
    else Sync.write('challengeDone/' + id, ui.selectedTeam || true);
  }
  function setBorder(a, b, on) {
    const k = [a, b].sort().join('|');
    Sync.write('borders/' + k, on);
  }

  function resetGame() {
    Sync.resetGame();
    ui.selectedTeam = null;
    toast('Game reset.');
  }

  /* export / import */
  function exportDeck() {
    return { type: 'jetlag-deck', version: 1, generated: new Date().toISOString(),
      challenges: mergedChallenges().map(c => ({ name: c.name, districtId: c.districtId, text: c.text || '',
        lat: c.lat == null ? null : c.lat, lon: c.lon == null ? null : c.lon, source: c.source || 'custom' })) };
  }
  function exportGame() {
    return { type: 'jetlag-game', version: 1, generated: new Date().toISOString(), room: Sync.getRoom(), state: raw };
  }
  function importDeck(obj) {
    const arr = Array.isArray(obj) ? obj : (obj.challenges || (obj.state && []) || []);
    if (!arr.length) { toast('No challenges found in that JSON.'); return; }
    const baseByKey = {};
    D.challenges.forEach(c => baseByKey[(c.name + '|' + c.districtId).toLowerCase()] = c.id);
    arr.forEach(c => {
      if (!c || !c.name) return;
      const did = Scoring.allIds.includes(c.districtId) ? c.districtId : Scoring.allIds[0];
      const key = (c.name + '|' + did).toLowerCase();
      const id = baseByKey[key] || uid('cc');
      Sync.write('challenges/' + id, { name: c.name, text: c.text || '', districtId: did,
        lat: c.lat == null ? null : c.lat, lon: c.lon == null ? null : c.lon, source: c.source || 'imported' });
    });
  }
  function resetDeck() {
    Sync.remove('challenges'); Sync.remove('deletedChallenges');
    toast('Deck reset to manual defaults.');
  }

  /* ---------- map tap routing ---------- */
  function setMapMode(m) {
    ui.mapMode = m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    const hint = { claim: 'Tap a district to claim it for the selected team. Tap your own to release.',
      tower: pending ? 'Tap the map to drop your tower.' : 'Buy a tower in Shops, then drop it.',
      roadblock: pending ? 'Tap the map to drop your roadblock.' : 'Buy a roadblock in Shops, then drop it.',
      info: 'Tap a district to see its challenges & details.' };
    const el = document.getElementById('mapHint'); if (el) el.textContent = hint[m] || '';
  }
  function handleDistrictTap(id, latlng) {
    if (ui.mapMode === 'tower' || ui.mapMode === 'roadblock') { if (pending) placePending(latlng); return; }
    if (ui.mapMode === 'info') { openDistrictInfo(id); return; }
    // claim mode
    const c = (raw.claims || {})[id];
    if (c && c.team === ui.selectedTeam) { unclaim(id); return; }
    if (c && c.team !== ui.selectedTeam) {
      ui.selectedDistrict = id; openDistrictInfo(id);
      toast(Scoring.nameById[id] + ' is owned by ' + ((raw.teams[c.team] || {}).name || 'another team') + ' — use Steal.');
      return;
    }
    claimDistrict(id, ui.selectedTeam, null);
  }
  function handleMapTap(latlng) {
    if ((ui.mapMode === 'tower' || ui.mapMode === 'roadblock') && pending) placePending(latlng);
  }

  function openDistrictInfo(id) {
    ui.selectedDistrict = id;
    const chs = ctx.challenges.filter(c => c.districtId === id);
    const claim = (raw.claims || {})[id];
    const steal = (raw.steals || {})[id];
    const owner = claim ? (raw.teams[claim.team] || {}).name : 'Unclaimed';
    let html = `<div class="popup-meta">${esc(owner)} · ${fmtArea(Scoring.areaById[id])} km²${steal ? ' · ⚔️ steal in progress' : ''}</div>`;
    html += `<div style="margin-top:6px;font-weight:600">Locations (${chs.length})</div>`;
    if (!chs.length) html += `<div class="popup-meta">No challenges yet — add them in Build.</div>`;
    chs.forEach(ch => {
      const done = (raw.challengeDone || {})[ch.id];
      const blockedBySteal = steal && claim && claim.via === ch.id;
      html += `<div style="margin-top:6px;border-top:1px solid #2a3040;padding-top:6px">
        <b>${esc(ch.name)}</b>${done ? ' ✅' : ''}<br><span style="font-size:12px;color:#9aa7b4">${esc(ch.text || '—')}</span><br>
        <button class="popup-btn" ${blockedBySteal ? 'disabled' : ''} onclick="App.claimViaChallenge('${ch.id}')">${steal ? 'Steal' : 'Claim'} via this${blockedBySteal ? ' (used by owner)' : ''}</button></div>`;
    });
    GameMap.flyTo(id);
    GameMap.popupAtDistrict(id, html);
    render();
  }

  /* ---------- focus guard ---------- */
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input,textarea,[contenteditable="true"]')) typing = true;
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.matches('input,textarea,[contenteditable="true"]')) {
      typing = false;
      if (pendingRender) { pendingRender = false; setTimeout(render, 0); }
    }
  });

  /* ---------- boot ---------- */
  function boot() {
    GameMap.init();
    Play.init();
    Build.init();
    wireChrome();
    Sync.init({ onState, onStatus: updateConn });
    setInterval(() => { if (ui.tab === 'play') Play.tick(ctx); }, 1000);
  }

  function updateConn(s) {
    const dot = document.getElementById('connDot');
    const label = document.getElementById('connLabel');
    dot.className = 'conn-dot ' + (s.online ? 'on' : 'local');
    label.textContent = s.online ? ('Live · ' + s.room) : ('Local · ' + s.room);
  }

  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('tab-play').classList.toggle('hidden', tab !== 'play');
    document.getElementById('tab-build').classList.toggle('hidden', tab !== 'build');
    if (tab === 'play') GameMap.invalidate();
    render();
  }

  function wireChrome() {
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setMapMode(b.dataset.mode));
    document.getElementById('connBtn').onclick = openConnModal;
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModals);
    document.querySelectorAll('.modal-back').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    switchTab('play');
  }

  /* ---------- modals ---------- */
  function openModal(which) { document.getElementById(which).classList.remove('hidden'); }
  function closeModals() { document.querySelectorAll('.modal-back').forEach(m => m.classList.add('hidden')); }
  function genModal(title, html) {
    document.getElementById('genTitle').textContent = title;
    document.getElementById('genBody').innerHTML = html;
    openModal('genModal');
  }
  function openConnModal() {
    const room = Sync.getRoom();
    const cfg = localStorage.getItem('jetlag.fbconfig') || '';
    const body = document.getElementById('connModalBody');
    body.innerHTML = `
      <div class="note">Paste your <b>Firebase Realtime Database</b> config to sync all phones live. One person sets it up once and shares the <b>same config + room code</b> with everyone.
        <ol>
          <li>Create a free project at <a href="https://console.firebase.google.com" target="_blank">console.firebase.google.com</a></li>
          <li>Build → <b>Realtime Database</b> → Create → start in <b>test mode</b></li>
          <li>Project settings → <b>Your apps</b> → Web → copy the <span class="kbd">firebaseConfig</span> object</li>
          <li>Paste it below (must include <span class="kbd">databaseURL</span>)</li>
        </ol>
      </div>
      <label>Room code (everyone uses the same one)</label>
      <input id="roomInput" value="${esc(room)}" placeholder="e.g. hk-jun17" />
      <label>Firebase config (JSON or the JS object)</label>
      <textarea id="cfgInput" placeholder='{ "apiKey": "...", "databaseURL": "https://xxx.firebaseio.com", "projectId": "..." }'>${esc(cfg)}</textarea>
      <div class="row-btns">
        <button class="btn" id="connectBtn">Connect & sync</button>
        <button class="btn ghost" id="localBtn">Use offline (this device)</button>
      </div>
      <div class="row-btns">
        <button class="btn bad" id="resetGameBtn">Reset whole game</button>
      </div>`;
    openModal('connModal');
    document.getElementById('connectBtn').onclick = () => {
      const r = document.getElementById('roomInput').value.trim() || 'hk-default';
      let txt = document.getElementById('cfgInput').value.trim();
      try {
        const cfg = parseConfig(txt);
        if (!cfg.databaseURL) throw new Error('Config needs a databaseURL.');
        Sync.connect(cfg, r); closeModals(); toast('Connecting…');
      } catch (e) { alert('Could not parse config: ' + e.message); }
    };
    document.getElementById('localBtn').onclick = () => {
      const r = document.getElementById('roomInput').value.trim() || 'hk-default';
      Sync.disconnect(); Sync.changeRoom(r); closeModals(); toast('Offline mode.');
    };
    document.getElementById('resetGameBtn').onclick = () => {
      if (confirm('Reset the ENTIRE game (claims, coins, teams, towers)? Challenge edits stay.')) { resetGame(); closeModals(); }
    };
  }
  function parseConfig(txt) {
    // accept JSON or a JS "firebaseConfig = { ... }" snippet
    const m = txt.match(/\{[\s\S]*\}/); if (m) txt = m[0];
    try { return JSON.parse(txt); }
    catch (e) {
      // loose: quote keys
      const fixed = txt.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
      return JSON.parse(fixed);
    }
  }

  return {
    boot, render, esc, fmtArea, toast, ctx: () => ctx, ui, D, now,
    // actions used by views & inline handlers
    addTeam, renameTeam, setTeamColor, removeTeam, selectTeam,
    claimDistrict, unclaim, claimViaChallenge, openDistrictInfo,
    setCoins, adjustCoins, canAfford, transportCost, chargeTransport,
    buyPowerup, drawTower, buyRoadblock, removeEffect, effectRemaining,
    stealInfo, startSteal, completeSteal, cancelSteal,
    editChallenge, addChallenge, deleteChallenge, toggleChallengeDone, setBorder,
    handleDistrictTap, handleMapTap, setMapMode, genModal, resetGame,
    exportDeck, exportGame, importDeck, resetDeck,
    PALETTE
  };
})();

window.addEventListener('DOMContentLoaded', App.boot);
