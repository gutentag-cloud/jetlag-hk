# Jet Lag HK — District Claiming

A web companion for your Hong Kong "District Claiming" game (Jet Lag style). Built from
your map (`Jet Lag 176.kmz` → **29 districts + 32 challenge locations**) and both rule manuals.

The app has **two parts** (top-left tabs):

### ▶ Play — live game-day companion
- **Interactive map** of all 29 districts. Tap a district (with a team selected) to **claim** it;
  tap your own to release. Challenge locations show as pins.
- **Leaderboard** — live **largest connected land area** per team (the win condition). Only
  districts connected to each other (land or an enabled sea-crossing) count; the biggest blob is
  outlined in white on the map.
- **Teams & coins** — rename, recolour, adjust balances (start 900).
- **Transport calculator** — MTR (map # ×2), bus, minibus, ferry, light rail, tram, bike → charges the team.
- **Shops** — Powerups (incl. the `350 + 50n` formula ones), **Towers** (draw a random Jail/Odd/Trap/Coin
  tower, drop it on the map, 1-hour countdown + radius circle), **Roadblocks** (200 m, 40 min).
- **Active effects** — every tower/roadblock with a live countdown; tap a circle on the map to remove it.
- **Steal** — pick an opponent district, see the initiation cost from how many bordering districts you own
  (1→800, 2→400, 3+→100), pay, then complete a *different* location to steal it; defender can lock it.
- **Activity log** of everything that happens.

### 🛠 Build — design / reference
- **Challenge Deck** — all 80 cards (each = one challenge for one district). Edit names/text, move a card to
  another district, mark done, add/delete cards, search & filter. Blank districts are ready to fill in.
- **Districts** — table of areas, card counts, borders, owners.
- **Borders** — toggle **sea-crossings** on/off (Kowloon↔HK Island harbour, Lantau links, …) and even land
  borders to "gerrymander" what counts as connected. Add custom crossings. This drives both scoring and stealing.
- **Rules Reference** — transport, powerups, towers, roadblocks, steal costs, win condition.
- **Data / Export** — back up or move the game; export/import the challenge deck as JSON.

---

## Running it

**Locally (single device, instant):** just open `index.html` in a browser, or serve the folder:
```
cd jetlag-app
python3 -m http.server 8137      # then open http://localhost:8137
```
Everything works offline (state saved in the browser). Internet is only needed for the map tiles.

## Multi-device live sync (all phones share the same game)

Click the **connection chip** (top-right) and paste a **Firebase Realtime Database** config. One person sets
this up once and shares the **same config + room code** with everyone.

1. Create a free project at <https://console.firebase.google.com>.
2. **Build → Realtime Database → Create Database → Start in test mode.**
3. **Project settings → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` object
   (it must include a `databaseURL`).
4. In the app: connection chip → enter a **room code** (e.g. `hk-jun17`) → paste the config → **Connect & sync**.
5. Send teammates the app URL, the same config, and the same room code.

> Test-mode rules are open to anyone with the database URL — fine for a one-day game. Disable the database
> or tighten rules afterwards.

### Hosting (so phones can reach it)
Drag the `jetlag-app` folder into **Netlify Drop** (netlify.com/drop), or push to **GitHub Pages**, or use
**Firebase Hosting** (`firebase deploy`). Any static host works — there's no build step.

---

## Files
```
index.html        shell + tabs
css/styles.css    styling (mobile-first, dark)
js/data.js        your 29 districts (GeoJSON), 32 markers, 80 challenges, transport/shop/steal config
js/sync.js        Firebase Realtime DB sync + offline (localStorage) fallback
js/scoring.js     adjacency graph + connected-area scoring + steal-border lookup
js/map.js         Leaflet map (claim, markers, tower/roadblock radii)
js/play.js        Play tab
js/build.js       Build tab
js/app.js         controller (state, actions, rendering)
data/             raw districts.geojson / places.json / adjacency.json (reference copies)
```

To change the map or challenges permanently, edit `js/data.js` (or use the Build tab + Export and paste back in).
