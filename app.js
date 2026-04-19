const OTTAWA_CENTER = [45.4215, -75.6972];
const ORS_BASE      = "https://api.openrouteservice.org/v2";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ── Ottawa geography ──────────────────────────────────────────
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

const CANAL_LABELS = [
  "Dow's Lake", "Carling Ave bridge", "Bronson Ave", "Glebe entry",
  "Fifth Ave bridge", "Pretoria Bridge", "Bank St bridge",
  "Hartwell Locks", "Laurier Ave bridge", "Plaza Bridge", "Ottawa Locks",
];

// Green areas covering all of Ottawa and Gatineau — not just downtown
const GREEN_AREAS = [
  // Central / Downtown
  [-75.7150, 45.3850], // Vincent Massey Park
  [-75.6986, 45.3756], // Hog's Back Falls
  [-75.6936, 45.4272], // Major's Hill Park
  [-75.6620, 45.4170], // Strathcona Park
  [-75.7400, 45.3950], // Central Experimental Farm
  [-75.6700, 45.4000], // Rideau River east pathway
  [-75.6500, 45.4050], // Rideau River south path
  // West Ottawa
  [-75.7650, 45.4040], // Britannia Park
  [-75.8100, 45.3620], // Andrew Haydon Park
  [-75.8700, 45.3400], // Jack Pine Trail / NCC Greenbelt west
  [-75.9100, 45.3200], // Kanata Lakes / Beaver Pond
  [-75.8800, 45.3900], // Shirley's Bay NCC area
  [-75.8300, 45.3500], // NCC Greenbelt (Pinecrest)
  // East Ottawa / Orléans
  [-75.4900, 45.4800], // Petrie Island
  [-75.5200, 45.4400], // Jeanne d'Arc corridor
  [-75.5500, 45.3800], // NCC Greenbelt east
  [-75.5800, 45.4200], // Orléans waterfront / Rideau River east
  // South Ottawa / Barrhaven
  [-75.7360, 45.2800], // Walter Baker Park
  [-75.7600, 45.2700], // Chapman Mills Conservation Area
  [-75.7100, 45.3200], // NCC Greenbelt south
  [-75.6800, 45.3100], // Rideau River south corridor
  // Gatineau / North
  [-75.7200, 45.4320], // Ottawa River NCC pathway (downtown)
  [-75.7700, 45.4200], // Ottawa River NCC pathway (west)
  [-75.7000, 45.4400], // Leamy Lake Park, Gatineau
  [-75.7100, 45.4350], // Jacques-Cartier Park, Gatineau
  [-75.8200, 45.5000], // Gatineau Park main entrance
  [-75.8500, 45.4800], // Gatineau Park (Lac Meech sector)
  [-75.9500, 45.4600], // Gatineau Park (Cheltenham sector)
];

const GREEN_AREA_LABELS = [
  // Central
  "Vincent Massey Park", "Hog's Back Falls", "Major's Hill Park",
  "Strathcona Park", "Central Experimental Farm",
  "Rideau River pathway", "Rideau River south path",
  // West
  "Britannia Park", "Andrew Haydon Park",
  "Jack Pine Trail", "Kanata Lakes / Beaver Pond",
  "Shirley's Bay NCC", "NCC Greenbelt (Pinecrest)",
  // East
  "Petrie Island", "Jeanne d'Arc corridor",
  "NCC Greenbelt east", "Orléans riverside path",
  // South
  "Walter Baker Park", "Chapman Mills Conservation Area",
  "NCC Greenbelt south", "Rideau River south corridor",
  // Gatineau / North
  "Ottawa River NCC pathway", "Ottawa River pathway (west)",
  "Leamy Lake Park", "Jacques-Cartier Park",
  "Gatineau Park entrance", "Gatineau Park (Lac Meech)",
  "Gatineau Park (Cheltenham)",
];

