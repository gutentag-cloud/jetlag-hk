/* ============================================================
   Play — the live game-day companion (side panel + map chips).
   Reads the derived ctx; all mutations go through App.* actions.
   ============================================================ */
const Play = (function () {
  const D = window.JETLAG_DATA;
  const esc = (s) => App.esc(s);
  let C = {};

  function init() {
    document.getElementById('addTeamBtn').onclick = () => App.addTeam();
    document.getElementById('clearLogBtn').onclick = () => {
      if (confirm('Clear the activity log?')) Sync.remove('log');
    };
    document.querySelectorAll('.shop-tab').forEach(b => b.onclick = () => {
      App.ui.shop = b.dataset.shop;
      document.querySelectorAll('.shop-tab').forEach(x => x.classList.toggle('active', x === b));
      renderShops();
    });
  }

  function render(ctx) {
    C = ctx;
    renderChips();
    renderLeaderboard();
    renderTeams();
    renderTransport();
    renderShops();
    renderEffects();
    renderSteal();
    renderLog();
  }

  function tick(ctx) { C = ctx || C; renderEffects(); }   // 1s timer refresh

  /* ---- team picker chips over the map ---- */
  function renderChips() {
    const row = document.getElementById('claimAsRow');
    const teams = Object.values(C.teams || {});
    if (!teams.length) {
      row.innerHTML = `<div class="team-pick"><span class="lbl">No teams yet</span>
        <button class="team-chip" onclick="App.addTeam()">+ Add a team</button></div>`;
      return;
    }
    let html = `<div class="team-pick"><span class="lbl">Claim as:</span>`;
    teams.forEach(t => {
      const sel = t.id === C.selectedTeam ? 'sel' : '';
      html += `<button class="team-chip ${sel}" onclick="App.selectTeam('${t.id}')">
        <span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</button>`;
    });
    html += `</div>`;
    row.innerHTML = html;
  }

  /* ---- leaderboard ---- */
  function renderLeaderboard() {
    const el = document.getElementById('leaderboard');
    const teams = Object.values(C.teams || {});
    if (!teams.length) { el.innerHTML = `<div class="empty">Add teams to start scoring.</div>`; return; }
    const rows = teams.map(t => ({ t, s: C.scores[t.id] || { bestArea: 0, totalArea: 0, count: 0, bestComponent: [] } }))
      .sort((a, b) => b.s.bestArea - a.s.bestArea);
    const max = Math.max(1, rows[0].s.bestArea);
    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = rows.map((r, i) => `
      <div class="lb-row">
        <div class="lb-rank">${medals[i] || (i + 1)}</div>
        <div class="lb-dot" style="background:${esc(r.t.color)}"></div>
        <div style="flex:1;min-width:0">
          <div class="lb-name">${esc(r.t.name)}</div>
          <div class="lb-sub">${r.s.bestComponent.length} connected · ${r.s.count} claimed · ${App.fmtArea(r.s.totalArea)} km² total</div>
          <div class="lb-bar"><i style="width:${(r.s.bestArea / max * 100).toFixed(0)}%;background:${esc(r.t.color)}"></i></div>
        </div>
        <div class="lb-area">${App.fmtArea(r.s.bestArea)}<small> km²</small></div>
      </div>`).join('');
  }

  /* ---- teams & coins ---- */
  function renderTeams() {
    const el = document.getElementById('teamsPanel');
    const teams = Object.values(C.teams || {});
    if (!teams.length) { el.innerHTML = `<div class="empty">No teams. Tap “+ Team”.</div>`; return; }
    el.innerHTML = teams.map(t => {
      const coins = (C.coins || {})[t.id] || 0;
      const s = C.scores[t.id] || { count: 0 };
      return `<div class="team-card">
        <input type="color" class="team-color" value="${esc(t.color)}" title="team colour"
               onchange="App.setTeamColor('${t.id}', this.value)" />
        <div style="flex:1;min-width:0">
          <input class="team-name" value="${esc(t.name)}" onchange="App.renameTeam('${t.id}', this.value)" />
          <div class="team-meta">${s.count} districts</div>
        </div>
        <div class="coin-ctrl">
          <button onclick="App.adjustCoins('${t.id}',-50,'manual')">−</button>
          <input type="number" value="${coins}" onchange="App.setCoins('${t.id}', this.value)" />
          <button onclick="App.adjustCoins('${t.id}',50,'manual')">+</button>
        </div>
        <button class="x-btn" title="remove team" onclick="if(confirm('Remove ${esc(t.name)}?'))App.removeTeam('${t.id}')">✕</button>
      </div>`;
    }).join('');
  }

  /* ---- transport calculator ---- */
  function renderTransport() {
    const el = document.getElementById('transportCalc');
    const tu = App.ui.transport;
    const mode = D.transport[tu.mode] || D.transport[0];
    const { cost, label } = App.transportCost();
    const isMtr = mode.rule === 'map';
    el.innerHTML = `
      <div class="tcalc-row">
        <select onchange="Play.onMode(this.value)">
          ${D.transport.map((m, i) => `<option value="${i}" ${i == tu.mode ? 'selected' : ''}>${esc(m.mode)} — ${esc(m.desc)}</option>`).join('')}
        </select>
        ${isMtr
          ? `<div><span class="field-lbl">Map #</span><input type="number" value="${esc(tu.mtr)}" onchange="Play.onField('mtr',this.value)" /></div>`
          : `<div><span class="field-lbl">Minutes</span><input type="number" value="${esc(tu.minutes)}" onchange="Play.onField('minutes',this.value)" /></div>`}
      </div>
      <div class="tcalc-out"><span>${esc(label)} cost</span><b>${cost} 🪙</b></div>
      <button class="btn wide" onclick="App.chargeTransport()">Charge ${esc((C.teams[C.selectedTeam] || {}).name || 'selected team')}</button>`;
  }
  function onMode(v) { App.ui.transport.mode = Number(v); App.render(); }
  function onField(f, v) { App.ui.transport[f] = v; App.render(); }

  /* ---- shops ---- */
  function renderShops() {
    const el = document.getElementById('shopBody');
    const shop = App.ui.shop;
    const team = C.selectedTeam;
    const tn = (C.teams[team] || {}).name;
    const noTeam = !team;
    const head = noTeam ? `<div class="empty">Select a team (chips over the map) to buy.</div>` : '';
    if (shop === 'powerup') {
      el.innerHTML = head + D.powerups.map(p => {
        const hasN = !!p.formula;
        const n = App.ui.powerN[p.id] || 1;
        const cost = hasN ? (p.formula[0] + p.formula[1] * n) : p.cost;
        return `<div class="shop-item">
          <div class="si-h"><div class="si-name">[${p.id}] ${esc(p.name)}</div><div class="si-cost">${esc(String(p.cost))}</div></div>
          ${hasN ? `<div class="si-eff">n = <input class="inline-n" type="number" min="1" value="${n}" onchange="Play.onPowerN('${p.id}',this.value)"/> → ${cost} 🪙</div>` : ''}
          <button class="si-buy" ${noTeam ? 'disabled' : ''} onclick="App.buyPowerup('${team}','${p.id}')">Buy${hasN ? '' : ' · ' + cost + ' 🪙'}</button>
        </div>`;
      }).join('');
    } else if (shop === 'tower') {
      el.innerHTML = head + `<button class="si-buy" ${noTeam ? 'disabled' : ''} style="margin-bottom:10px"
          onclick="App.drawTower('${team}')">🎲 Draw a random Tower — ${D.towerCost} 🪙</button>` +
        `<div class="tiny" style="margin-bottom:8px">Lasts ${D.towerMaxMin} min · drop at your location · next tower after ${D.towerCooldownMin} min. Then tap the map.</div>` +
        D.towers.map(t => `<div class="shop-item"><div class="si-h"><div class="si-name">[${t.id}] ${esc(t.name)}</div><div class="si-cost">r ${t.radiusKm} km</div></div><div class="si-eff">${esc(t.effect)}</div></div>`).join('');
    } else {
      el.innerHTML = head + `<div class="tiny" style="margin-bottom:8px">Diameter ${D.roadblockDiameterM} m · lasts ${D.roadblockMin} min · opponents can't pass · next after ${D.roadblockCooldownMin} min. Then tap the map.</div>` +
        D.roadblocks.map(r => `<div class="shop-item"><div class="si-h"><div class="si-name">${esc(r.name)}</div><div class="si-cost">${r.cost} 🪙</div></div>
          <button class="si-buy" ${noTeam ? 'disabled' : ''} onclick="App.buyRoadblock('${team}','${r.id}')">Buy & place</button></div>`).join('');
    }
  }
  function onPowerN(id, v) { App.ui.powerN[id] = Math.max(1, Number(v) || 1); renderShops(); }

  /* ---- active effects / timers ---- */
  function renderEffects() {
    const el = document.getElementById('effectsPanel');
    const eff = C.effects || {};
    const ids = Object.keys(eff);
    document.getElementById('effCount').textContent = ids.length ? ids.length + ' active' : '';
    if (!ids.length) { el.innerHTML = `<div class="empty">No active towers, roadblocks or timers.</div>`; return; }
    el.innerHTML = ids.sort((a, b) => eff[a].startedAt - eff[b].startedAt).map(id => {
      const e = eff[id];
      const team = C.teams[e.by] || {};
      const rem = App.effectRemaining(e);
      const cls = rem === 'expired' ? 'expired' : (rem.startsWith('0:') || rem.startsWith('1:') ? 'soon' : '');
      return `<div class="eff">
        <div class="eff-ico">${e.kind || '🗼'}</div>
        <div class="eff-main"><div class="eff-name">${esc(e.name)}</div>
          <div class="eff-sub"><span style="color:${esc(team.color || '#888')}">●</span> ${esc(team.name || '')} · r ${e.radiusKm} km</div></div>
        <div style="text-align:right">
          <div class="eff-time ${cls}">${rem}</div>
          <button class="x-btn" onclick="App.removeEffect('${id}')">remove</button>
        </div>
      </div>`;
    }).join('');
  }

  /* ---- steal ---- */
  function renderSteal() {
    const el = document.getElementById('stealPanel');
    const teams = Object.values(C.teams || {});
    if (teams.length < 2) { el.innerHTML = `<div class="empty">Need at least 2 teams to steal.</div>`; return; }
    const team = C.selectedTeam;
    const claims = C.claims || {};
    const targets = Object.keys(claims).filter(d => claims[d].team !== team);
    const sel = App.ui.stealTarget && targets.includes(App.ui.stealTarget) ? App.ui.stealTarget : (targets[0] || '');
    App.ui.stealTarget = sel;

    let html = `<div class="steal-step">Initiate as <b>${esc((C.teams[team] || {}).name || '—')}</b>:</div>`;
    if (!targets.length) html += `<div class="empty">No opponent-held districts to steal.</div>`;
    else {
      const info = App.stealInfo(sel, team);
      html += `<div class="steal-row">
        <select onchange="Play.onStealTarget(this.value)">
          ${targets.map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${esc(Scoring.nameById[d])} (${esc((C.teams[claims[d].team] || {}).name || '')})</option>`).join('')}
        </select></div>`;
      if (info.ok) {
        html += `<div class="steal-cost">Borders you own: <b style="color:#fff">${info.borders.length}</b> → initiation <b>${info.cost} 🪙</b><br>
          <span class="tiny">${esc(info.borders.map(b => Scoring.nameById[b]).join(', '))}</span></div>
          <button class="btn wide" ${App.canAfford(team, info.cost) ? '' : 'disabled'} onclick="App.startSteal('${sel}','${team}')">Pay ${info.cost} & start steal</button>`;
      } else {
        html += `<div class="steal-cost" style="color:#9aa7b4">${esc(info.reason || 'Cannot steal this one.')}</div>`;
      }
    }

    // active steals
    const steals = C.steals || {};
    const sids = Object.keys(steals);
    if (sids.length) {
      html += `<div class="steal-step" style="margin-top:12px">⚔️ In progress:</div>`;
      sids.forEach(d => {
        const st = steals[d];
        const byName = (C.teams[st.by] || {}).name || '';
        const chs = C.challenges.filter(c => c.districtId === d && (!claims[d] || claims[d].via !== c.id));
        html += `<div class="steal-cost">
          <b style="color:#fff">${esc(byName)}</b> stealing <b style="color:#fff">${esc(Scoring.nameById[d])}</b><br>
          <div class="steal-row" style="margin-top:6px">
            <select id="stealdone-${d}">
              <option value="">— complete via a different location —</option>
              ${chs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select></div>
          <div class="row-btns">
            <button class="btn good" onclick="App.completeSteal('${d}', document.getElementById('stealdone-${d}').value)">Complete steal</button>
            <button class="btn ghost" onclick="App.cancelSteal('${d}', true)">Defender locks</button>
          </div></div>`;
      });
    }
    el.innerHTML = html;
  }
  function onStealTarget(v) { App.ui.stealTarget = v; renderSteal(); }

  /* ---- log ---- */
  function renderLog() {
    const el = document.getElementById('logPanel');
    const log = C.log || {};
    const rows = Object.keys(log).map(k => log[k]).sort((a, b) => b.t - a.t).slice(0, 60);
    if (!rows.length) { el.innerHTML = `<div class="empty">No activity yet.</div>`; return; }
    el.innerHTML = rows.map(r => {
      const d = new Date(r.t);
      const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
      return `<div class="log-row"><span class="lt">${hh}:${mm}</span><span>${esc(r.msg)}</span></div>`;
    }).join('');
  }

  return { init, render, tick, onMode, onField, onPowerN, onStealTarget };
})();
