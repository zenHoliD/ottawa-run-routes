const OTTAWA_CENTER = [45.4215, -75.6972];
const ORS_BASE = "https://api.openrouteservice.org/v2";

// Rideau Canal path: Dow's Lake → Ottawa Locks (south to north, [lng, lat])
const RIDEAU_CANAL = [
  [-75.7168, 45.3897], // Dow's Lake
  [-75.7080, 45.3940], // Carling Ave bridge
  [-75.7020, 45.3975], // Bronson Ave area
  [-75.6980, 45.4010], // Glebe entry
  [-75.6947, 45.4050], // Fifth Ave bridge
  [-75.6920, 45.4090], // Pretoria Bridge
  [-75.6901, 45.4130], // Bank St bridge
  [-75.6880, 45.4175], // Hartwell Locks area
  [-75.6870, 45.4215], // Laurier Ave bridge
  [-75.6920, 45.4250], // Plaza Bridge
  [-75.6963, 45.4270], // Ottawa Locks / Parliament Hill
];

// Ottawa green areas and parks
const GREEN_AREAS = [
  [-75.7150, 45.3850], // Vincent Massey Park
  [-75.6986, 45.3756], // Hog's Back Falls
  [-75.7650, 45.4040], // Britannia Park
  [-75.6936, 45.4272], // Major's Hill Park
  [-75.7400, 45.3950], // Central Experimental Farm
  [-75.6620, 45.4170], // Strathcona Park
  [-75.6700, 45.4000], // Rideau River east pathway
  [-75.7200, 45.4320], // Ottawa River NCC pathway
  [-75.6500, 45.4050], // Rideau River south
];

// All scenic + safe points (used for scoring)
const SCENIC_POINTS = [...RIDEAU_CANAL, ...GREEN_AREAS];

// Canal split into south/north halves so scenic variants pick from different sections
const CANAL_SOUTH = RIDEAU_CANAL.slice(0, 5);  // Dow's Lake → Fifth Ave bridge
const CANAL_NORTH = RIDEAU_CANAL.slice(5);     // Pretoria Bridge → Ottawa Locks

// Safe running corridors (NCC pathways, parks, canal)
const SAFE_CORRIDORS = [
  ...RIDEAU_CANAL,
  [-75.7200, 45.4320], [-75.7400, 45.4250], [-75.7600, 45.4130],
  [-75.7150, 45.3850], [-75.6986, 45.3756],
];

const ROUTE_CONFIGS = [
  { name: "Route A", color: "#2563eb", seed: 1,  points: 3 },
  { name: "Route B", color: "#16a34a", seed: 50, points: 5 },
  { name: "Route C", color: "#ea580c", seed: 99, points: 7 },
];

// State
let map, markerLayer;
let routeLayers = [];       // Leaflet layer per route
let routeData = [];         // GeoJSON per route
let selectedIndex = null;
let elevationChart = null;

// ── Map init ──────────────────────────────────────────────────
map = L.map("map").setView(OTTAWA_CENTER, 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

map.on("click", (e) => setStart(e.latlng.lat, e.latlng.lng, "Map pin"));

// ── Distance slider ───────────────────────────────────────────
const slider = document.getElementById("distance-slider");
const distLabel = document.getElementById("distance-label");
slider.addEventListener("input", () => {
  distLabel.textContent = `${slider.value} km`;
});

// ── Geolocation ───────────────────────────────────────────────
document.getElementById("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocation not supported.", "error");
  setStatus("Getting your location...", "loading");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setStart(pos.coords.latitude, pos.coords.longitude, "Your location");
      setStatus("Location set. Hit Generate Routes.");
    },
    () => setStatus("Could not get location. Try typing an address.", "error")
  );
});

// ── Address geocoding (Nominatim — no API key needed) ─────────
document.getElementById("address").addEventListener("keydown", (e) => {
  if (e.key === "Enter") geocodeAddress();
});
document.getElementById("geocode-btn").addEventListener("click", geocodeAddress);

let startCoords = null; // [lng, lat] for ORS

