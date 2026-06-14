/* ============================================================
   Game — the shared tab everyone sees:
   map, leaderboard, the PUBLIC deck of challenge cards,
   active roadblocks, and the activity log.
   ============================================================ */
const Game = (function () {
  const D = window.JETLAG_DATA;
  const esc = s => App.esc(s);
  let C = {};

  function init() {
    // deck tools are rendered dynamically
  }

  function render(ctx) {
    C = ctx;
    renderActingBar();
    renderLeaderboard();
    renderEffects();
    renderDeck();
    renderLog();
  }
  function tick(ctx) { C = ctx || C; renderEffects(); }

  /* who am I claiming as + border legend */
  function renderActingBar() {
    const row = document.getElementById('actingRow');
    let html = '';
    const me = C.me;
    if (C.role === 'spectator') {
      html += `<div class="team-pick"><span class="lbl">👁 Spectating</span><button class="team-chip" onclick="App.openLoginModal()">Log in to play</button></div>`;
    } else {
      const t = C.teams[me] || {};
      const lbl = C.isHost ? 'Host · acting as' : 'You are';
      html += `<div class="team-pick"><span class="lbl">${lbl}</span><span class="team-chip"><span class="dot" style="background:${esc(t.color || '#fbbf24')}"></span>${esc((t.name) || (C.isHost ? '—' : 'Team'))}</span>`;
      if (C.isHost) {
        const teams = Object.values(C.teams || {});
        html += `<select class="host-acting" onchange="App.setHostActing(this.value)">${teams.map(x => `<option value="${x.id}" ${x.id === me ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option>no teams</option>'}</select>`;
      }
      html += `</div>`;
    }
    if (C.showBordersFor) {
      html += `<div class="map-hint border-legend">Borders of <b>${esc(Scoring.nameById[C.showBordersFor])}</b> — <span style="color:#22c55e">🟢 land</span> · <span style="color:#22d3ee">🩵 sea</span> <button class="link-btn" onclick="App.clearBorders()">clear</button></div>`;
    }
    row.innerHTML = html;
  }

  function renderLeaderboard() {
    const el = document.getElementById('leaderboard');
    const teams = Object.values(C.teams || {});
    if (!teams.length) { el.innerHTML = `<div class="empty">No teams yet. Log in (top-right) to create one.</div>`; return; }
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

  function renderEffects() {
    const el = document.getElementById('effectsPanel');
    const eff = C.effects || {}; const ids = Object.keys(eff);
    document.getElementById('effCount').textContent = ids.length ? ids.length + ' active' : '';
    if (!ids.length) { el.innerHTML = `<div class="empty">No active roadblocks.</div>`; return; }
    el.innerHTML = ids.sort((a, b) => eff[a].startedAt - eff[b].startedAt).map(id => {
      const e = eff[id]; const team = C.teams[e.by] || {}; const rem = App.effectRemaining(e);
      const cls = rem === 'expired' ? 'expired' : (/^[01]:/.test(rem) ? 'soon' : '');
      const canRemove = C.isHost || C.me === e.by;
      return `<div class="eff"><div class="eff-ico">${e.kind || '⛔'}</div>
        <div class="eff-main"><div class="eff-name">${esc(e.name)}</div>
          <div class="eff-sub"><span style="color:${esc(team.color || '#888')}">●</span> ${esc(team.name || '')}</div></div>
        <div style="text-align:right"><div class="eff-time ${cls}">${rem}</div>
          ${canRemove ? `<button class="x-btn" onclick="App.removeEffect('${id}')">remove</button>` : ''}</div></div>`;
    }).join('');
  }

  /* PUBLIC DECK — every challenge card, grouped by district, read-only */
  function renderDeck() {
    const tools = document.getElementById('deckTools');
    const q = (App.ui.deckSearch || '').toLowerCase();
    const fd = App.ui.deckDistrict || '';
    tools.innerHTML = `<div class="deck-tools">
      <input class="search" placeholder="Search the deck…" value="${esc(App.ui.deckSearch || '')}" oninput="Game.onDeckSearch(this.value)" />
      <select class="chip-select" onchange="Game.onDeckDistrict(this.value)">
        <option value="">All districts</option>
        ${Scoring.allIds.map(id => `<option value="${id}" ${id === fd ? 'selected' : ''}>${esc(Scoring.nameById[id])}</option>`).join('')}
      </select></div>`;

    let list = (C.challenges || []).slice();
    if (fd) list = list.filter(c => c.districtId === fd);
    if (q) list = list.filter(c => (c.name + ' ' + (c.text || '')).toLowerCase().includes(q));
    document.getElementById('deckCount').textContent = list.length + ' cards';

    // group by district
    const byD = {};
    list.forEach(c => (byD[c.districtId] = byD[c.districtId] || []).push(c));
    const order = Scoring.allIds.filter(id => byD[id]);
    const el = document.getElementById('publicDeck');
    if (!order.length) { el.innerHTML = `<div class="empty">No cards match.</div>`; return; }
    el.innerHTML = order.map(did => {
      const claim = (C.claims || {})[did];
      const owner = claim ? (C.teams[claim.team] || {}) : null;
      return `<div class="deck-group">
        <div class="deck-group-h" onclick="App.openDistrictInfo('${did}')">
          <span class="dcolor" style="background:${owner ? esc(owner.color) : '#3a4252'}"></span>
          <b>${esc(Scoring.nameById[did])}</b>
          <span class="tiny">${owner ? esc(owner.name) : 'unclaimed'} · ${App.fmtArea(Scoring.areaById[did])} km²</span></div>
        ${byD[did].map(c => {
          const done = (C.challengeDone || {})[c.id]; const dt = done ? (C.teams[done] || {}) : null;
          return `<div class="deck-card ${done ? 'done' : ''}">
            <div class="dc-top">${c.lat != null ? '📍 ' : ''}<b>${esc(c.name)}</b>${dt ? `<span class="dc-done" style="background:${esc(dt.color || '#22c55e')}">✓ ${esc(dt.name)}</span>` : ''}</div>
            <div class="dc-text">${esc(c.text || 'No challenge text yet.')}</div></div>`;
        }).join('')}
      </div>`;
    }).join('');
  }
  function onDeckSearch(v) { App.ui.deckSearch = v; renderDeck(); const s = document.querySelector('#deckTools .search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  function onDeckDistrict(v) { App.ui.deckDistrict = v; renderDeck(); }

  function renderLog() {
    const el = document.getElementById('logPanel');
    const log = C.log || {};
    const rows = Object.keys(log).map(k => log[k]).sort((a, b) => b.t - a.t).slice(0, 60);
    if (!rows.length) { el.innerHTML = `<div class="empty">No activity yet.</div>`; return; }
    el.innerHTML = rows.map(r => {
      const d = new Date(r.t);
      return `<div class="log-row"><span class="lt">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span><span>${esc(r.msg)}</span></div>`;
    }).join('');
  }

  return { init, render, tick, onDeckSearch, onDeckDistrict };
})();
