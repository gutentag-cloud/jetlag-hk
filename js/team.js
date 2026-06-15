/* ============================================================
   Team — the private "My Team" tab for the logged-in team:
   coins, transport calculator, shops, steal, your claimed
   districts and completed challenges. Host can act as any team.
   ============================================================ */
const Team = (function () {
  const D = window.JETLAG_DATA;
  const esc = s => App.esc(s);
  let C = {};

  function init() {}
  function tick(ctx) { C = ctx || C; const el = document.getElementById('incomeCountdown'); if (el) el.textContent = incomeText(); }

  function incomeText() {
    const ni = App.nextIncome();
    if (!ni) return '⏱ Coin clock starts when the first team joins.';
    const s = Math.max(0, Math.floor(ni.msLeft / 1000)), m = Math.floor(s / 60);
    return `⏱ +${ni.amount} coins in ${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function render(ctx) {
    C = ctx;
    const el = document.getElementById('teamBody');
    const me = C.me;
    if (C.role === 'spectator') {
      el.innerHTML = `<div class="card" style="max-width:520px;margin:0 auto">
        <div class="card-h">👤 My Team</div>
        <div style="text-align:center;padding:24px 16px">
          <p style="color:#9aa7b4">Log in as a team to manage your coins, claims, shops and steals.</p>
          <button class="btn wide" onclick="App.openLoginModal()">Log in / create a team</button></div></div>`;
      return;
    }
    if (!me) {
      el.innerHTML = `<div class="card" style="max-width:520px;margin:0 auto"><div class="card-h">👑 Host</div>
        <div style="text-align:center;padding:24px 16px"><p style="color:#9aa7b4">No teams yet.</p>
        <button class="btn wide" onclick="App.addTeamHost()">+ Add a team</button></div></div>`;
      return;
    }
    const t = C.teams[me] || {}; const coins = (C.coins || {})[me] || 0;
    const s = C.scores[me] || { count: 0, bestArea: 0, totalArea: 0 };
    const mine = (C.ownedByTeam[me] || []).slice().sort((a, b) => Scoring.areaById[b] - Scoring.areaById[a]);
    const myDone = (C.challenges || []).filter(c => (C.challengeDone || {})[c.id] === me);

    el.innerHTML = `
      <div class="team-wrap">
      ${C.isHost ? `<div class="host-banner">👑 Host — acting as
        <select class="host-acting" onchange="App.setHostActing(this.value)">
          ${Object.values(C.teams).map(x => `<option value="${x.id}" ${x.id === me ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>
        <button class="mini-btn" onclick="App.addTeamHost()">+ Team</button></div>` : ''}

      <div class="card">
        <div class="card-h"><span class="dcolor" style="background:${esc(t.color)}"></span>
          <input class="team-name" value="${esc(t.name)}" onchange="App.renameTeam('${me}',this.value)" />
          <input type="color" class="team-color" value="${esc(t.color)}" onchange="App.setTeamColor('${me}',this.value)" />
        </div>
        <div class="coin-bar">
          <div class="coin-big ${coins < 0 ? 'neg' : ''}">🪙 ${App.fmtCoins(coins)}</div>
          <div class="coin-ctrl">
            <button onclick="App.adjustCoins('${me}',-50,'manual')">−50</button>
            <input type="number" step="any" value="${App.fmtCoins(coins)}" onchange="App.setCoins('${me}',this.value)" />
            <button onclick="App.adjustCoins('${me}',50,'manual')">+50</button>
          </div>
        </div>
        <div class="income-row"><span id="incomeCountdown">${incomeText()}</span>
          ${C.isHost ? `<button class="link-btn" onclick="App.resetIncomeClock()">reset clock</button>` : ''}</div>
        <div class="team-stats">🗺 ${s.count} districts · ${App.fmtArea(s.totalArea)} km² total area</div>
        <button class="btn ${C.sharingLoc ? 'good' : 'ghost'} wide loc-toggle" onclick="App.toggleLocation()">${C.sharingLoc ? '📍 Sharing live location — tap to stop' : '📍 Share my live location'}</button>
      </div>

      <div class="card"><div class="card-h">🚇 Transport Calculator</div><div id="tcalc"></div></div>

      <div class="card"><div class="card-h">🛒 Shops</div>
        <div class="shop-tabs">
          <button class="shop-tab ${App.ui.shop === 'powerup' ? 'active' : ''}" onclick="Team.setShop('powerup')">Powerups</button>
          <button class="shop-tab ${App.ui.shop === 'roadblock' ? 'active' : ''}" onclick="Team.setShop('roadblock')">Roadblocks</button>
        </div>
        <div id="shopBody"></div></div>

      <div class="card"><div class="card-h">⚔️ Steal a District</div><div id="stealPanel"></div></div>

      <div class="card"><div class="card-h">🗺 My Districts <span class="card-h-note">${mine.length}</span></div>
        <div id="myDistricts">${mine.length ? mine.map(d => `<div class="mini-row">
            <span class="dcolor" style="background:${esc(t.color)}"></span><span style="flex:1">${esc(Scoring.nameById[d])}${(C.claims[d] || {}).locked ? ' 🔒' : ''}</span>
            <span class="tiny">${App.fmtArea(Scoring.areaById[d])} km²</span>
            <button class="btn ghost xs" onclick="App.openDistrictInfo('${d}')">map</button>
            <button class="btn bad xs" onclick="App.unclaim('${d}')">release</button></div>`).join('')
          : '<div class="empty">No districts yet — claim some on the Game map.</div>'}</div></div>

      <div class="card"><div class="card-h">✅ My Completed Challenges <span class="card-h-note">${myDone.length}</span></div>
        <div>${myDone.length ? myDone.map(c => `<div class="mini-row"><span style="flex:1">${esc(c.name)}</span>
          <span class="tiny">${esc(Scoring.nameById[c.districtId])}</span></div>`).join('')
          : '<div class="empty">None yet. Complete a location challenge to claim a district.</div>'}</div></div>
      </div>`;

    renderTransport(); renderShops(); renderSteal();
  }

  /* transport — per-minute stepper, or built-in MTR route+fare calculator */
  function renderTransport() {
    const el = document.getElementById('tcalc'); if (!el) return;
    const tu = App.ui.transport; const mode = D.transport[tu.mode] || D.transport[0];
    const tc = App.transportCost(); const isMtr = mode.rule === 'map';
    const mid = isMtr ? mtrMiddle(tu, tc) : `<label class="field-lbl">Minutes travelled</label>
      <div class="stepper"><button onclick="Team.bump(-1)">−</button>
        <input type="number" step="any" min="0" value="${esc(String(tu.minutes))}" onchange="Team.onField('minutes',this.value)" />
        <button onclick="Team.bump(1)">+</button></div>`;
    el.innerHTML = `<div class="tcalc">
      <label class="field-lbl">Mode of transport</label>
      <select class="tc-select" onchange="Team.onMode(this.value)">
        ${D.transport.map((m, i) => `<option value="${i}" ${i == tu.mode ? 'selected' : ''}>${esc(m.mode)} — ${esc(m.desc)}</option>`).join('')}
      </select>
      ${mid}
      <div class="tc-cost"><span>Cost</span><b>${App.fmtCoins(tc.cost)} 🪙</b></div>
      <button class="btn wide" onclick="App.chargeTransport()">Charge my team − ${App.fmtCoins(tc.cost)} 🪙</button>
    </div>
    ${isMtr ? `<datalist id="mtrStations">${MTR.STATIONS.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>` : ''}`;
  }
  function mtrMiddle(tu, tc) {
    const r = tc.mtr; const m = tu.mtrMode || 'cheapest';
    return `<label class="field-lbl">From station</label>
      <input class="tc-select" list="mtrStations" value="${esc(tu.mtrFrom || '')}" placeholder="e.g. Central" onchange="Team.onMtr('mtrFrom',this.value)" />
      <label class="field-lbl">To station</label>
      <input class="tc-select" list="mtrStations" value="${esc(tu.mtrTo || '')}" placeholder="e.g. Tsuen Wan" onchange="Team.onMtr('mtrTo',this.value)" />
      <div class="mtr-modes">
        <button class="seg ${m === 'cheapest' ? 'on' : ''}" onclick="Team.onMtrMode('cheapest')">Cheapest</button>
        <button class="seg ${m === 'fastest' ? 'on' : ''}" onclick="Team.onMtrMode('fastest')">Fastest</button>
      </div>
      ${r ? `<div class="mtr-result">
          ${r.legs.map(l => `<div class="mtr-leg"><span class="mtr-line">${esc(l.line)}</span><span style="flex:1">${esc(l.from)} → ${esc(l.to)}</span><span class="tiny">${l.time}m</span></div>`).join('')}
          <div class="tiny" style="margin-top:5px">${r.fareUnits} fare units × 3 · ⏱ ${r.timeMins} min · ${r.stops} stops</div>
        </div>` : `<div class="tiny" style="margin:6px 0">Pick two stations to compute the MTR fare.</div>`}`;
  }
  function onMode(v) { App.ui.transport.mode = Number(v); App.render(); }
  function onField(f, v) { App.ui.transport[f] = v; App.render(); }
  function bump(d) { const tu = App.ui.transport; tu.minutes = Math.max(0, App.round2((Number(tu.minutes) || 0) + d)); App.render(); }
  function onMtr(field, v) { App.ui.transport[field] = v.trim(); App.render(); }
  function onMtrMode(m) { App.ui.transport.mtrMode = m; App.render(); }

  /* shops */
  function setShop(s) { App.ui.shop = s; renderShops(); document.querySelectorAll('.shop-tab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().startsWith(s.slice(0, 4)))); }
  function renderShops() {
    const el = document.getElementById('shopBody'); if (!el) return;
    const me = C.me;
    if (App.ui.shop === 'powerup') {
      el.innerHTML = D.powerups.map(p => {
        const hasN = !!p.formula; const n = App.ui.powerN[p.id] || 1;
        const cost = hasN ? (p.formula[0] + p.formula[1] * n) : p.cost;
        return `<div class="shop-item"><div class="si-h"><div class="si-name">[${p.id}] ${esc(p.name)}</div><div class="si-cost">${esc(String(p.cost))}</div></div>
          ${hasN ? `<div class="si-eff">n = <input class="inline-n" type="number" min="1" value="${n}" onchange="Team.onPowerN('${p.id}',this.value)"/> → ${cost} 🪙</div>` : ''}
          <button class="si-buy" onclick="App.buyPowerup('${me}','${p.id}')">Buy${hasN ? '' : ' · ' + cost + ' 🪙'}</button></div>`;
      }).join('');
    } else {
      el.innerHTML = `<div class="tiny" style="margin-bottom:8px">${D.roadblockDiameterM} m · ${D.roadblockMin} min · opponents can't pass · next after ${D.roadblockCooldownMin} min. After buying, you'll drop it on the Game map.</div>` +
        D.roadblocks.map(r => `<div class="shop-item"><div class="si-h"><div class="si-name">${esc(r.name)}</div><div class="si-cost">${r.cost} 🪙</div></div>
          <button class="si-buy" onclick="App.buyRoadblock('${me}','${r.id}')">Buy & place</button></div>`).join('');
    }
  }
  function onPowerN(id, v) { App.ui.powerN[id] = Math.max(1, Number(v) || 1); renderShops(); }

  /* steal (Flop version): own a bordering district (land/sea) + complete the target's HARD challenge */
  function renderSteal() {
    const el = document.getElementById('stealPanel'); if (!el) return;
    const me = C.me; const claims = C.claims || {};
    const oppo = Object.keys(claims).filter(d => claims[d].team !== me);
    let html = `<div class="tiny" style="margin-bottom:8px">Own a district bordering the target (land/sea) <b>and</b> complete its <span style="color:#f5b021">HARD</span> challenge. No coin cost. Stolen districts become permanent 🔒.</div>`;
    if (!oppo.length) { el.innerHTML = html + `<div class="empty">No opponent districts yet.</div>`; return; }
    const rows = oppo.map(d => ({ d, info: App.stealInfo(d, me), claim: claims[d] }));
    const eligible = rows.filter(r => r.info.ok);
    const need = rows.filter(r => !r.info.ok && !r.claim.locked);
    const locked = rows.filter(r => r.claim.locked);
    if (eligible.length) {
      html += `<div class="steal-step">⚔️ You can steal:</div>`;
      eligible.forEach(r => {
        const hard = r.info.hard;
        html += `<div class="steal-cost"><b style="color:#fff">${esc(Scoring.nameById[r.d])}</b> <span class="tiny">held by ${esc((C.teams[r.claim.team] || {}).name || '')}</span>`;
        html += hard ? `<div class="dc-text" style="margin:5px 0">🟧 <b>${esc(hard.name)}</b>: ${esc(hard.text || '—')}</div>
          <button class="btn good wide" onclick="App.completeChallenge('${hard.id}')">Complete hard challenge → steal</button>`
          : `<div class="tiny" style="margin-top:4px">No hard challenge defined for this district yet (add one in Build).</div>`;
        html += `</div>`;
      });
    }
    if (need.length) html += `<div class="steal-step" style="margin-top:10px">Get a bordering district first:</div>` + need.map(r => `<div class="tiny" style="padding:2px 0">• ${esc(Scoring.nameById[r.d])}</div>`).join('');
    if (locked.length) html += `<div class="steal-step" style="margin-top:10px">🔒 Locked (safe):</div>` + locked.map(r => `<div class="tiny" style="padding:2px 0">• ${esc(Scoring.nameById[r.d])}</div>`).join('');
    el.innerHTML = html;
  }

  return { init, render, tick, onMode, onField, bump, onMtr, onMtrMode, setShop, onPowerN };
})();