const CANAL_SOUTH = RIDEAU_CANAL.slice(0, 5); // Dow's Lake → Fifth Ave bridge
const CANAL_NORTH = RIDEAU_CANAL.slice(5);    // Pretoria Bridge → Ottawa Locks

// Combined pool for proximity searches
const ALL_SCENIC = [...RIDEAU_CANAL, ...GREEN_AREAS];

const ROUTE_CONFIGS = [
  { name: "Route A", color: "#2563eb", seed: 1,  points: 3 },
  { name: "Route B", color: "#16a34a", seed: 50, points: 5 },
  { name: "Route C", color: "#ea580c", seed: 99, points: 7 },
];

// ── State ─────────────────────────────────────────────────────
let map, markerLayer;
let routeLayers  = [];
let routeData    = [];
let selectedIndex = null;
let elevationChart = null;

// ── Map init ──────────────────────────────────────────────────
map = L.map("map").setView(OTTAWA_CENTER, 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

map.on("click", (e) => setStart(e.latlng.lat, e.latlng.lng, "Map pin"));
window.addEventListener("load", () => map.invalidateSize());

// ── Distance slider ───────────────────────────────────────────
const slider   = document.getElementById("distance-slider");
const distLabel = document.getElementById("distance-label");
slider.addEventListener("input", () => { distLabel.textContent = `${slider.value} km`; });

// ── Geolocation ───────────────────────────────────────────────
document.getElementById("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocation not supported.", "error");
  setStatus("Getting your location...", "loading");
  navigator.geolocation.getCurrentPosition(
    (pos) => { setStart(pos.coords.latitude, pos.coords.longitude, "Your location"); setStatus("Location set. Hit Generate Routes."); },
    ()    => setStatus("Could not get location. Try typing an address.", "error")
  );
});

// ── Geocoding (Nominatim) ─────────────────────────────────────
document.getElementById("address").addEventListener("keydown", (e) => { if (e.key === "Enter") geocodeAddress(); });
document.getElementById("geocode-btn").addEventListener("click", geocodeAddress);

let startCoords = null;