async function geocodeAddress() {
  const query = document.getElementById("address").value.trim();
  if (!query) return;
  setStatus("Looking up address...", "loading");
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(query + " Ottawa Ontario Canada")}` +
      `&format=json&limit=1&countrycodes=ca&addressdetails=0`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "OttawaRunRoutes/1.0" },
    });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = await res.json();
    if (!data.length) throw new Error("Address not found. Try adding a street number or landmark.");
    const { lat, lon, display_name } = data[0];
    setStart(parseFloat(lat), parseFloat(lon), display_name);
    document.getElementById("address").value = display_name.split(",").slice(0, 2).join(",");
    setStatus("Address found. Hit Generate Routes.");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function setStart(lat, lng, label) {
  startCoords = [lng, lat]; // ORS expects [lng, lat]
  if (markerLayer) map.removeLayer(markerLayer);
  markerLayer = L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
  map.setView([lat, lng], 14);
}

// ── Generate 3 routes ─────────────────────────────────────────
document.getElementById("generate").addEventListener("click", generateRoutes);

async function generateRoutes() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  if (!startCoords) {
    const addrVal = document.getElementById("address").value.trim();
    if (addrVal) {
      await geocodeAddress();
      if (!startCoords) return;
    } else {
      return setStatus("Set a start — click the map, use your location, or type an address.", "error");
    }
  }

  const distanceMeters = parseFloat(slider.value) * 1000;
  const btn = document.getElementById("generate");
  btn.disabled = true;
  setStatus("Generating 3 routes...", "loading");

  // Clear previous routes
  clearRoutes();

  try {
    const pref = getPrefs();
    const fetcher = pref === "scenic"
      ? (cfg, i) => fetchScenicRoute(apiKey, startCoords, distanceMeters, i)
      : (cfg)    => fetchRoute(apiKey, startCoords, distanceMeters, cfg);

    const results = await Promise.all(ROUTE_CONFIGS.map(fetcher));

    routeData = results;

    // Draw all routes (unselected state)
    results.forEach((geojson, i) => {
      const cfg = ROUTE_CONFIGS[i];
      const layer = L.geoJSON(geojson, {
        style: { color: cfg.color, weight: 4, opacity: 0.6 },
        onEachFeature: (_, leafletLayer) => {
          leafletLayer.on("click", () => selectRoute(i));
        },
      }).addTo(map);
      routeLayers.push(layer);
    });

    // Fit map to all routes
    const allBounds = routeLayers.map((l) => l.getBounds());
    const combined = allBounds.reduce((acc, b) => acc.extend(b));
    map.fitBounds(combined, { padding: [40, 40] });

    // Build route cards
    renderRouteCards(results);

    setStatus("Click a route on the map or in the list to select it.");
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

async function fetchRoute(apiKey, coords, distanceMeters, cfg) {
  const body = {
    coordinates: [coords],
    options: {
      round_trip: { length: distanceMeters, points: cfg.points, seed: cfg.seed },
    },
    units: "km",
    elevation: true,
    instructions: false,
  };
  return orsPost("foot-walking", body, apiKey, cfg.name);
}

// Scenic routes use explicit canal/park waypoints to guarantee passing through them.
// variant 0 → canal only (simple loop via nearest canal stretch)
// variant 1 → two canal points (longer canal coverage)
// variant 2 → canal entry + green area (mixed scenic)
//
// Distance correction: straight-line distance underestimates actual walking distance
// by ~35% in Ottawa (streets, detours around buildings, path curves). We divide the
// target half-distance by URBAN_FACTOR when placing waypoints, then do one retry if
// the first attempt is still >15% off the requested distance.
async function fetchScenicRoute(apiKey, startCoords, distanceMeters, variant) {
  const URBAN_FACTOR = 1.35;
  const label = `Scenic ${variant + 1}`;

  const buildWaypoints = (scale) => {
    const half = (distanceMeters / 2 / URBAN_FACTOR) * scale;
    if (variant === 0) {
      // South canal entry + north canal exit → forces traversing the canal length
      const wpS = nearestAtDist(startCoords, CANAL_SOUTH, half * 0.7);
      const wpN = nearestAtDist(startCoords, CANAL_NORTH, half * 1.3);
      return [startCoords, wpS, wpN, startCoords];
    } else if (variant === 1) {
      // Canal entry + green area → guaranteed different geography from variant 0
      const canalWp = nearestAtDist(startCoords, RIDEAU_CANAL, half * 0.8);
      const greenWp = nearestAtDist(startCoords, GREEN_AREAS, half * 1.2);
      return [startCoords, canalWp, greenWp, startCoords];
    } else {
      // Two green areas (no canal) → visually distinct from both A and B
      const green1 = nearestAtDist(startCoords, GREEN_AREAS, half * 0.7);
      const green2 = nearestAtDist(startCoords, GREEN_AREAS, half * 1.3, [green1]);
      return [startCoords, green1, green2, startCoords];
    }
  };

  const fetch1 = await orsPost("foot-hiking",
    { coordinates: buildWaypoints(1.0), units: "km", elevation: true, instructions: false },
    apiKey, label);

  // If actual distance is >15% off, scale waypoint distances by the error ratio and retry once.
  const actualM = (fetch1.features?.[0]?.properties?.summary?.distance ?? 0) * 1000;
  const ratio = actualM > 0 ? distanceMeters / actualM : 1;
  if (Math.abs(ratio - 1) <= 0.15) return fetch1;

  return orsPost("foot-hiking",
    { coordinates: buildWaypoints(ratio), units: "km", elevation: true, instructions: false },
    apiKey, label);
}

// Find the point in `pool` whose straight-line distance from `from` is closest
// to `targetM` metres, excluding any points in `exclude`.
function nearestAtDist(from, pool, targetM, exclude = []) {
  const available = pool.filter(
    (p) => !exclude.some((e) => e[0] === p[0] && e[1] === p[1])
  );
  return available.reduce((best, p) => {
    const d = haversine(from[1], from[0], p[1], p[0]);
    const bd = haversine(from[1], from[0], best[1], best[0]);
    return Math.abs(d - targetM) < Math.abs(bd - targetM) ? p : best;
  });
}

async function orsPost(profile, body, apiKey, label) {
  const res = await fetch(`${ORS_BASE}/directions/${profile}/geojson`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status} (${label})`);
  }
  return res.json();
}

