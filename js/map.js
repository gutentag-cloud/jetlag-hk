/* ============================================================
   GameMap — Leaflet map: district polygons (claim by tap),
   challenge markers, and tower / roadblock radius circles.
   Calls back into App.handleDistrictTap / App.handleMapTap.
   ============================================================ */
const GameMap = (function () {
  const D = window.JETLAG_DATA;
  let map, geoLayer, labelLayer, markerLayer, effectLayer;
  const layersById = {};
  let labelsVisible = false;
  let lastCtx = null;

  const GREY = '#3a4252';

  function init() {
    map = L.map('map', { zoomControl: true, attributionControl: false, tap: true })
           .setView([22.36, 114.13], 11);
    L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);
    L.control.attribution({ prefix: false })
      .addAttribution('© OpenStreetMap, © CARTO').addTo(map);

    geoLayer = L.geoJSON(D.districts, {
      style: () => ({ color: '#566', weight: 1.2, fillColor: GREY, fillOpacity: 0.35 }),
      onEachFeature: (feat, layer) => {
        const id = feat.properties.id;
        layersById[id] = layer;
        layer.on('click', (e) => {
          L.DomEvent.stop(e);
          App.handleDistrictTap(id, e.latlng);
        });
      }
    }).addTo(map);

    labelLayer = L.layerGroup();
    markerLayer = L.layerGroup().addTo(map);
    effectLayer = L.layerGroup().addTo(map);

    map.on('click', (e) => App.handleMapTap(e.latlng));
    map.on('zoomend', refreshLabels);

    try { map.fitBounds(geoLayer.getBounds().pad(0.04)); } catch (e) {}
    setTimeout(() => map.invalidateSize(), 200);
  }

  function teamColor(ctx, teamId) {
    const t = ctx.teams[teamId];
    return t ? t.color : GREY;
  }

  function refreshLabels() {
    if (!map) return;
    const show = map.getZoom() >= 12;
    if (show && !labelsVisible) { labelLayer.addTo(map); labelsVisible = true; }
    else if (!show && labelsVisible) { map.removeLayer(labelLayer); labelsVisible = false; }
  }

  /* full restyle from current app context */
  function update(ctx) {
    lastCtx = ctx;
    if (!map) return;
    const claims = ctx.claims || {};
    const steals = ctx.steals || {};
    // best-component set per team for highlight
    const inBest = {};
    Object.keys(ctx.scores || {}).forEach(tid => {
      (ctx.scores[tid].bestComponent || []).forEach(d => inBest[d] = tid);
    });

    D.districts.features.forEach(f => {
      const id = f.properties.id;
      const layer = layersById[id];
      if (!layer) return;
      const claim = claims[id];
      const steal = steals[id];
      let style;
      if (claim) {
        const col = teamColor(ctx, claim.team);
        const best = inBest[id] === claim.team;
        style = { color: best ? '#fff' : col, weight: best ? 2.6 : 1.4,
                  fillColor: col, fillOpacity: best ? 0.62 : 0.42, dashArray: null };
      } else {
        style = { color: '#566', weight: 1.1, fillColor: GREY, fillOpacity: 0.32, dashArray: null };
      }
      if (steal) { style.dashArray = '6 5'; style.color = teamColor(ctx, steal.by); style.weight = 2.4; }
      if (ctx.selectedDistrict === id) { style.weight = Math.max(style.weight, 3); style.color = '#fbbf24'; }
      layer.setStyle(style);
    });

    rebuildLabels(ctx);
    rebuildMarkers(ctx);
    rebuildEffects(ctx);
  }

  function rebuildLabels(ctx) {
    labelLayer.clearLayers();
    D.districts.features.forEach(f => {
      const id = f.properties.id;
      const layer = layersById[id];
      if (!layer) return;
      const c = layer.getBounds().getCenter();
      const claim = (ctx.claims || {})[id];
      const owner = claim ? (ctx.teams[claim.team] ? ctx.teams[claim.team].name : '') : '';
      const txt = f.properties.name + (owner ? ' · ' + owner : '');
      L.marker(c, { icon: L.divIcon({ className: 'dlabel', html: esc(txt), iconSize: [0, 0] }),
                    interactive: false }).addTo(labelLayer);
    });
    refreshLabels();
  }

  function rebuildMarkers(ctx) {
    markerLayer.clearLayers();
    if (!ctx.showMarkers) return;
    (ctx.challenges || []).forEach(ch => {
      if (ch.lat == null || ch.lon == null) return;
      const done = ctx.challengeDone && ctx.challengeDone[ch.id];
      const m = L.circleMarker([ch.lat, ch.lon], {
        radius: 6, color: '#0d1117', weight: 2,
        fillColor: done ? '#22c55e' : '#fbbf24', fillOpacity: 1
      });
      m.on('click', (e) => {
        L.DomEvent.stop(e);
        const dname = Scoring.nameById[ch.districtId] || ch.districtId;
        const html = `<div class="popup-title">${esc(ch.name)}</div>` +
          `<div class="popup-meta">${esc(dname)}${done ? ' · ✅ done' : ''}</div>` +
          `<div style="margin-top:6px">${esc(ch.text || 'No challenge text yet — add it in Build.')}</div>` +
          `<button class="popup-btn" onclick="App.claimViaChallenge('${ch.id}')">Claim ${esc(dname)} via this</button>`;
        L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(html).openOn(map);
      });
      m.addTo(markerLayer);
    });
  }

  function rebuildEffects(ctx) {
    effectLayer.clearLayers();
    const eff = ctx.effects || {};
    Object.keys(eff).forEach(eid => {
      const e = eff[eid];
      if (e.lat == null || e.lon == null) return;
      const col = teamColor(ctx, e.by);
      const radiusM = e.type === 'roadblock' ? (D.roadblockDiameterM / 2) : (e.radiusKm * 1000);
      const circle = L.circle([e.lat, e.lon], {
        radius: radiusM, color: col, weight: 2,
        fillColor: col, fillOpacity: 0.12, dashArray: e.type === 'roadblock' ? '4 4' : null
      });
      const remain = App.effectRemaining(e);
      const ico = e.type === 'roadblock' ? '⛔' : (e.kind || '🗼');
      circle.bindPopup(
        `<div class="popup-title">${ico} ${esc(e.name)}</div>` +
        `<div class="popup-meta">${esc((ctx.teams[e.by] || {}).name || '')} · ${remain}</div>` +
        `<div style="margin-top:5px;font-size:12px">${esc(e.effect || '')}</div>` +
        `<button class="popup-btn" onclick="App.removeEffect('${eid}')">Remove</button>`
      );
      circle.addTo(effectLayer);
      L.circleMarker([e.lat, e.lon], { radius: 4, color: '#fff', weight: 1, fillColor: col, fillOpacity: 1 })
        .addTo(effectLayer);
    });
  }

  function flyTo(id) {
    const layer = layersById[id];
    if (layer) map.fitBounds(layer.getBounds().pad(0.2));
  }
  function centerOf(id) {
    const l = layersById[id];
    return l ? l.getBounds().getCenter() : (map ? map.getCenter() : [22.36, 114.13]);
  }
  function popupAtDistrict(id, html) {
    if (!map) return;
    L.popup({ maxWidth: 300 }).setLatLng(centerOf(id)).setContent(html).openOn(map);
  }
  function invalidate() { if (map) setTimeout(() => map.invalidateSize(), 60); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  return { init, update, flyTo, centerOf, popupAtDistrict, invalidate };
})();