async function geocodeAddress() {
  const query = document.getElementById("address").value.trim();
  if (!query) return;
  setStatus("Looking up address...", "loading");
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(query + " Ottawa Ontario Canada")}` +
      `&format=json&limit=1&countrycodes=ca&addressdetails=0`;
    const res = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "OttawaRunRoutes/1.0" } });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = await res.json();
    if (!data.length) throw new Error("Address not found. Try a street number or landmark.");
    const { lat, lon, display_name } = data[0];
    setStart(parseFloat(lat), parseFloat(lon), display_name);
    document.getElementById("address").value = display_name.split(",").slice(0, 2).join(",");
    setStatus("Address found. Hit Generate Routes.");
  } catch (err) { setStatus(err.message, "error"); }
}

function setStart(lat, lng, label) {
  startCoords = [lng, lat];
  if (markerLayer) map.removeLayer(markerLayer);
  markerLayer = L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
  map.setView([lat, lng], 14);
}

// ── Generate routes ───────────────────────────────────────────
document.getElementById("generate").addEventListener("click", generateRoutes);

async function generateRoutes() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  if (!startCoords) {
    const addrVal = document.getElementById("address").value.trim();
    if (addrVal) { await geocodeAddress(); if (!startCoords) return; }
    else return setStatus("Set a start — click the map, use your location, or type an address.", "error");
  }

  const distanceMeters = parseFloat(slider.value) * 1000;
  const btn = document.getElementById("generate");
  btn.disabled = true;
  setStatus("Generating 3 routes...", "loading");
  clearRoutes();

  try {
    const pref = getPrefs();
    const fetcher = pref === "scenic"
      ? (_cfg, i) => fetchScenicRoute(apiKey, startCoords, distanceMeters, i)
      : (cfg)     => fetchRoute(apiKey, startCoords, distanceMeters, cfg);

    const results = await Promise.all(ROUTE_CONFIGS.map(fetcher));
    routeData = results;

    results.forEach((geojson, i) => {
      const layer = L.geoJSON(geojson, {
        style: { color: ROUTE_CONFIGS[i].color, weight: 4, opacity: 0.6 },
        onEachFeature: (_, l) => { l.on("click", () => selectRoute(i)); },
      }).addTo(map);
      routeLayers.push(layer);
    });

    const combined = routeLayers.map((l) => l.getBounds()).reduce((a, b) => a.extend(b));
    map.fitBounds(combined, { padding: [40, 40] });

    renderRouteCards(results);
    setStatus("Click a route on the map or in the list to select it.");

    // Descriptions generated in background — cards update as each comes in
    const anthropicKey = getAnthropicKey();
    if (anthropicKey) {
      results.forEach((geojson, i) => {
        describeRoute(geojson, anthropicKey).then((desc) => { if (desc) updateCardDescription(i, desc); });
      });
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ── ORS routing ───────────────────────────────────────────────
async function fetchRoute(apiKey, coords, distanceMeters, cfg) {
  const body = {
    coordinates: [coords],
    options: { round_trip: { length: distanceMeters, points: cfg.points, seed: cfg.seed } },
    units: "km", elevation: true, instructions: false,
  };
  return orsPost("foot-walking", body, apiKey, cfg.name);
}

async function fetchScenicRoute(apiKey, startCoords, distanceMeters, variant) {
  const URBAN_FACTOR = 1.35;

  // Max straight-line reach: a waypoint further than this can't form a loop
  // within the target distance (it would consume more than half the budget one-way).
  const maxReach = distanceMeters / (2 * URBAN_FACTOR);

  // Ideal straight-line distance for each leg of a 3-point triangle:
  // total_walked ≈ URBAN_FACTOR × (leg1 + leg2 + leg3)
  // For an equilateral triangle: each leg ≈ D / (3 × URBAN_FACTOR)
  const idealDist = (scale) => (distanceMeters / (3 * URBAN_FACTOR)) * scale;

  // Filter a pool to points reachable from start within maxReach
  const reachable = (pool) =>
    pool.filter((p) => haversine(startCoords[1], startCoords[0], p[1], p[0]) <= maxReach);

  // Build waypoints for this variant, with the `scale` applied to idealDist for retries
  const buildWaypoints = (scale) => {
    const ideal = idealDist(scale);

    // Reachable sub-pools (computed once per call, not per scale)
    const rCanal  = reachable(RIDEAU_CANAL);
    const rSouth  = reachable(CANAL_SOUTH);
    const rNorth  = reachable(CANAL_NORTH);
    const rGreen  = reachable(GREEN_AREAS);
    // Fallback: everything reachable, sorted by distance so we always get something
    const rAll    = reachable(ALL_SCENIC);

    let wp1, wp2;

    if (variant === 0) {
      // Route A: south canal entry + north canal exit (traverses the canal length)
      // Falls back to nearest distinct scenic points if canal is out of range
      const poolA = rSouth.length ? rSouth : rCanal.length ? rCanal : rAll;
      const poolB = rNorth.length ? rNorth : rAll;
      wp1 = nearestAtDist(startCoords, poolA, ideal);
      wp2 = nearestAtDist(startCoords, poolB, ideal, [wp1]);
    } else if (variant === 1) {
      // Route B: nearest canal point + nearest green area
      const poolA = rCanal.length ? rCanal : rAll;
      const poolB = rGreen.length ? rGreen : rAll;
      wp1 = nearestAtDist(startCoords, poolA, ideal);
      wp2 = nearestAtDist(startCoords, poolB, ideal, [wp1]);
    } else {
      // Route C: two green areas (no canal) — visually distinct from A and B
      const pool = rGreen.length >= 2 ? rGreen : rAll;
      wp1 = nearestAtDist(startCoords, pool, ideal);
      wp2 = nearestAtDist(startCoords, pool, ideal, [wp1]);
    }

    return {
      waypoints: [startCoords, wp1, wp2, startCoords],
      desc: `${labelForPoint(wp1)} and ${labelForPoint(wp2)}`,
    };
  };

  const label = `Scenic ${variant + 1}`;
  const { waypoints, desc } = buildWaypoints(1.0);
  const fetch1 = await orsPost("foot-hiking",
    { coordinates: waypoints, units: "km", elevation: true, instructions: false },
    apiKey, label);

  // One retry if distance is >15% off: scale idealDist by the error ratio
  const actualM = (fetch1.features?.[0]?.properties?.summary?.distance ?? 0) * 1000;
  const ratio   = actualM > 0 ? distanceMeters / actualM : 1;
  const geojson = Math.abs(ratio - 1) <= 0.15 ? fetch1 : await orsPost("foot-hiking",
    { coordinates: buildWaypoints(ratio).waypoints, units: "km", elevation: true, instructions: false },
    apiKey, label);

  geojson._meta = { waypointDesc: desc };
  return geojson;
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

// ── Claude route description ──────────────────────────────────
async function describeRoute(geojson, anthropicKey) {
  const props      = geojson.features?.[0]?.properties;
  const dist       = props?.summary?.distance?.toFixed(1) ?? "?";
  const duration   = formatDuration(props?.summary?.duration ?? 0);
  const ascent     = Math.round(props?.ascent ?? 0);
  const gainPerKm  = (props?.ascent ?? 0) / (props?.summary?.distance ?? 1);
  const terrain    = gainPerKm < 5 ? "flat" : gainPerKm < 15 ? "moderately hilly" : "hilly";
  const landmarks  = geojson._meta?.waypointDesc ?? "urban streets";

  const prompt =
    `Describe this Ottawa running route in ONE sentence, max 20 words. Name specific landmarks. No filler.\n\n` +
    `Distance: ${dist} km | Time: ${duration} | Gain: ${ascent}m | Terrain: ${terrain}\n` +
    `Passes through: ${landmarks}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 80,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}