// ── Route selection ───────────────────────────────────────────
function selectRoute(index) {
  selectedIndex = index;

  // Update layer styles
  routeLayers.forEach((layer, i) => {
    layer.setStyle({
      weight: i === index ? 6 : 3,
      opacity: i === index ? 1 : 0.3,
    });
    if (i === index) layer.bringToFront();
  });

  // Update cards (rebuild to reflect selection + any preference state)
  if (routeData.length) buildCards(routeData);

  // Show stats
  const geojson = routeData[index];
  const props = geojson.features?.[0]?.properties?.summary;
  if (props) {
    document.getElementById("info-distance").textContent = `${props.distance.toFixed(2)} km`;
    document.getElementById("info-duration").textContent = formatDuration(props.duration);
    const ascent = geojson.features?.[0]?.properties?.ascent;
    document.getElementById("info-ascent").textContent =
      ascent != null ? `${Math.round(ascent)} m` : "—";
    document.getElementById("selected-info").classList.remove("hidden");
  }

  // Show elevation chart
  showElevationChart(geojson, index);
  setStatus(`${ROUTE_CONFIGS[index].name} selected.`);
}

// ── Route scoring ─────────────────────────────────────────────
function scoreRoute(geojson) {
  const feat = geojson.features?.[0];
  const coords = feat?.geometry?.coordinates ?? [];
  const ascent = feat?.properties?.ascent ?? 0;
  const dist = feat?.properties?.summary?.distance ?? 1;

  // Flatness: gain per km — lower is flatter
  const gainPerKm = ascent / dist;
  const flat =
    gainPerKm < 5  ? { label: "Flat",     emoji: "〰️", score: 3 } :
    gainPerKm < 15 ? { label: "Moderate", emoji: "🏃", score: 2 } :
                     { label: "Hilly",    emoji: "⛰️", score: 1 };

  // Scenic: % of route points within 600 m of a scenic landmark
  const scenicFrac = sampleFraction(coords, SCENIC_POINTS, 600);
  const scenic =
    scenicFrac > 0.25 ? { label: "Scenic",      emoji: "🏞️", score: 3 } :
    scenicFrac > 0.08 ? { label: "Some views",  emoji: "🌳", score: 2 } :
                        { label: "Urban",        emoji: "🏙️", score: 1 };

  // Safety: % of route points within 500 m of a known safe corridor
  const safeFrac = sampleFraction(coords, SAFE_CORRIDORS, 500);
  const safe =
    safeFrac > 0.35 ? { label: "Safe corridor", emoji: "✅", score: 3 } :
    safeFrac > 0.12 ? { label: "Mixed areas",   emoji: "⚠️", score: 2 } :
                      { label: "Check area",    emoji: "🔶", score: 1 };

  return { flat, scenic, safe };
}

function sampleFraction(coords, points, radiusM) {
  // Sample every 10th coord for performance
  const sampled = coords.filter((_, i) => i % 10 === 0);
  if (!sampled.length) return 0;
  const nearby = sampled.filter((c) =>
    points.some((p) => haversine(c[1], c[0], p[1], p[0]) < radiusM)
  );
  return nearby.length / sampled.length;
}

function getPrefs() {
  return document.querySelector('input[name="pref"]:checked')?.value ?? "any";
}

function bestMatchIndex(scores) {
  const pref = getPrefs();
  if (pref === "any") return -1;
  const key = pref; // "scenic" | "flat" | "safe"
  const best = scores.reduce((bestI, s, i) =>
    s[key].score > scores[bestI][key].score ? i : bestI, 0);
  return best;
}

// ── Route cards ───────────────────────────────────────────────
let routeScores = [];

