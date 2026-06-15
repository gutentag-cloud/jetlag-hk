/* ============================================================
   MTR — ported from the team's "MTR Fare Calculator v2" Apps Script.
   Pure browser version (Sheets I/O removed). Given two station names
   it returns the fare units (the "green value" — ×3 = coins), the
   journey time, and the leg-by-leg route.
   Fare / time logic is kept faithful to the original script.
   ============================================================ */
const MTR = (function () {
  class PriorityQueue {
    constructor() { this.values = []; }
    enqueue(element, priority) { this.values.push({ element, priority }); this.values.sort((a, b) => a.priority - b.priority); }
    dequeue() { return this.values.shift(); }
    isEmpty() { return this.values.length === 0; }
  }

  const LINE_WAITING_TIMES = {
    "TWL": 1.5, "KTL": 1.5, "ISL": 1.5, "EAL": 2.0, "TML": 3.0,
    "SIL": 3.0, "TKL": 3.0, "TCL": 4.0, "DRL": 5.0, "WALK": 0,
    "EAL (1)": 2.0, "EAL (2)": 2.0, "TKL (1)": 3.0
  };
  const TIME_OVERRIDES = {
    "Admiralty-Ocean Park": 5, "Ocean Park-Admiralty": 5,
    "Yau Ma Tei-Ho Man Tin": 4, "Tiu Keng Leng-Yau Tong": 4,
    "Tseung Kwan O-LOHAS Park": 4,
    "Lai King-Tsing Yi": 3, "Tsing Yi-Sunny Bay": 6, "Sunny Bay-Tung Chung": 7,
    "Hung Hom-Kowloon Tong": 3, "Hung Hom-Mong Kok East": 3, "Mong Kok East-Kowloon Tong": 3,
    "Kowloon Tong-Tai Wai": 5,
    "Tai Wai-University": 3, "Tai Wai-Sha Tin": 3, "Sha Tin-Fo Tan": 3, "Fo Tan-University": 3,
    "University-Tai Po Market": 6, "Tai Wo-Fanling": 5,
    "Fanling-Sheung Shui": 3, "Sheung Shui-Lok Ma Chau": 6, "Sheung Shui-Lo Wu": 4,
    "Diamond Hill-Hin Keng": 5, "Mei Foo-Tsuen Wan West": 6, "Tsuen Wan West-Kam Sheung Road": 7,
    "Kam Sheung Road-Yuen Long": 5, "Yuen Long-Long Ping": 3, "Long Ping-Tin Shui Wai": 4,
    "Tin Shui Wai-Siu Hong": 6, "Siu Hong-Tuen Mun": 4, "Nam Cheong-Lai King": 4,
    "Sung Wong Toi-To Kwa Wan": 3.5, "To Kwa Wan-Ho Man Tin": 3.5, "Ho Man Tin-Hung Hom": 3.5,
    "Hung Hom-Austin": 3.5, "Austin-Nam Cheong": 3.5, "Nam Cheong-Mei Foo": 3.5
  };
  const NAME_TO_CODE = {
    "Wu Kai Sha": "WKS", "Ma On Shan": "MOS", "Heng On": "HEO", "Tai Shui Hang": "TSH", "Shek Mun": "SHM", "City One": "CIO", "Sha Tin Wai": "STW", "Che Kung Temple": "CKT", "Tai Wai": "TAW", "Hin Keng": "HIK", "Diamond Hill": "DIH", "Kai Tak": "KAT", "Sung Wong Toi": "SUW", "To Kwa Wan": "TKW", "Ho Man Tin": "HOM", "Hung Hom": "HUH", "East Tsim Sha Tsui": "ETS", "Austin": "AUS", "Nam Cheong": "NAC", "Mei Foo": "MEF", "Tsuen Wan West": "TWW", "Kam Sheung Road": "KSR", "Yuen Long": "YUL", "Long Ping": "LOP", "Tin Shui Wai": "TIS", "Siu Hong": "SIH", "Tuen Mun": "TUM",
    "Sheung Shui": "SHS", "Fanling": "FAN", "Tai Wo": "TWO", "Tai Po Market": "TAP", "University": "UNI", "Fo Tan": "FOT", "Sha Tin": "SHT", "Kowloon Tong": "KOT", "Mong Kok East": "MKK", "Exhibition Centre": "EXC", "Admiralty": "ADM", "Lo Wu": "LOW", "Lok Ma Chau": "LMC",
    "Tiu Keng Leng": "TIK", "Yau Tong": "YAT", "Lam Tin": "LAT", "Kwun Tong": "KWT", "Ngau Tau Kok": "NTK", "Kowloon Bay": "KOB", "Choi Hung": "CHH", "Wong Tai Sin": "WTS", "Lok Fu": "LOF", "Shek Kip Mei": "SKM", "Prince Edward": "PRE", "Mong Kok": "MOK", "Yau Ma Tei": "YMT", "Whampoa": "WHA",
    "Chai Wan": "CHW", "Heng Fa Chuen": "HFC", "Shau Kei Wan": "SKW", "Sai Wan Ho": "SWH", "Tai Koo": "TAK", "Quarry Bay": "QUB", "North Point": "NOP", "Fortress Hill": "FOH", "Tin Hau": "TIH", "Causeway Bay": "CAB", "Wan Chai": "WAC", "Central": "CEN", "Sheung Wan": "SHW", "Sai Ying Pun": "SYP", "HKU": "HKU", "Kennedy Town": "KET",
    "Tung Chung": "TUC", "Sunny Bay": "SUN", "Tsing Yi": "TSY", "Lai King": "LAK", "Olympic": "OLY", "Kowloon": "KOW", "Hong Kong": "HOK",
    "Po Lam": "POA", "Hang Hau": "HAH", "Tseung Kwan O": "TKO", "LOHAS Park": "LHP",
    "Tsuen Wan": "TSW", "Tai Wo Hau": "TWH", "Kwai Hing": "KWH", "Kwai Fong": "KWF", "Lai Chi Kok": "LCK", "Cheung Sha Wan": "CSW", "Sham Shui Po": "SSP", "Jordan": "JOR", "Tsim Sha Tsui": "TST",
    "South Horizons": "SOH", "Lei Tung": "LET", "Wong Chuk Hang": "WCH", "Ocean Park": "OCP",
    "Disneyland Resort": "DIS"
  };
  const FARE_DATA = {
    "TML": { arr: [67.36, 71.83, 67.0, 40.53, 88.32, 71.62, 75.57, 83.79, 76.1, 27.06, 76.81, 70.1, 67.45, 76.99, 98.55, 92.8, 62.4, 36.41, 44.71, 27.93, 14.04, 30.53, 69.07, 43.12, 22.73, 47.21], map: { "WKS": 0, "MOS": 1, "HEO": 2, "TSH": 3, "SHM": 4, "CIO": 5, "STW": 6, "CKT": 7, "TAW": 8, "HIK": 9, "DIH": 10, "KAT": 11, "SUW": 12, "TKW": 13, "HOM": 14, "HUH": 15, "ETS": 16, "AUS": 17, "NAC": 18, "MEF": 19, "TWW": 20, "KSR": 21, "YUL": 22, "LOP": 23, "TIS": 24, "SIH": 25, "TUM": 26 } },
    "EAL": { arr: [57.58, 16.68, 63.52, 18.59, 43.38, 53.81, 63.65, 26.27, 54.31, 50.57, 38.67, 47.49], map: { "SHS": 0, "FAN": 1, "TWO": 2, "TAP": 3, "UNI": 4, "FOT": 5, "SHT": 6, "TAW": 7, "KOT": 8, "MKK": 9, "HUH": 10, "EXC": 11, "ADM": 12 } },
    "KTL": { arr: [53.99, 83.88, 76.93, 77.77, 68.25, 63.28, 76.65, 92.35, 81.84, 95.67, 67.66, 92.35, 100.01, 93.98, 52.75, 76.11], map: { "TIK": 0, "YAT": 1, "LAT": 2, "KWT": 3, "NTK": 4, "KOB": 5, "CHH": 6, "DIH": 7, "WTS": 8, "LOF": 9, "KOT": 10, "SKM": 11, "PRE": 12, "MOK": 13, "YMT": 14, "HOM": 15, "WHA": 16 } },
    "ISL": { arr: [63.31, 79.48, 64.30, 85.6, 92.84, 83.0, 74.8, 87.52, 92.46, 83.2, 83.07, 74.23, 88.0, 77.99, 65.01, 62.53], map: { "CHW": 0, "HFC": 1, "SKW": 2, "SWH": 3, "TAK": 4, "QUB": 5, "NOP": 6, "FOH": 7, "TIH": 8, "CAB": 9, "WAC": 10, "ADM": 11, "CEN": 12, "SHW": 13, "SYP": 14, "HKU": 15, "KET": 16 } },
    "TCL": { arr: [16.2, 15.86, 46.91, 26.63, 64.87, 54.53, 41.15], map: { "TUC": 0, "SUN": 1, "TSY": 2, "LAK": 3, "NAC": 4, "OLY": 5, "KOW": 6, "HOK": 7 } },
    "TKL": { arr: [68.58, 68.39, 84.65, 56.5, 43.03, 55.25], map: { "POA": 0, "HAH": 1, "TKO": 2, "TIK": 3, "YAT": 4, "QUB": 5, "NOP": 6, "LHP": 7 } },
    "TWL": { arr: [75.86, 63.92, 88.01, 80.09, 57.33, 77.06, 81.51, 91.33, 89.03, 117.6, 92.14, 88.98, 101.31, 54.63, 82.61], map: { "TSW": 0, "TWH": 1, "KWH": 2, "KWF": 3, "LAK": 4, "MEF": 5, "LCK": 6, "CSW": 7, "SSP": 8, "PRE": 9, "MOK": 10, "YMT": 11, "JOR": 12, "TST": 13, "ADM": 14, "CEN": 15 } },
    "SIL": { arr: [77.85, 61.75, 86.08, 28.71], map: { "SOH": 0, "LET": 1, "WCH": 2, "OCP": 3, "ADM": 4 } },
    "DRL": { arr: [30.0], map: { "DIS": 0, "SUN": 1 } }
  };

  function calculatePrefixSum(arr) { let ps = [0]; for (let i = 0; i < arr.length; i++) ps.push(ps[i] + arr[i]); return ps; }
  for (let key in FARE_DATA) FARE_DATA[key].ps = calculatePrefixSum(FARE_DATA[key].arr);

  function calculateLegFare(line, startCode, endCode) {
    if (line === "WALK" || !line) return 0;
    let baseLine = line;
    if (line === "EAL (2)" || line === "EAL (1)") baseLine = "EAL";
    if (line === "TKL (1)") baseLine = "TKL";
    if (!FARE_DATA[baseLine]) return 0;
    let currFare = 0, s1 = startCode, s2 = endCode;
    if (baseLine == "EAL") {
      let isLMC = (s1 == "LMC");
      if (isLMC && s2 != "LMC") { currFare += 19.47; s1 = "SHS"; }
      else if (s2 == "LMC" && s1 != "LMC" && !isLMC) { currFare += 19.47; s2 = "SHS"; }
      else if (s1 == "LMC") s1 = "SHS";
      let isLOW = (s1 == "LOW");
      if (isLOW && s2 != "LOW") { currFare += 36.06; s1 = "SHS"; }
      else if (s2 == "LOW" && s1 != "LOW" && !isLOW) { currFare += 36.06; s2 = "SHS"; }
      else if (s1 == "LOW") s1 = "SHS";
    }
    if (baseLine == "TKL") {
      let isLHP = (s1 == "LHP");
      if (isLHP && s2 != "LHP") { currFare += 42.53; s1 = "TKO"; }
      else if (s2 == "LHP" && s1 != "LHP" && !isLHP) { currFare += 42.53; s2 = "TKO"; }
      else if (s1 == "LHP") s1 = "TKO";
    }
    let currentMap = FARE_DATA[baseLine].map, currentPS = FARE_DATA[baseLine].ps;
    let idx1 = currentMap[s1], idx2 = currentMap[s2];
    if (idx1 === undefined || idx2 === undefined) return 0;
    currFare += Math.abs(currentPS[idx2] - currentPS[idx1]);
    return currFare;
  }

  function findBestLineFare(code1, code2) {
    if ((code1 === "CEN" && code2 === "HOK") || (code1 === "HOK" && code2 === "CEN")) return { fare: 0, line: "WALK" };
    if ((code1 === "TST" && code2 === "ETS") || (code1 === "ETS" && code2 === "TST")) return { fare: 0, line: "WALK" };
    let bestFare = Infinity, bestLine = null;
    for (let line in FARE_DATA) {
      let map = FARE_DATA[line].map;
      if (map[code1] !== undefined && map[code2] !== undefined) {
        let fare = calculateLegFare(line, code1, code2);
        if (fare < bestFare) { bestFare = fare; bestLine = line; }
      }
    }
    if (bestFare === Infinity) return null;
    return { fare: bestFare, line: bestLine };
  }

  function getStrictTravelTime(u, v, line) {
    if (line === "WALK") {
      if ((u.includes("Central") && v.includes("Hong Kong")) || (v.includes("Central") && u.includes("Hong Kong"))) return 5;
      if ((u.includes("Tsim") && v.includes("Tsim"))) return 8;
      return 5;
    }
    const pair1 = `${u}-${v}`, pair2 = `${v}-${u}`;
    if (TIME_OVERRIDES[pair1] !== undefined) return TIME_OVERRIDES[pair1];
    if (TIME_OVERRIDES[pair2] !== undefined) return TIME_OVERRIDES[pair2];
    const crossHarbourPairs = ["Admiralty-Tsim Sha Tsui", "Tsim Sha Tsui-Admiralty", "Hong Kong-Kowloon", "Kowloon-Hong Kong", "North Point-Yau Tong", "Yau Tong-North Point", "Quarry Bay-Yau Tong", "Yau Tong-Quarry Bay", "Hung Hom-Exhibition Centre", "Exhibition Centre-Hung Hom"];
    if (crossHarbourPairs.includes(pair1)) return 4;
    return 2;
  }

  function buildMTRGraph() {
    const lines = [
      ["Kennedy Town", "HKU", "Sai Ying Pun", "Sheung Wan", "Central", "Admiralty", "Wan Chai", "Causeway Bay", "Tin Hau", "Fortress Hill", "North Point", "Quarry Bay", "Tai Koo", "Sai Wan Ho", "Shau Kei Wan", "Heng Fa Chuen", "Chai Wan"],
      ["Central", "Admiralty", "Tsim Sha Tsui", "Jordan", "Yau Ma Tei", "Mong Kok", "Prince Edward", "Sham Shui Po", "Cheung Sha Wan", "Lai Chi Kok", "Mei Foo", "Lai King", "Kwai Fong", "Kwai Hing", "Tai Wo Hau", "Tsuen Wan"],
      ["Whampoa", "Ho Man Tin", "Yau Ma Tei", "Mong Kok", "Prince Edward", "Shek Kip Mei", "Kowloon Tong", "Lok Fu", "Wong Tai Sin", "Diamond Hill", "Choi Hung", "Kowloon Bay", "Ngau Tau Kok", "Kwun Tong", "Lam Tin", "Yau Tong", "Tiu Keng Leng"],
      ["North Point", "Quarry Bay", "Yau Tong", "Tiu Keng Leng", "Tseung Kwan O", "Hang Hau", "Po Lam"],
      ["Tseung Kwan O", "LOHAS Park"],
      ["Hong Kong", "Kowloon", "Olympic", "Nam Cheong", "Lai King", "Tsing Yi", "Sunny Bay", "Tung Chung"],
      ["Sunny Bay", "Disneyland Resort"],
      ["Admiralty", "Exhibition Centre", "Hung Hom", "Mong Kok East", "Kowloon Tong", "Tai Wai", "Sha Tin", "Fo Tan", "University", "Tai Po Market", "Tai Wo", "Fanling", "Sheung Shui", "Lo Wu"],
      ["Sheung Shui", "Lok Ma Chau"],
      ["Wu Kai Sha", "Ma On Shan", "Heng On", "Tai Shui Hang", "Shek Mun", "City One", "Sha Tin Wai", "Che Kung Temple", "Tai Wai", "Hin Keng", "Diamond Hill", "Kai Tak", "Sung Wong Toi", "To Kwa Wan", "Ho Man Tin", "Hung Hom", "East Tsim Sha Tsui", "Austin", "Nam Cheong", "Mei Foo", "Tsuen Wan West", "Kam Sheung Road", "Yuen Long", "Long Ping", "Tin Shui Wai", "Siu Hong", "Tuen Mun"],
      ["Admiralty", "Ocean Park", "Wong Chuk Hang", "Lei Tung", "South Horizons"],
      ["Hong Kong", "Central"],
      ["Tsim Sha Tsui", "East Tsim Sha Tsui"]
    ];
    let graph = {};
    function addEdge(u, v) {
      if (!graph[u]) graph[u] = []; if (!graph[v]) graph[v] = [];
      if (!graph[u].includes(v)) graph[u].push(v);
      if (!graph[v].includes(u)) graph[v].push(u);
    }
    lines.forEach(line => { for (let i = 0; i < line.length - 1; i++) addEdge(line[i], line[i + 1]); });
    return graph;
  }
  const GRAPH = buildMTRGraph();

  function getShortestPath(graph, start, end) {
    let queue = [[start]], visited = new Set([start]);
    while (queue.length > 0) {
      let p = queue.shift(), node = p[p.length - 1];
      if (node === end) return p;
      for (let neighbor of (graph[node] || [])) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push([...p, neighbor]); }
    }
    return null;
  }

  function getCheapestPath(graph, start, end) {
    let costs = {}, backtrace = {}, pq = new PriorityQueue();
    for (let node in graph) costs[node] = Infinity;
    costs[start] = 0; pq.enqueue(start, 0);
    while (!pq.isEmpty()) {
      let { element: current, priority: currentCost } = pq.dequeue();
      if (current === end) { let path = [end], step = end; while (step !== start) { step = backtrace[step]; path.unshift(step); } return path; }
      if (currentCost > costs[current]) continue;
      for (let neighbor of (graph[current] || [])) {
        let seg = findBestLineFare(NAME_TO_CODE[current], NAME_TO_CODE[neighbor]);
        let newCost = currentCost + (seg ? seg.fare : 999);
        if (newCost < costs[neighbor]) { costs[neighbor] = newCost; backtrace[neighbor] = current; pq.enqueue(neighbor, newCost); }
      }
    }
    return null;
  }

  function getFastestPath(graph, start, end) {
    let minTimes = {}, backtrace = {}, pq = new PriorityQueue();
    minTimes[start + "_START"] = 0;
    pq.enqueue({ station: start, line: "START" }, (start === "LOHAS Park") ? 2 : 0);
    let finalStateKey = null;
    while (!pq.isEmpty()) {
      let item = pq.dequeue();
      let currentStation = item.element.station, currentLine = item.element.line, currentTime = item.priority;
      let currentKey = currentStation + "_" + currentLine;
      if (currentTime > (minTimes[currentKey] || Infinity)) continue;
      if (currentStation === end) { finalStateKey = currentKey; break; }
      for (let neighbor of (graph[currentStation] || [])) {
        let u_code = NAME_TO_CODE[currentStation], v_code = NAME_TO_CODE[neighbor];
        let nextLine = "WALK";
        if (currentLine !== "START" && currentLine !== "WALK" && FARE_DATA[currentLine]) {
          let map = FARE_DATA[currentLine].map;
          if (map && map[u_code] !== undefined && map[v_code] !== undefined) nextLine = currentLine;
          else { let s = findBestLineFare(u_code, v_code); nextLine = s ? s.line : "WALK"; }
        } else { let s = findBestLineFare(u_code, v_code); nextLine = s ? s.line : "WALK"; }
        let travelTime = getStrictTravelTime(currentStation, neighbor, nextLine);
        if (neighbor === "LOHAS Park") travelTime += 3;
        let transferPenalty = 0;
        if (currentLine !== "START" && currentLine !== nextLine) { if (nextLine !== "WALK") transferPenalty = 1 + (LINE_WAITING_TIMES[nextLine] || 3); }
        else if (currentLine === "START" && nextLine !== "WALK") transferPenalty = (LINE_WAITING_TIMES[nextLine] || 3);
        let newTime = currentTime + travelTime + transferPenalty;
        let neighborKey = neighbor + "_" + nextLine;
        if (newTime < (minTimes[neighborKey] || Infinity)) { minTimes[neighborKey] = newTime; backtrace[neighborKey] = { station: currentStation, line: currentLine }; pq.enqueue({ station: neighbor, line: nextLine }, newTime); }
      }
    }
    if (finalStateKey) {
      let path = [end], curr = finalStateKey;
      while (backtrace[curr]) { let prev = backtrace[curr]; path.unshift(prev.station); curr = prev.station + "_" + prev.line; }
      return path;
    }
    return null;
  }

  /* port of analyzeAndOutput's fare + time accumulation (returns data, no sheet) */
  function analyzePath(path) {
    let totalFare = 0, totalTime = 0, legCount = 1, legs = [];
    let currentStart = path[0], currentLine = null, legTime = 0;
    if (path[0] === "LOHAS Park") { totalTime += 5; legTime += 5; }
    for (let i = 0; i < path.length - 1; i++) {
      let u = path[i], v = path[i + 1];
      let u_code = NAME_TO_CODE[u], v_code = NAME_TO_CODE[v];
      let next_v = path[i + 2] ? NAME_TO_CODE[path[i + 2]] : null;
      let segmentLine = "UNKNOWN";
      if (u_code === "PRE" && v_code === "MOK" && next_v === "JOR" && currentLine === "KTL") segmentLine = "KTL";
      else if (u_code === "MOK" && v_code === "PRE" && next_v === "SKM") segmentLine = "KTL";
      else if (u_code === "TIK" && v_code === "YAT" && next_v === "LAT") segmentLine = "KTL";
      else if (u_code === "YAT" && v_code === "TIK" && next_v === "TKO") segmentLine = "KTL";
      else if (currentLine && currentLine !== "UNKNOWN" && FARE_DATA[currentLine]) {
        let map = FARE_DATA[currentLine].map;
        if (map && map[u_code] !== undefined && map[v_code] !== undefined) segmentLine = currentLine;
        else { let b = findBestLineFare(u_code, v_code); segmentLine = b ? b.line : "UNKNOWN"; }
      } else { let b = findBestLineFare(u_code, v_code); segmentLine = b ? b.line : "UNKNOWN"; }
      if ((u_code === "SHS" && v_code === "LOW") || (u_code === "LOW" && v_code === "SHS")) segmentLine = "EAL (1)";
      else if ((u_code === "SHS" && v_code === "LMC") || (u_code === "LMC" && v_code === "SHS")) segmentLine = "EAL (2)";
      else if ((u_code === "TKO" && v_code === "LHP") || (u_code === "LHP" && v_code === "TKO")) segmentLine = "TKL (1)";
      if (currentLine === null) {
        currentLine = segmentLine;
        if (segmentLine !== "WALK" && segmentLine !== "UNKNOWN") { let wait = LINE_WAITING_TIMES[segmentLine] || 3; totalTime += wait; legTime += wait; }
      }
      if (segmentLine !== currentLine) {
        let legFare = calculateLegFare(currentLine, NAME_TO_CODE[currentStart], u_code);
        totalFare += legFare;
        legs.push({ leg: legCount++, line: currentLine, from: currentStart, to: u, fare: legFare, time: +legTime.toFixed(1) });
        currentStart = u; currentLine = segmentLine; legTime = 0;
        if (segmentLine !== "WALK" && segmentLine !== "UNKNOWN") { let wait = LINE_WAITING_TIMES[segmentLine] || 3; let penalty = 1 + wait; totalTime += penalty; legTime += penalty; }
      }
      let t = getStrictTravelTime(u, v, segmentLine);
      totalTime += t; legTime += t;
      if (v === "LOHAS Park") { totalTime += 5; legTime += 5; }
    }
    let last = path[path.length - 1];
    let finalFare = calculateLegFare(currentLine, NAME_TO_CODE[currentStart], NAME_TO_CODE[last]);
    totalFare += finalFare;
    legs.push({ leg: legCount++, line: currentLine, from: currentStart, to: last, fare: finalFare, time: +legTime.toFixed(1) });
    return { fareUnits: +totalFare.toFixed(1), timeMins: +totalTime.toFixed(1), legs };
  }

  const STATIONS = Object.keys(NAME_TO_CODE).sort();
  function valid(name) { return !!NAME_TO_CODE[name]; }

  function compute(fromName, toName, mode) {
    if (!valid(fromName) || !valid(toName)) return { ok: false, error: 'Pick two valid stations.' };
    if (fromName === toName) return { ok: false, error: 'Same station.' };
    let path = mode === 'fewest' ? getShortestPath(GRAPH, fromName, toName)
      : mode === 'fastest' ? getFastestPath(GRAPH, fromName, toName)
      : getCheapestPath(GRAPH, fromName, toName);
    if (!path) return { ok: false, error: 'No route found.' };
    const a = analyzePath(path);
    return { ok: true, path, fareUnits: a.fareUnits, timeMins: a.timeMins, stops: path.length - 1, legs: a.legs, mode: mode || 'cheapest' };
  }

  return { STATIONS, valid, compute, NAME_TO_CODE };
})();
if (typeof module !== 'undefined') module.exports = MTR;
