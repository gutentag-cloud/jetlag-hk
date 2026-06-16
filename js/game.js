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
    renderFlop();
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
    const rows = teams.map(t => ({ t, s: C.scores[t.id] || { count: 0, totalArea: 0, claimedCount: 0 } }))
      .sort((a, b) => b.s.count - a.s.count || b.s.totalArea - a.s.totalArea);   // largest connected group; tiebreak its area
    const max = Math.max(1, rows[0].s.count);
    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = rows.map((r, i) => `
      <div class="lb-row">
        <div class="lb-rank">${medals[i] || (i + 1)}</div>
        <div class="lb-dot" style="background:${esc(r.t.color)}"></div>
        <div style="flex:1;min-width:0">
          <div class="lb-name">${esc(r.t.name)}</div>
          <div class="lb-sub">${App.fmtArea(r.s.totalArea)} km² connected · ${r.s.claimedCount || 0} claimed total</div>
          <div class="lb-bar"><i style="width:${(r.s.count / max * 100).toFixed(0)}%;background:${esc(r.t.color)}"></i></div>
        </div>
        <div class="lb-area">${r.s.count}<small> connected</small></div>
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

  /* THE FLOP — at most flopSize NORMAL cards, each from a different district */
  function renderFlop() {
    const tools = document.getElementById('deckTools');
    const el = document.getElementById('publicDeck');
    const flop = App.flopList();
    const round = C.flopRound; const me = C.me;
    document.getElementById('deckCount').textContent = flop.length + ' / ' + (D.flopSize || 6);

    let ctrl = '';
    if (C.isHost) {
      const full = flop.length >= (D.flopSize || 6);
      ctrl += `<button class="dc-btn" style="background:var(--accent2)" ${full ? 'disabled' : ''} onclick="App.dealFlop()">${flop.length ? (full ? '✓ Flop full' : '➕ Refill empty slots') : '🎲 Deal The Flop'}</button>`;
      if (flop.length) ctrl += `<div style="margin:4px 0 6px"><button class="link-btn" onclick="if(confirm('Discard all current cards and deal a fresh Flop?'))App.redealFlop()">↻ re-deal all from scratch</button></div>`;
    }
    if (round) {
      const byName = (C.teams[round.by] || {}).name || 'A team';
      ctrl += round.by === me
        ? `<div class="flop-round">🔄 Your move — tap <b>Swap</b> on one card, or <button class="link-btn" onclick="App.endFlopRound()">skip</button>.</div>`
        : `<div class="flop-round">${esc(byName)} may swap a card. Tap <b>🛡 Protect</b> to shield one.</div>`;
    }
    tools.innerHTML = ctrl;

    if (!flop.length) { el.innerHTML = `<div class="empty">${C.isHost ? 'Tap “Deal The Flop” to start.' : 'Waiting for the host to deal The Flop.'}</div>`; return; }
    const protCount = Object.keys(C.flopProtect || {}).length;
    el.innerHTML = flop.map(c => {
      const prot = (C.flopProtect || {})[c.id];
      const canComplete = me && c.districtId;
      const isOwner = round && round.by === me;
      const canProtect = round && me && round.by !== me && !Object.values(C.flopProtect || {}).includes(me);
      return `<div class="deck-card ${prot ? 'protected' : ''}">
        <div class="dc-top">${c.lat != null ? '📍 ' : ''}<b>${esc(c.name)}</b>${prot ? ` <span class="tiny">🛡 ${esc((C.teams[prot] || {}).name || '')}</span>` : ''}</div>
        <div class="dc-sub">📌 ${esc(Scoring.nameById[c.districtId])} · ${App.fmtArea(Scoring.areaById[c.districtId])} km²</div>
        <div class="dc-text">${esc(c.text || 'No challenge text yet — add it in Build.')}</div>
        <div class="flop-acts">
          ${canComplete ? `<button class="dc-btn" onclick="App.completeChallenge('${c.id}')">Complete → claim</button>` : ''}
          ${isOwner && !prot ? `<button class="dc-btn alt" onclick="App.swapFlopCard('${c.id}')">🔄 Swap</button>` : ''}
          ${canProtect ? `<button class="dc-btn alt" onclick="App.protectFlopCard('${c.id}')">🛡 Protect</button>` : ''}
        </div></div>`;
    }).join('');
  }

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

  return { init, render, tick };
})();
