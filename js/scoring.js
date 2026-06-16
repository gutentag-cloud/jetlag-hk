/* ============================================================
   Scoring — the win condition is "largest CONNECTED land area".
   We build an adjacency graph (land-touching borders + enabled
   sea-borders, minus any removed borders), then for each team find
   the connected component of their claimed districts with the most
   total area.  Also exposes bordering-owned lookup for the steal cost.
   ============================================================ */
const Scoring = (function () {
  const D = window.JETLAG_DATA;
  const areaById = {};
  const nameById = {};
  D.districts.features.forEach(f => {
    areaById[f.properties.id] = f.properties.area_km2;
    nameById[f.properties.id] = f.properties.name;
  });
  const allIds = D.districts.features.map(f => f.properties.id);

  function key(a, b) { return [a, b].sort().join('|'); }

  /* Build the working graph from base land-adjacency + border edits in state. */
  function buildGraph(borders) {
    borders = borders || {};
    const g = {};
    allIds.forEach(id => g[id] = new Set());
    Object.keys(D.adjacency).forEach(id => (D.adjacency[id] || []).forEach(n => {
      if (g[id]) g[id].add(n);
    }));
    // default + extra sea-borders that are enabled
    const enabled = new Set();
    D.seaBorders.defaults.forEach(p => enabled.add(key(p[0], p[1])));
    Object.keys(borders).forEach(k => {
      if (borders[k] === true) enabled.add(k);
      if (borders[k] === false) enabled.delete(k);   // explicit off (covers removing a default/land border)
    });
    enabled.forEach(k => {
      const [a, b] = k.split('|');
      if (g[a] && g[b]) { g[a].add(b); g[b].add(a); }
    });
    // explicit removals (false) also strip land borders
    Object.keys(borders).forEach(k => {
      if (borders[k] === false) { const [a, b] = k.split('|'); if (g[a]) g[a].delete(b); if (g[b]) g[b].delete(a); }
    });
    return g;
  }

  /* Score = the team's LARGEST CONNECTED group of districts.
     count = districts in that group; totalArea = its land area (tiebreak).
     Connectivity uses the adjacency graph (land + enabled sea-crossings). */
  function teamScore(districtIds, graph) {
    const set = new Set(districtIds), seen = new Set(), comps = [];
    districtIds.forEach(id => {
      if (seen.has(id)) return;
      const stack = [id], comp = []; seen.add(id);
      while (stack.length) {
        const cur = stack.pop(); comp.push(cur);
        (graph && graph[cur] ? Array.from(graph[cur]) : []).forEach(n => {
          if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        });
      }
      comps.push({ districts: comp, count: comp.length, area: comp.reduce((s, d) => s + (areaById[d] || 0), 0) });
    });
    comps.sort((a, b) => b.count - a.count || b.area - a.area);
    const best = comps[0] || { districts: [], count: 0, area: 0 };
    return {
      count: best.count, totalArea: best.area, bestComponent: best.districts,
      claimedCount: districtIds.length, claimedArea: districtIds.reduce((s, d) => s + (areaById[d] || 0), 0),
      components: comps
    };
  }

  /* Owned neighbours of a district (for steal cost = #bordering owned). */
  function borderingOwned(districtId, ownedIds, graph) {
    const owned = new Set(ownedIds);
    return Array.from(graph[districtId] || []).filter(n => owned.has(n));
  }

  /* Split a district's neighbours into land (real) vs sea-crossing (enabled). */
  function neighborsByType(districtId, graph) {
    const land = new Set(D.adjacency[districtId] || []);
    const all = Array.from((graph && graph[districtId]) || []);
    return { land: all.filter(n => land.has(n)), sea: all.filter(n => !land.has(n)) };
  }

  return { buildGraph, teamScore, borderingOwned, neighborsByType, areaById, nameById, allIds };
})();