// ── Route cards ───────────────────────────────────────────────
function renderRouteCards(results) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";

  results.forEach((geojson, i) => {
    const cfg   = ROUTE_CONFIGS[i];
    const props = geojson.features?.[0]?.properties?.summary;
    const ascent = geojson.features?.[0]?.properties?.ascent;
    const stats  = props
      ? `${props.distance.toFixed(1)} km · ${formatDuration(props.duration)}${ascent != null ? ` · ↑${Math.round(ascent)}m` : ""}`
      : cfg.name;

    const card = document.createElement("div");
    card.className = "route-card" + (i === selectedIndex ? " selected" : "");
    card.style.setProperty("--route-color", cfg.color);
    card.innerHTML = `
      <div class="route-dot" style="background:${cfg.color}"></div>
      <div class="route-card-info">
        <span class="route-name">${cfg.name}</span>
        <span class="route-stats">${stats}</span>
        <span class="route-desc loading">Generating description…</span>
      </div>`;
    card.addEventListener("click", () => selectRoute(i));
    container.appendChild(card);
  });

  container.classList.remove("hidden");
}

function updateCardDescription(index, desc) {
  const descEl = document.querySelectorAll(".route-card")[index]?.querySelector(".route-desc");
  if (descEl) { descEl.textContent = desc; descEl.classList.remove("loading"); }
}

