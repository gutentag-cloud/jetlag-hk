/* ============================================================
   Build — the design / reference half of the app.
   Edit the challenge deck, inspect districts, tune borders
   (incl. sea-crossings), read the rules, export / import data.
   ============================================================ */
const Build = (function () {
  const D = window.JETLAG_DATA;
  const esc = (s) => App.esc(s);
  let C = {};

  function init() {
    document.querySelectorAll('.bnav').forEach(b => b.onclick = () => {
      App.ui.buildView = b.dataset.bview;
      document.querySelectorAll('.bnav').forEach(x => x.classList.toggle('active', x === b));
      render(C);
    });
  }

  function districtOptions(sel) {
    return Scoring.allIds.map(id =>
      `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(Scoring.nameById[id])}</option>`).join('');
  }

  function render(ctx) {
    C = ctx || C;
    const v = App.ui.buildView;
    const body = document.getElementById('buildBody');
    const banner = C.isHost ? '' :
      `<div class="host-banner warn">🔒 Viewing as <b>${esc(Auth.label())}</b>. Editing the deck / borders is Host-only — <button class="link-btn" onclick="App.openLoginModal()">log in as Host</button>.</div>`;
    let html = '';
    if (v === 'challenges') html = renderChallenges();
    else if (v === 'districts') html = renderDistricts();
    else if (v === 'borders') html = renderBorders();
    else if (v === 'rules') html = renderRules();
    else if (v === 'data') html = renderData();
    body.innerHTML = banner + html;
    if (v === 'data') wireData();
  }

  /* ---------- challenge deck ---------- */
  function renderChallenges() {
    const q = (App.ui.search || '').toLowerCase();
    const fd = App.ui.filterDistrict || '';
    let list = (C.challenges || []).slice();
    if (fd) list = list.filter(c => c.districtId === fd);
    if (q) list = list.filter(c => (c.name + ' ' + (c.text || '')).toLowerCase().includes(q));
    list.sort((a, b) => (Scoring.nameById[a.districtId] || '').localeCompare(Scoring.nameById[b.districtId] || '') || a.name.localeCompare(b.name));

    const total = (C.challenges || []).length;
    const filled = (C.challenges || []).filter(c => (c.text || '').trim()).length;
    const head = `
      <h2>Challenge Deck</h2>
      <p class="sub">Each card = one challenge for one district. ${total} cards · ${filled} written · ${total - filled} to fill.
        Edits sync live to every device. <b>${esc((C.teams && Object.keys(C.teams).length) ? '' : '')}</b></p>
      <div class="toolbar">
        <input class="search" placeholder="Search challenges…" value="${esc(App.ui.search || '')}"
               oninput="Build.onSearch(this.value)" />
        <select class="chip-select" onchange="Build.onFilter(this.value)">
          <option value="">All districts</option>
          ${Scoring.allIds.map(id => `<option value="${id}" ${id === fd ? 'selected' : ''}>${esc(Scoring.nameById[id])}</option>`).join('')}
        </select>
        <button class="mini-btn" style="margin:0" onclick="App.addChallenge('${fd}')">+ Add card</button>
      </div>`;

    if (!list.length) return head + `<div class="empty">No cards match.</div>`;
    const cards = list.map(c => {
      const onMap = c.lat != null && c.lon != null;
      const done = (C.challengeDone || {})[c.id];
      const special = c.type === 'rare' || c.type === 'wildcard';
      return `<div class="ch-card ${done ? 'done' : ''} ${c.type === 'hard' ? 'hard' : ''}">
        <div class="ch-top">
          <input class="ch-name" style="flex:1;background:transparent;border:none;color:#fff;font-weight:600;font-size:14px"
                 value="${esc(c.name)}" onchange="App.editChallenge('${c.id}','name',this.value)" />
          <span class="ch-badge ${onMap ? 'map' : ''}">${onMap ? '📍 map' : (c.source || 'card')}</span>
        </div>
        <div class="ch-district">
          ${special ? `🏷 <b style="text-transform:capitalize">${esc(c.type)}</b>` :
            `🏷 <select onchange="App.editChallenge('${c.id}','type',this.value)">
              <option value="normal" ${c.type !== 'hard' ? 'selected' : ''}>Normal</option>
              <option value="hard" ${c.type === 'hard' ? 'selected' : ''}>Hard 🟧</option>
            </select>`}
          &nbsp;📌
          <select onchange="App.editChallenge('${c.id}','districtId',this.value)">${districtOptions(c.districtId)}</select>
        </div>
        <textarea class="ch-text" placeholder="Describe the challenge…"
                  onchange="App.editChallenge('${c.id}','text',this.value)">${esc(c.text || '')}</textarea>
        <div class="ch-acts">
          <label class="tiny"><input type="checkbox" ${done ? 'checked' : ''} onchange="App.toggleChallengeDone('${c.id}')"/> done</label>
          <span class="spacer"></span>
          ${onMap ? `<button class="btn ghost" style="padding:5px 9px" onclick="App.openDistrictInfo('${c.districtId}')">show</button>` : ''}
          <button class="btn bad" style="padding:5px 9px" onclick="if(confirm('Delete this card?'))App.deleteChallenge('${c.id}')">✕</button>
        </div>
      </div>`;
    }).join('');
    return head + `<div class="cgrid">${cards}</div>`;
  }
  function onSearch(v) { App.ui.search = v; const b = document.getElementById('buildBody'); /* re-render grid only */ render(C); restoreSearchFocus(); }
  function restoreSearchFocus() { const s = document.querySelector('.search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  function onFilter(v) { App.ui.filterDistrict = v; render(C); }

  /* ---------- districts ---------- */
  function renderDistricts() {
    const rows = Scoring.allIds.map(id => {
      const claim = (C.claims || {})[id];
      const owner = claim ? (C.teams[claim.team] || {}) : null;
      const nCh = (C.challenges || []).filter(c => c.districtId === id).length;
      const nb = (C.graph[id] ? C.graph[id].size : 0);
      return { id, name: Scoring.nameById[id], area: Scoring.areaById[id], nCh, nb, owner };
    }).sort((a, b) => b.area - a.area);
    const totalArea = rows.reduce((s, r) => s + r.area, 0);
    return `
      <h2>Districts</h2>
      <p class="sub">${rows.length} districts · ${App.fmtArea(totalArea)} km² total playable area (from your map).</p>
      <table class="dtable">
        <tr><th>District</th><th class="num">Area km²</th><th class="num">Cards</th><th class="num">Borders</th><th>Owner</th></tr>
        ${rows.map(r => `<tr>
          <td><span class="dcolor" style="background:${r.owner ? esc(r.owner.color) : '#3a4252'}"></span>${esc(r.name)}</td>
          <td class="num">${App.fmtArea(r.area)}</td>
          <td class="num">${r.nCh}</td>
          <td class="num">${r.nb}</td>
          <td>${r.owner ? esc(r.owner.name) : '<span class="tiny">—</span>'}</td>
        </tr>`).join('')}
      </table>`;
  }

  /* ---------- borders ---------- */
  function pairKey(a, b) { return [a, b].sort().join('|'); }
  function isOn(a, b) { return C.graph[a] && C.graph[a].has(b); }
  function renderBorders() {
    // land borders (unique pairs)
    const landSeen = new Set(); const land = [];
    Object.keys(D.adjacency).forEach(a => (D.adjacency[a] || []).forEach(b => {
      const k = pairKey(a, b); if (!landSeen.has(k)) { landSeen.add(k); land.push([a, b]); }
    }));
    const defaultSet = new Set(D.seaBorders.defaults.map(p => pairKey(p[0], p[1])));
    const seaSeen = new Set(); const sea = [];
    [...D.seaBorders.defaults, ...D.seaBorders.candidates].forEach(p => {
      const k = pairKey(p[0], p[1]); if (!seaSeen.has(k)) { seaSeen.add(k); sea.push(p); }
    });

    function item(a, b, type) {
      const on = isOn(a, b);
      const k = pairKey(a, b);
      return `<div class="brd-item ${on ? 'on' : ''}">
        <div class="brd-names">${esc(Scoring.nameById[a])} ↔ ${esc(Scoring.nameById[b])}
          <div class="brd-type">${type}</div></div>
        <label class="switch"><input type="checkbox" ${on ? 'checked' : ''}
          onchange="App.setBorder('${a}','${b}',this.checked)"><span class="slider"></span></label>
      </div>`;
    }
    return `
      <h2>Borders</h2>
      <p class="sub">Borders decide what counts as a <b>connected</b> area (scoring) and where you can <b>steal</b>.
        Toggle sea-crossings on/off to “gerrymander” the map. Changes sync live.</p>

      <h3 style="margin:16px 0 8px">🌊 Sea crossings</h3>
      <div class="brd-grid">${sea.map(p => item(p[0], p[1], defaultSet.has(pairKey(p[0], p[1])) ? 'sea · default on' : 'sea · optional')).join('')}</div>

      <h3 style="margin:22px 0 8px">🟢 Add a custom crossing</h3>
      <div class="toolbar">
        <select class="chip-select" id="brdA">${districtOptions('')}</select>
        <select class="chip-select" id="brdB">${districtOptions('')}</select>
        <button class="mini-btn" style="margin:0" onclick="Build.addBorder()">+ Connect</button>
      </div>

      <h3 style="margin:22px 0 8px">🧱 Land borders (${land.length})</h3>
      <p class="sub">On by default — turn off to split the map.</p>
      <div class="brd-grid">${land.map(p => item(p[0], p[1], 'land')).join('')}</div>`;
  }
  function addBorder() {
    const a = document.getElementById('brdA').value, b = document.getElementById('brdB').value;
    if (a === b) { App.toast('Pick two different districts.'); return; }
    App.setBorder(a, b, true); App.toast('Connected ' + Scoring.nameById[a] + ' ↔ ' + Scoring.nameById[b]);
  }

  /* ---------- rules reference (Flop version) ---------- */
  function renderRules() {
    const t = D.transport.map(m => `<tr><td>${esc(m.mode)}</td><td>${esc(m.desc)}</td></tr>`).join('');
    return `
      <h2>Rules Reference <span class="tiny">— District Claiming (Flop version)</span></h2>
      <p class="sub">Game ${esc(D.gameStart || '08:00')}–${esc(D.gameEnd || '19:00')} · start <span class="kbd">${D.startingBudget}</span> coins · +<span class="kbd">${D.incomeAmount}</span> every <span class="kbd">${D.incomeIntervalMin} min</span>.</p>

      <div class="rules-sec"><h3>🏁 Win condition</h3>
        <div class="rcard"><b>Most districts by the end of the day wins.</b> Tiebreaker: total land area of the districts claimed. (The Leaderboard ranks by district count, then area.)</div></div>

      <div class="rules-sec"><h3>🃏 The Flop</h3>
        <div class="rcard">Challenges are <b>normal</b> or <b style="color:#f5b021">hard 🟧</b> (2 normal + 1 hard per district). ${D.flopSize || 6} normal cards from ${D.flopSize || 6} different districts sit in <b>The Flop</b>. Race to complete one to claim that district; it then leaves the Flop permanently, the completing team may swap one more card, and others may protect a card. Hard challenges do not appear in The Flop. The 2 rare + 6 wildcard cards can also appear.</div></div>

      <div class="rules-sec"><h3>🂠 Private deck</h3>
        <div class="rcard">Each team also has its own <b>private deck</b> (only you see it) that gives random normal challenge cards. You get <b>1 at the start</b>, a <b>2nd after 3 hours</b>, then <b>+1 every 2 hours</b>. Complete one to claim the district, just like the Flop. (See My Team.)</div></div>

      <div class="rules-sec"><h3>⚔️ Stealing & locking</h3>
        <div class="rcard">To <b>steal</b> an opponent's district: own ≥1 district bordering it (<span style="color:#22c55e">land</span> or <span style="color:#22d3ee">sea</span>) <b>and</b> complete that district's <b style="color:#f5b021">hard challenge 🟧</b>. A stolen (or hard-claimed) district is <b>locked 🔒</b> — permanent, and can't be stolen. No coin cost.</div></div>

      <div class="rules-sec"><h3>🚇 Transport fares</h3>
        <table class="rtable"><tr><th>Mode</th><th>Cost</th></tr>${t}</table>
        <p class="tiny">MTR = the green value from the MTR Fare Calculator, ×3.</p></div>

      <div class="rules-sec"><h3>📍 Location</h3>
        <div class="rcard">Each team's location can be seen by opposing team(s) at all times. Members should stay together. Turn on <b>Share my live location</b> in My Team.</div></div>

      <div class="rules-sec"><h3>📸 Proof</h3>
        <div class="rcard">${esc(D.proofNote || '')}</div></div>

      <div class="rules-sec"><h3>⛈ Severe weather</h3>
        <div class="rcard">${esc(D.weatherNote || '')}</div></div>

      <div class="rules-sec"><h3>🤝 Fair play</h3>
        <div class="rcard">Challenges can only be started & done at their location unless stated; most can be reattempted. Please don't cheat or lie — keep the integrity and make it more enjoyable for everyone. Have fun! :)</div></div>`;
  }

  /* ---------- data / export ---------- */
  function renderData() {
    return `
      <h2>Data / Export</h2>
      <p class="sub">Back up or move the game. Connection: <b>${Sync.isOnline() ? 'Live cloud sync' : 'Offline (this device)'}</b> · room <span class="kbd">${esc(Sync.getRoom())}</span>.</p>
      <div class="toolbar">
        <button class="btn" onclick="Build.exportDeck()">⬇ Export deck (challenges)</button>
        <button class="btn" onclick="Build.exportGame()">⬇ Export full game</button>
        <button class="btn ghost" onclick="Build.copyExport()">Copy</button>
      </div>
      <textarea id="exportArea" class="export-area" spellcheck="false">${esc(JSON.stringify(App.exportDeck(), null, 2))}</textarea>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn good" onclick="Build.importDeck()">⬆ Import deck from box above</button>
        <button class="btn bad" onclick="if(confirm('Discard all challenge edits and additions?'))App.resetDeck()">Reset deck to manual defaults</button>
      </div>
      <p class="tiny" style="margin-top:8px">Tip: paste a deck JSON above then “Import”. Importing merges by card name + district.</p>`;
  }
  function wireData() {}
  function exportDeck() { setExport(App.exportDeck()); }
  function exportGame() { setExport(App.exportGame()); }
  function setExport(obj) { const a = document.getElementById('exportArea'); if (a) a.value = JSON.stringify(obj, null, 2); }
  function copyExport() {
    const a = document.getElementById('exportArea'); a.select();
    navigator.clipboard.writeText(a.value).then(() => App.toast('Copied.')).catch(() => App.toast('Select-all + copy manually.'));
  }
  function importDeck() {
    const a = document.getElementById('exportArea');
    try { const obj = JSON.parse(a.value); App.importDeck(obj); App.toast('Imported.'); }
    catch (e) { App.toast('Invalid JSON.'); }
  }

  return { init, render, onSearch, onFilter, addBorder, exportDeck, exportGame, copyExport, importDeck };
})();
