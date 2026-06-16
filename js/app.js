/* ============================================================
   App — central controller (v2).
   Tabs: Game (shared) · My Team (your stuff) · Build (host editor).
   Identity/PIN gating via Auth; you can only change your own team.
   ============================================================ */
const App = (function () {
  const D = window.JETLAG_DATA;
  // Jet Lag red / green / yellow team colours (+ a few extras for big games)
  const PALETTE = ['#e63329', '#1faa59', '#f5c518', '#e67e22', '#2d9cdb', '#9b59b6'];

  let raw = {};
  let ctx = {};
  let typing = false, pendingRender = false;
  let pending = null;            // pending roadblock placement {team, payload}
  let geoWatch = null;           // geolocation watch id

  const ui = {
    tab: 'game', buildView: 'challenges', mapMode: 'claim', shop: 'powerup',
    hostActing: null, showBordersFor: null, deckDistrict: '', deckSearch: '',
    transport: { mode: 0, minutes: 10, mtr: 10, mtrFrom: '', mtrTo: '', mtrMode: 'cheapest' }, powerN: {}, search: '', filterDistrict: '', stealTarget: null
  };

  /* ---------- utils ---------- */
  const now = () => Date.now();
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtArea(km2) { return (km2 || 0).toFixed(1); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmtCoins(n) { return round2(n).toFixed(2).replace(/\.?0+$/, ''); }
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
    Object.keys(teams).forEach(t => scores[t] = Scoring.teamScore(ownedByTeam[t] || []));

    ctx = {
      teams, claims, steals: raw.steals || {}, coins: raw.coins || {}, effects: raw.effects || {},
      challengeDone: raw.challengeDone || {}, log: raw.log || {}, borders, graph, challenges,
      locations: raw.locations || {}, meta: raw.meta || {},
      flop: raw.flop || {}, flopProtect: raw.flopProtect || {}, flopRound: raw.flopRound || null,
      privateDeck: raw.privateDeck || {}, privateEpoch: raw.privateEpoch || {},
      ownedByTeam, scores, showMarkers: true, ui,
      me: currentTeam(), role: Auth.role(), isHost: Auth.isHost(),
      sharingLoc: isSharingLoc(), showBordersFor: ui.showBordersFor
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
    Sync.update('teams/' + id, { id, name: name || ('Team ' + (Object.keys(raw.teams || {}).length + 1)), color: color || PALETTE[Object.keys(raw.teams || {}).length % PALETTE.length], pin: String(pin || ''), incomeEpoch: 0 });
    Sync.write('coins/' + id, D.startingBudget);
    if (!(raw.meta || {}).incomeStartedAt) Sync.write('meta/incomeStartedAt', now());   // start the coin clock
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

  /* claims — Flop version.
     normal challenge → claim (stealable).  hard challenge → claim & LOCK (permanent),
     or STEAL an opponent's district if you own a bordering one (land/sea). */
  function claimDistrict(did, teamId, challengeId, locked) {
    if (!teamId) { toast('🔒 Log in as a team (top-right) to claim.'); return; }
    if (!requireActAs(teamId)) return;
    Sync.write('claims/' + did, { team: teamId, via: challengeId || null, at: now(), locked: !!locked });
    if (challengeId) Sync.write('challengeDone/' + challengeId, teamId);
    const tn = (raw.teams[teamId] || {}).name || 'Team';
    log(tn + ' claimed ' + Scoring.nameById[did] + (locked ? ' 🔒 (hard challenge)' : '') + '.');
    toast(tn + ' claimed ' + Scoring.nameById[did] + (locked ? ' 🔒' : ''));
    maintainFlopAfterClaim(did, teamId, !!locked);
  }
  function unclaim(did) {
    const c = (raw.claims || {})[did]; if (!c) return;
    if (!requireActAs(c.team)) return;
    Sync.remove('claims/' + did);
    log((raw.teams[c.team] || {}).name + ' released ' + Scoring.nameById[did] + '.');
  }
  function lockDistrict(did, challengeId) {
    const c = (raw.claims || {})[did]; if (!c) return;
    if (!requireActAs(c.team)) return;
    Sync.write('claims/' + did + '/locked', true);
    if (challengeId) Sync.write('challengeDone/' + challengeId, c.team);
    log((raw.teams[c.team] || {}).name + ' locked ' + Scoring.nameById[did] + ' 🔒 (hard challenge).');
    toast('Locked ' + Scoring.nameById[did] + ' — permanent.');
    maintainFlopAfterClaim(did, c.team, true);           // hard-challenge control → swap round
  }
  // unified completion of a normal/hard challenge tied to a district
  function completeChallenge(challengeId) {
    const ch = ctx.challenges.find(c => c.id === challengeId); if (!ch) return;
    const did = ch.districtId;
    if (!did) { toast('This card is handled in The Flop (coming soon).'); return; }
    const me = currentTeam();
    if (!me) { toast('🔒 Log in as a team first.'); return; }
    if (!requireActAs(me)) return;
    const claim = (raw.claims || {})[did];
    const isHard = ch.type === 'hard';
    if (!claim) {                                   // unclaimed → claim (hard locks)
      claimDistrict(did, me, challengeId, isHard);
    } else if (claim.team === me) {                 // own it
      if (isHard) lockDistrict(did, challengeId);
      else toast('You already own ' + Scoring.nameById[did] + '.');
    } else {                                        // opponent owns it → steal attempt
      if (claim.locked) { toast('🔒 ' + Scoring.nameById[did] + ' is locked — cannot be stolen.'); return; }
      if (!isHard) { toast('To steal, you must complete this district’s HARD challenge.'); return; }
      const borders = Scoring.borderingOwned(did, ctx.ownedByTeam[me] || [], ctx.graph);
      if (!borders.length) { toast('You must own a district bordering ' + Scoring.nameById[did] + ' (land or sea) to steal it.'); return; }
      Sync.write('claims/' + did, { team: me, via: challengeId, at: now(), locked: true });
      Sync.write('challengeDone/' + challengeId, me);
      log((raw.teams[me] || {}).name + ' STOLE ' + Scoring.nameById[did] + ' 🔒 (hard challenge).');
      toast('Stolen: ' + Scoring.nameById[did] + ' 🔒');
      maintainFlopAfterClaim(did, me, true);
    }
    closePopups();
  }

  /* ============ THE FLOP ============
     At most flopSize (6) NORMAL cards, each from a DIFFERENT unclaimed district.
     Complete one → claim → it leaves the Flop and a new card is drawn. The
     completer may swap one more card; other teams may protect a card first. */
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
  function flopList() {
    const f = raw.flop || {};
    return Object.keys(f).map(id => ctx.challenges.find(c => c.id === id)).filter(Boolean)
      .sort((a, b) => (f[a.id] || 0) - (f[b.id] || 0));
  }
  function eligibleForFlop() {
    const inFlop = new Set(Object.keys(raw.flop || {}));
    const flopD = new Set(flopList().map(c => c.districtId));
    const claims = raw.claims || {};
    const done = raw.challengeDone || {};                 // completed challenges never reappear
    return ctx.challenges.filter(c =>
      c.type === 'normal' && c.districtId && (c.text || '').trim() &&
      !done[c.id] && !inFlop.has(c.id) && !claims[c.districtId] && !flopD.has(c.districtId));
  }
  // TOP UP: keep existing cards, only fill empty slots (up to flopSize) from the pool
  function dealFlop() {
    if (!requireHost()) return;
    const size = D.flopSize || 6;
    const map = Object.assign({}, raw.flop || {});
    if (Object.keys(map).length >= size) { toast('The Flop is already full (' + size + '/' + size + ').'); return; }
    const usedD = new Set(flopList().map(c => c.districtId));
    let added = 0; const t = now();
    for (const c of shuffle(eligibleForFlop())) {
      if (Object.keys(map).length >= size) break;
      if (!usedD.has(c.districtId)) { map[c.id] = t + (added++); usedD.add(c.districtId); }
    }
    Sync.write('flop', map);
    log('The Flop was filled (+' + added + ' card' + (added === 1 ? '' : 's') + ').');
    toast(added ? ('Filled The Flop (+' + added + ').') : 'No eligible districts left to add.');
  }
  // full reset: discard everything and deal a fresh set
  function redealFlop() {
    if (!requireHost()) return;
    Sync.remove('flop'); Sync.remove('flopProtect'); Sync.remove('flopRound');
    setTimeout(dealFlop, 50);
    log('The Flop was re-dealt from scratch.');
  }
  function drawFlopCard(excludeDistrict) {
    const pool = eligibleForFlop().filter(c => c.districtId !== excludeDistrict);
    if (!pool.length) return null;
    const c = pool[Math.floor(Math.random() * pool.length)];
    Sync.write('flop/' + c.id, now());
    return c;
  }
  // when a district becomes claimed, drop its Flop card & draw a replacement; open a round
  function maintainFlopAfterClaim(did, byTeam, viaHard) {
    const flop = raw.flop || {}; let removed = false;
    ctx.challenges.forEach(c => { if (c.districtId === did && flop[c.id]) { Sync.remove('flop/' + c.id); removed = true; } });
    if (removed) drawFlopCard(did);                       // keep the Flop at 6
    // swap/protect round only when control is gained via a HARD challenge (rule 12)
    if (viaHard) { Sync.write('flopRound', { by: byTeam, at: now() }); Sync.remove('flopProtect'); }
    // the claimed district's cards disappear from every private deck (no auto-replace —
    // the private deck grows on a fixed schedule, not a fixed size)
    const pdAll = raw.privateDeck || {};
    Object.keys(pdAll).forEach(tid => {
      ctx.challenges.forEach(c => { if (c.districtId === did && (pdAll[tid] || {})[c.id]) Sync.remove('privateDeck/' + tid + '/' + c.id); });
    });
  }
  function protectFlopCard(cardId) {
    const me = currentTeam(); const round = raw.flopRound;
    if (!me || !round) return;
    if (round.by === me) { toast('You are the one who may swap — opponents protect.'); return; }
    const prot = raw.flopProtect || {};
    if (Object.values(prot).includes(me)) { toast('You already protected a card this round.'); return; }
    Sync.write('flopProtect/' + cardId, me);
    log((raw.teams[me] || {}).name + ' protected a Flop card.');
  }
  function swapFlopCard(cardId) {
    const me = currentTeam(); const round = raw.flopRound;
    if (!round || round.by !== me) { toast('Only the team that just claimed may swap.'); return; }
    if ((raw.flopProtect || {})[cardId]) { toast('That card is protected this round.'); return; }
    const card = ctx.challenges.find(c => c.id === cardId);
    Sync.remove('flop/' + cardId);
    drawFlopCard(card ? card.districtId : null);
    Sync.remove('flopRound'); Sync.remove('flopProtect');
    log((raw.teams[me] || {}).name + ' swapped a Flop card.');
    toast('Swapped a card.');
  }
  function endFlopRound() { Sync.remove('flopRound'); Sync.remove('flopProtect'); }

  /* ============ PRIVATE DECK (per team) ============
     1 card at game start, a 2nd at +3h, then +1 every 2h. The team's OWN
     device draws its private cards (kept private + survives reloads via epoch). */
  function privateList(teamId) {
    const pd = (raw.privateDeck || {})[teamId] || {};
    return Object.keys(pd).map(id => ctx.challenges.find(c => c.id === id)).filter(Boolean)
      .sort((a, b) => (pd[a.id] || 0) - (pd[b.id] || 0));
  }
  function privateDueCount() {
    const start = (raw.meta || {}).incomeStartedAt; if (!start) return 0;
    const E = (now() - start) / 60000; const pd = D.privateDeck;
    if (E < pd.secondAtMin) return 1;
    return 2 + Math.floor((E - pd.secondAtMin) / pd.thenEveryMin);
  }
  function nextPrivate() {
    const start = (raw.meta || {}).incomeStartedAt; if (!start) return null;
    const E = (now() - start) / 60000; const pd = D.privateDeck;
    let nextAt;
    if (E < pd.secondAtMin) nextAt = pd.secondAtMin;
    else nextAt = pd.secondAtMin + (Math.floor((E - pd.secondAtMin) / pd.thenEveryMin) + 1) * pd.thenEveryMin;
    return { msLeft: (start + nextAt * 60000) - now() };
  }
  function eligibleForPrivate() {
    const claims = raw.claims || {};
    const inFlop = new Set(Object.keys(raw.flop || {}));
    const inPriv = new Set();
    Object.values(raw.privateDeck || {}).forEach(pd => Object.keys(pd || {}).forEach(id => inPriv.add(id)));
    const done = raw.challengeDone || {};
    return ctx.challenges.filter(c => c.type === 'normal' && c.districtId && (c.text || '').trim()
      && !done[c.id] && !claims[c.districtId] && !inFlop.has(c.id) && !inPriv.has(c.id));
  }
  function drawPrivateCard(teamId) {
    const pool = eligibleForPrivate(); if (!pool.length) return null;
    const c = pool[Math.floor(Math.random() * pool.length)];
    Sync.write('privateDeck/' + teamId + '/' + c.id, now());
    return c;
  }
  function tickPrivate() {
    const me = Auth.teamId(); if (!me) return;          // only your own device deals your private cards
    if (!(raw.meta || {}).incomeStartedAt) return;
    const due = privateDueCount(); const ep = (raw.privateEpoch || {})[me] || 0;
    if (due > ep) {
      for (let i = 0; i < due - ep; i++) drawPrivateCard(me);
      Sync.write('privateEpoch/' + me, due);
      log((raw.teams[me] || {}).name + ' drew a private challenge card.');
    }
  }

  /* coins (decimals allowed) */
  function setCoins(teamId, val) { if (requireActAs(teamId)) Sync.write('coins/' + teamId, round2(val)); }
  function adjustCoins(teamId, delta, reason, silent) {
    if (!silent && !requireActAs(teamId)) return;
    const cur = (raw.coins || {})[teamId] || 0;
    Sync.write('coins/' + teamId, round2(cur + delta));
    if (reason) log((raw.teams[teamId] || {}).name + ': ' + (delta >= 0 ? '+' : '') + fmtCoins(delta) + ' coins — ' + reason + '.');
  }
  function canAfford(teamId, cost) { return ((raw.coins || {})[teamId] || 0) >= cost; }

  /* passive income: +incomeAmount every incomeIntervalMin. Host's device credits
     it (and any backlog) so it survives reloads without double-paying. */
  function incomeIntervalMs() { return D.incomeIntervalMin * 60000; }
  function nextIncome() {
    const start = (raw.meta || {}).incomeStartedAt; if (!start) return null;
    const iv = incomeIntervalMs(), due = Math.floor((now() - start) / iv);
    return { msLeft: (start + (due + 1) * iv) - now(), due, amount: D.incomeAmount };
  }
  function tickIncome() {
    if (!Auth.isHost()) return;
    const start = (raw.meta || {}).incomeStartedAt; if (!start) return;
    const due = Math.floor((now() - start) / incomeIntervalMs());
    if (due <= 0) return;
    Object.keys(raw.teams || {}).forEach(tid => {
      const ep = (raw.teams[tid] || {}).incomeEpoch || 0;
      if (due > ep) {
        const add = (due - ep) * D.incomeAmount;
        Sync.write('coins/' + tid, round2(((raw.coins || {})[tid] || 0) + add));
        Sync.write('teams/' + tid + '/incomeEpoch', due);
        log((raw.teams[tid] || {}).name + ': +' + add + ' coins (income).');
      }
    });
  }
  function resetIncomeClock() {
    if (!requireHost()) return;
    Sync.write('meta/incomeStartedAt', now());
    Object.keys(raw.teams || {}).forEach(tid => Sync.write('teams/' + tid + '/incomeEpoch', 0));
    toast('Coin clock reset — next payout in ' + D.incomeIntervalMin + ' min.');
  }

  /* live location sharing (opt-in, per device) */
  function isSharingLoc() { return localStorage.getItem('jetlag.shareLoc') === '1'; }
  function toggleLocation() { isSharingLoc() ? stopLocation() : startLocation(); }
  function startLocation() {
    const me = currentTeam();
    if (!me) { toast('🔒 Log in as a team first.'); return; }
    if (!navigator.geolocation) { toast('Geolocation not supported on this device.'); return; }
    localStorage.setItem('jetlag.shareLoc', '1');
    if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = navigator.geolocation.watchPosition(
      pos => { const t = currentTeam(); if (t) Sync.write('locations/' + t, { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), at: now() }); },
      err => { toast('Location: ' + err.message); if (err.code === 1) stopLocation(); },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 25000 });
    toast('📍 Sharing your live location.'); render();
  }
  function stopLocation() {
    localStorage.removeItem('jetlag.shareLoc');
    if (geoWatch != null && navigator.geolocation) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    const me = currentTeam(); if (me) Sync.remove('locations/' + me);
    toast('Location sharing off.'); render();
  }

  /* transport */
  function transportCost() {
    const t = D.transport[ui.transport.mode] || D.transport[0];
    if (t.rule === 'map') {                          // MTR: compute fare from From/To via the MTR module
      const from = ui.transport.mtrFrom, to = ui.transport.mtrTo;
      if (typeof MTR !== 'undefined' && MTR.valid(from) && MTR.valid(to) && from !== to) {
        const r = MTR.compute(from, to, ui.transport.mtrMode || 'cheapest');
        if (r.ok) return { cost: round2(r.fareUnits * (t.mult || 3)), label: t.mode, rate: t.desc, mtr: r };
      }
      return { cost: 0, label: t.mode, rate: t.desc };
    }
    const mins = Number(ui.transport.minutes) || 0;
    const cost = t.rule === 'per2min' ? t.rate * mins / 2 : t.rate * mins;
    return { cost: round2(cost), label: t.mode, rate: t.desc };
  }
  function chargeTransport() {
    const team = currentTeam();
    if (!team) { toast('🔒 Log in as a team first.'); return; }
    const tc = transportCost();
    if (tc.cost <= 0) {
      toast((D.transport[ui.transport.mode] || {}).rule === 'map' ? 'Pick two MTR stations.' : 'Enter time.');
      return;
    }
    let label = tc.label;
    if (tc.mtr) label += ' ' + ui.transport.mtrFrom + ' → ' + ui.transport.mtrTo;
    adjustCoins(team, -tc.cost, 'transport · ' + label);
    toast('−' + fmtCoins(tc.cost) + ' coins · ' + label);
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

  /* steal (Flop version): need a bordering district (land/sea) + complete the
     target's HARD challenge. No coin cost. Returns the hard challenge to do. */
  function stealInfo(did, teamId) {
    const owner = (raw.claims || {})[did];
    if (!owner || !teamId || owner.team === teamId) return { ok: false };
    if (owner.locked) return { ok: false, locked: true, reason: 'Locked — already secured via a hard challenge.' };
    const borders = Scoring.borderingOwned(did, ctx.ownedByTeam[teamId] || [], ctx.graph);
    const hard = ctx.challenges.find(c => c.districtId === did && c.type === 'hard');
    return { ok: borders.length > 0, borders, hard, owner: owner.team,
             reason: borders.length ? '' : 'Need a district bordering this one (land or sea).' };
  }

  /* deck / borders (host) */
  function editChallenge(id, field, value) {
    if (!requireHost()) return;
    const base = D.challenges.find(c => c.id === id);
    const merged = Object.assign({}, base, (raw.challenges || {})[id] || {});
    merged[field] = value;
    Sync.write('challenges/' + id, { name: merged.name, text: merged.text, districtId: merged.districtId, type: merged.type || 'normal',
      lat: merged.lat == null ? null : merged.lat, lon: merged.lon == null ? null : merged.lon, source: merged.source || 'custom' });
  }
  function addChallenge(districtId) {
    if (!requireHost()) return;
    const id = uid('cc');
    Sync.write('challenges/' + id, { name: 'New challenge', text: '', districtId: districtId || Scoring.allIds[0], type: 'normal', lat: null, lon: null, source: 'custom' });
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
    if (c && c.team !== me) { openDistrictInfo(id); return; }
    claimDistrict(id, me, null);
  }
  function handleMapTap(latlng) { if (ui.mapMode === 'roadblock' && pending) placePending(latlng); }

  function openDistrictInfo(id) {
    ui.showBordersFor = id;
    const chs = ctx.challenges.filter(c => c.districtId === id);
    const claim = (raw.claims || {})[id];
    const me = currentTeam();
    const owner = claim ? ((raw.teams[claim.team] || {}).name + (claim.locked ? ' 🔒' : '')) : 'Unclaimed';
    const { land, sea } = Scoring.neighborsByType(id, ctx.graph);
    const nm = d => esc(Scoring.nameById[d]);
    const si = stealInfo(id, me);
    let html = `<div class="popup-meta">${esc(owner)} · ${fmtArea(Scoring.areaById[id])} km²</div>`;
    html += `<div style="margin-top:6px"><b>Borders</b></div>`;
    html += `<div style="font-size:12px"><span style="color:#22c55e">🟢 Land:</span> ${land.length ? land.map(nm).join(', ') : '—'}</div>`;
    html += `<div style="font-size:12px"><span style="color:#22d3ee">🩵 Sea:</span> ${sea.length ? sea.map(nm).join(', ') : '—'}</div>`;
    if (claim && claim.team !== me && me) {
      html += si.ok
        ? `<div class="popup-meta" style="margin-top:5px;color:#f5c518">⚔️ Stealable — complete the HARD challenge below.</div>`
        : `<div class="popup-meta" style="margin-top:5px">${si.locked ? '🔒 Locked — cannot be stolen.' : '⚔️ To steal: ' + esc(si.reason || '')}</div>`;
    }
    html += `<div style="margin-top:6px;font-weight:600">Challenges (${chs.length})</div>`;
    if (!chs.length) html += `<div class="popup-meta">No challenges yet.</div>`;
    chs.forEach(ch => {
      const done = (raw.challengeDone || {})[ch.id];
      const hard = ch.type === 'hard';
      const dt = done ? (raw.teams[done] || {}) : null;
      html += `<div class="popup-ch ${hard ? 'hard' : ''}">
        <b>${hard ? '🟧 ' : ''}${esc(ch.name)}</b>${dt ? ` <span class="popup-done" style="background:${esc(dt.color || '#22c55e')}">✓ ${esc(dt.name)}</span>` : ''}<br>
        <span style="font-size:12px;color:#9aa7b4">${esc(ch.text || '—')}</span><br>
        <button class="popup-btn" onclick="App.completeChallenge('${ch.id}')">Complete${hard ? ' (hard)' : ''}</button></div>`;
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
    setInterval(() => { tickIncome(); tickPrivate(); if (ui.tab === 'game') Game.tick(ctx); if (ui.tab === 'team') Team.tick(ctx); }, 1000);
    if (isSharingLoc()) setTimeout(startLocation, 1500);   // resume location sharing
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
    boot, render, esc, fmtArea, fmtCoins, round2, toast, ctx: () => ctx, ui, D, now, PALETTE,
    currentTeam, switchTab, openLoginModal, clearBorders, openDistrictInfo,
    createTeam, addTeamHost, renameTeam, setTeamColor, removeTeam, setHostActing,
    claimDistrict, unclaim, lockDistrict, completeChallenge,
    dealFlop, redealFlop, flopList, eligibleForFlop, swapFlopCard, protectFlopCard, endFlopRound,
    privateList, nextPrivate,
    setCoins, adjustCoins, canAfford, transportCost, chargeTransport,
    nextIncome, resetIncomeClock,
    toggleLocation, isSharingLoc, startLocation, stopLocation,
    buyPowerup, buyRoadblock, removeEffect, effectRemaining,
    stealInfo,
    editChallenge, addChallenge, deleteChallenge, toggleChallengeDone, setBorder,
    handleDistrictTap, handleMapTap, setMapMode, genModal, resetGame, resetDeck,
    exportDeck, exportGame, importDeck
  };
})();

window.addEventListener('DOMContentLoaded', App.boot);