function renderRouteCards(results) {
  routeScores = results.map(scoreRoute);
  buildCards(results);

  // Re-render cards when preference radio changes
  document.querySelectorAll('input[name="pref"]').forEach((el) =>
    el.addEventListener("change", () => buildCards(results))
  );
}

function buildCards(results) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";
  const best = bestMatchIndex(routeScores);

  results.forEach((geojson, i) => {
    const cfg = ROUTE_CONFIGS[i];
    const props = geojson.features?.[0]?.properties?.summary;
    const ascent = geojson.features?.[0]?.properties?.ascent;
    const s = routeScores[i];

    const stats = props
      ? `${props.distance.toFixed(1)} km · ${formatDuration(props.duration)}${ascent != null ? ` · ↑${Math.round(ascent)}m` : ""}`
      : cfg.name;

    const pref = getPrefs();

    // Build badges — highlight the active preference's badge when it scores well
    const badges = [
      { data: s.scenic, key: "scenic" },
      { data: s.flat,   key: "flat"   },
      { data: s.safe,   key: "safe"   },
    ].map(({ data, key }) =>
      `<span class="badge${pref === key && data.score === 3 ? " match" : ""}">${data.emoji} ${data.label}</span>`
    ).join("");

    const bestBanner = pref !== "any" && i === best
      ? `<span class="best-match-banner">⭐ Best match</span>`
      : "";

    const card = document.createElement("div");
    card.className = "route-card" + (i === selectedIndex ? " selected" : "");
    card.style.setProperty("--route-color", cfg.color);
    card.innerHTML = `
      <div class="route-dot" style="background:${cfg.color}"></div>
      <div class="route-card-info">
        <span class="route-name">${cfg.name}</span>
        <span class="route-stats">${stats}</span>
        <div class="route-badges">${badges}</div>
        ${bestBanner}
      </div>`;
    card.addEventListener("click", () => selectRoute(i));
    container.appendChild(card);
  });

  container.classList.remove("hidden");
}

// ── Elevation chart ───────────────────────────────────────────
function showElevationChart(geojson, index) {
  const coords = geojson.features?.[0]?.geometry?.coordinates;
  if (!coords?.length) return;

  const cfg = ROUTE_CONFIGS[index];
  const panel = document.getElementById("elevation-panel");
  panel.classList.remove("hidden");
  map.invalidateSize();
  document.getElementById("elevation-title").textContent =
    `${cfg.name} — Elevation Profile`;

  // Build cumulative distance + elevation arrays
  let cumDist = 0;
  const distances = [0];
  const elevations = [coords[0][2] ?? 0];

  for (let i = 1; i < coords.length; i++) {
    cumDist += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    distances.push(+(cumDist / 1000).toFixed(3));
    elevations.push(coords[i][2] ?? 0);
  }

  // Downsample if > 500 points (keeps chart snappy)
  const MAX_POINTS = 500;
  const step = Math.max(1, Math.floor(distances.length / MAX_POINTS));
  const xData = distances.filter((_, i) => i % step === 0);
  const yData = elevations.filter((_, i) => i % step === 0);

  if (elevationChart) elevationChart.destroy();

  const ctx = document.getElementById("elevation-chart").getContext("2d");
  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: xData,
      datasets: [{
        data: yData,
        borderColor: cfg.color,
        backgroundColor: cfg.color + "33",
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Distance (km)", font: { size: 11 } },
          ticks: { font: { size: 10 }, maxTicksLimit: 8 },
        },
        y: {
          title: { display: true, text: "Elevation (m)", font: { size: 11 } },
          ticks: { font: { size: 10 }, maxTicksLimit: 6 },
        },
      },
    },
  });
}

document.getElementById("elevation-close").addEventListener("click", () => {
  document.getElementById("elevation-panel").classList.add("hidden");
  if (elevationChart) { elevationChart.destroy(); elevationChart = null; }
  map.invalidateSize();
});

// ── Helpers ───────────────────────────────────────────────────
function clearRoutes() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];
  routeData = [];
  selectedIndex = null;
  document.getElementById("route-cards").classList.add("hidden");
  document.getElementById("selected-info").classList.add("hidden");
  document.getElementById("elevation-panel").classList.add("hidden");
  if (elevationChart) { elevationChart.destroy(); elevationChart = null; }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function getApiKey() {
  const key = document.getElementById("api-key").value.trim();
  if (!key) {
    setStatus("Paste your OpenRouteService API key at the bottom.", "error");
    return null;
  }
  return key;
}

function setStatus(msg, type = "") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = type;
}

setStatus("Click the map or type an address to set your start point.");

// Fix Leaflet gray area: re-measure after layout is fully painted
window.addEventListener("load", () => map.invalidateSize());