// ── Route selection ───────────────────────────────────────────
function selectRoute(index) {
  selectedIndex = index;

  routeLayers.forEach((layer, i) => {
    layer.setStyle({ weight: i === index ? 6 : 3, opacity: i === index ? 1 : 0.3 });
    if (i === index) layer.bringToFront();
  });

  document.querySelectorAll(".route-card").forEach((card, i) =>
    card.classList.toggle("selected", i === index));

  const geojson = routeData[index];
  const props   = geojson.features?.[0]?.properties?.summary;
  if (props) {
    document.getElementById("info-distance").textContent = `${props.distance.toFixed(2)} km`;
    document.getElementById("info-duration").textContent = formatDuration(props.duration);
    const ascent = geojson.features?.[0]?.properties?.ascent;
    document.getElementById("info-ascent").textContent = ascent != null ? `${Math.round(ascent)} m` : "—";
    document.getElementById("selected-info").classList.remove("hidden");
  }

  showElevationChart(geojson, index);
  setStatus(`${ROUTE_CONFIGS[index].name} selected.`);
}

// ── Elevation chart ───────────────────────────────────────────
function showElevationChart(geojson, index) {
  const coords = geojson.features?.[0]?.geometry?.coordinates;
  if (!coords?.length) return;

  const cfg   = ROUTE_CONFIGS[index];
  const panel = document.getElementById("elevation-panel");
  panel.classList.remove("hidden");
  map.invalidateSize();
  document.getElementById("elevation-title").textContent = `${cfg.name} — Elevation Profile`;

  let cumDist = 0;
  const distances  = [0];
  const elevations = [coords[0][2] ?? 0];
  for (let i = 1; i < coords.length; i++) {
    cumDist += haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
    distances.push(+(cumDist / 1000).toFixed(3));
    elevations.push(coords[i][2] ?? 0);
  }

  const step  = Math.max(1, Math.floor(distances.length / 500));
  const xData = distances.filter((_, i) => i % step === 0);
  const yData = elevations.filter((_, i) => i % step === 0);

  if (elevationChart) elevationChart.destroy();
  elevationChart = new Chart(
    document.getElementById("elevation-chart").getContext("2d"), {
      type: "line",
      data: { labels: xData, datasets: [{ data: yData, borderColor: cfg.color,
        backgroundColor: cfg.color + "33", borderWidth: 2, fill: true, pointRadius: 0, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Distance (km)", font: { size: 11 } }, ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
          y: { title: { display: true, text: "Elevation (m)", font: { size: 11 } }, ticks: { font: { size: 10 }, maxTicksLimit: 6 } },
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
  routeLayers = []; routeData = []; selectedIndex = null;
  document.getElementById("route-cards").classList.add("hidden");
  document.getElementById("selected-info").classList.add("hidden");
  document.getElementById("elevation-panel").classList.add("hidden");
  if (elevationChart) { elevationChart.destroy(); elevationChart = null; }
}

function nearestAtDist(from, pool, targetM, exclude = []) {
  const available = pool.filter((p) => !exclude.some((e) => e[0] === p[0] && e[1] === p[1]));
  return available.reduce((best, p) => {
    const d  = haversine(from[1], from[0], p[1], p[0]);
    const bd = haversine(from[1], from[0], best[1], best[0]);
    return Math.abs(d - targetM) < Math.abs(bd - targetM) ? p : best;
  });
}

function labelForGreen(coords) {
  const idx = GREEN_AREAS.findIndex((p) => p[0] === coords[0] && p[1] === coords[1]);
  return idx >= 0 ? GREEN_AREA_LABELS[idx] : "green area";
}

function labelForPoint(coords) {
  const ci = RIDEAU_CANAL.findIndex((p) => p[0] === coords[0] && p[1] === coords[1]);
  if (ci >= 0) return CANAL_LABELS[ci];
  return labelForGreen(coords);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function getPrefs() {
  return document.querySelector('input[name="pref"]:checked')?.value ?? "any";
}

function getApiKey() {
  const key = document.getElementById("api-key").value.trim();
  if (!key) { setStatus("Paste your OpenRouteService API key at the bottom.", "error"); return null; }
  return key;
}

function getAnthropicKey() {
  return document.getElementById("anthropic-key").value.trim() || null;
}

function setStatus(msg, type = "") {
  const el = document.getElementById("status");
  el.textContent = msg; el.className = type;
}

setStatus("Click the map or type an address to set your start point.");
