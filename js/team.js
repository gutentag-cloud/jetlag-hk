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
  function tick(ctx) { C = ctx || C; /* nothing time-based here */ }

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
          <div class="coin-big ${coins < 0 ? 'neg' : ''}">🪙 ${coins}</div>
          <div class="coin-ctrl">
            <button onclick="App.adjustCoins('${me}',-50,'manual')">−50</button>
            <input type="number" value="${coins}" onchange="App.setCoins('${me}',this.value)" />
            <button onclick="App.adjustCoins('${me}',50,'manual')">+50</button>
          </div>
        </div>
        <div class="team-stats">🗺 ${s.count} districts · 🏆 ${App.fmtArea(s.bestArea)} km² connected · ${App.fmtArea(s.totalArea)} km² total</div>
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
            <span class="dcolor" style="background:${esc(t.color)}"></span><span style="flex:1">${esc(Scoring.nameById[d])}</span>
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

  /* transport */
  function renderTransport() {
    const el = document.getElementById('tcalc'); if (!el) return;
    const tu = App.ui.transport; const mode = D.transport[tu.mode] || D.transport[0];
    const { cost, label } = App.transportCost(); const isMtr = mode.rule === 'map';
    el.innerHTML = `<div class="tcalc-row">
        <select onchange="Team.onMode(this.value)">
          ${D.transport.map((m, i) => `<option value="${i}" ${i == tu.mode ? 'selected' : ''}>${esc(m.mode)} — ${esc(m.desc)}</option>`).join('')}
        </select>
        ${isMtr ? `<div><span class="field-lbl">Map #</span><input type="number" value="${esc(tu.mtr)}" onchange="Team.onField('mtr',this.value)" /></div>`
                : `<div><span class="field-lbl">Minutes</span><input type="number" value="${esc(tu.minutes)}" onchange="Team.onField('minutes',this.value)" /></div>`}
      </div>
      <div class="tcalc-out"><span>${esc(label)} cost</span><b>${cost} 🪙</b></div>
      <button class="btn wide" onclick="App.chargeTransport()">Charge my team −${cost}</button>`;
  }
  function onMode(v) { App.ui.transport.mode = Number(v); App.render(); }
  function onField(f, v) { App.ui.transport[f] = v; App.render(); }

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

  /* steal */
  function renderSteal() {
    const el = document.getElementById('stealPanel'); if (!el) return;
    const me = C.me; const claims = C.claims || {};
    const targets = Object.keys(claims).filter(d => claims[d].team !== me);
    const sel = App.ui.stealTarget && targets.includes(App.ui.stealTarget) ? App.ui.stealTarget : (targets[0] || '');
    App.ui.stealTarget = sel;
    let html = '';
    if (!targets.length) html += `<div class="empty">No opponent districts to steal yet.</div>`;
    else {
      const info = App.stealInfo(sel, me);
      html += `<div class="steal-row"><select onchange="Team.onStealTarget(this.value)">
        ${targets.map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${esc(Scoring.nameById[d])} (${esc((C.teams[claims[d].team] || {}).name || '')})</option>`).join('')}</select></div>`;
      if (info.ok) html += `<div class="steal-cost">Bordering districts you own: <b style="color:#fff">${info.borders.length}</b> → <b>${info.cost} 🪙</b><br><span class="tiny">${esc(info.borders.map(b => Scoring.nameById[b]).join(', '))}</span></div>
        <button class="btn wide" ${App.canAfford(me, info.cost) ? '' : 'disabled'} onclick="App.startSteal('${sel}','${me}')">Pay ${info.cost} & start steal</button>`;
      else html += `<div class="steal-cost" style="color:#9aa7b4">${esc(info.reason || 'Cannot steal this one.')}</div>`;
    }
    // active steals involving me (as raider or defender)
    const steals = C.steals || {};
    const mine = Object.keys(steals).filter(d => steals[d].by === me || (claims[d] && claims[d].team === me));
    if (mine.length) {
      html += `<div class="steal-step" style="margin-top:12px">⚔️ In progress:</div>`;
      mine.forEach(d => {
        const st = steals[d]; const raiding = st.by === me;
        const chs = C.challenges.filter(c => c.districtId === d && (!claims[d] || claims[d].via !== c.id));
        html += `<div class="steal-cost"><b style="color:#fff">${esc((C.teams[st.by] || {}).name)}</b> → <b style="color:#fff">${esc(Scoring.nameById[d])}</b><br>`;
        if (raiding) html += `<div class="steal-row" style="margin-top:6px"><select id="sd-${d}"><option value="">— complete via a different location —</option>${chs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <button class="btn good wide" onclick="App.completeSteal('${d}', document.getElementById('sd-${d}').value)">Complete steal</button>`;
        else html += `<div class="tiny" style="margin:4px 0">An opponent is stealing this from you.</div><button class="btn wide" onclick="App.cancelSteal('${d}', true)">Defend & lock</button>`;
        html += `</div>`;
      });
    }
    el.innerHTML = html;
  }
  function onStealTarget(v) { App.ui.stealTarget = v; renderSteal(); }

  return { init, render, tick, onMode, onField, setShop, onPowerN, onStealTarget };
})();
