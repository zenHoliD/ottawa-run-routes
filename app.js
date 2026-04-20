const OTTAWA_CENTER = [45.4215, -75.6972];
const ORS_BASE      = "https://api.openrouteservice.org/v2";
const ORS_KEY       = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImY2NDU4Y2ZhM2UwZTRhNzY5ZDUyN2U1NDAzNmRjYWE1IiwiaCI6Im11cm11cjY0In0=";

const ROUTE_CONFIGS = [
  { name: "Route A", color: "#2563eb", seed: 1,  points: 3 },
  { name: "Route B", color: "#16a34a", seed: 50, points: 5 },
  { name: "Route C", color: "#ea580c", seed: 99, points: 7 },
];

// ── State ─────────────────────────────────────────────────────
let map, markerLayer;
let routeLayers    = [];
let routeData      = [];
let selectedIndex  = null;
let elevationChart = null;
let deferredInstallPrompt = null;

// ── Map init ──────────────────────────────────────────────────
map = L.map("map").setView(OTTAWA_CENTER, 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

map.on("click", (e) => setStart(e.latlng.lat, e.latlng.lng, "Map pin"));
window.addEventListener("load", () => map.invalidateSize());

// ── Distance slider ───────────────────────────────────────────
const slider    = document.getElementById("distance-slider");
const distLabel = document.getElementById("distance-label");
function updateDistLabel() {
  const km  = parseFloat(slider.value);
  const min = Math.round(km / 5.5 * 60);
  const h   = Math.floor(min / 60), m = min % 60;
  const time = h > 0 ? `${h}h ${m}m` : `${min} min`;
  distLabel.textContent = `${slider.value} km · ~${time}`;
}
slider.addEventListener("input", updateDistLabel);
updateDistLabel();

// ── Geolocation ───────────────────────────────────────────────
document.getElementById("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Geolocation not supported.", "error");
  setStatus("Getting your location…", "loading");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setStart(pos.coords.latitude, pos.coords.longitude, "Your location");
      setStatus("Location set. Hit Generate Routes.");
    },
    (err) => {
      const msg = err.code === 1
        ? "Location access denied. Enable it in your browser settings."
        : "Could not get location. Try typing an address.";
      setStatus(msg, "error");
    }
  );
});

// ── Geocoding (Nominatim) ─────────────────────────────────────
document.getElementById("address").addEventListener("keydown", (e) => { if (e.key === "Enter") geocodeAddress(); });
document.getElementById("geocode-btn").addEventListener("click", geocodeAddress);

let startCoords = null;

async function geocodeAddress() {
  const query = document.getElementById("address").value.trim();
  if (!query) return;
  setStatus("Looking up address…", "loading");
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

// ── New search (mobile) ───────────────────────────────────────
document.getElementById("new-search-btn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("routes-mode");
  document.getElementById("new-search-btn").classList.add("hidden");
  clearRoutes();
  setStatus("Update your start or distance, then generate again.");
});

// ── Generate routes ───────────────────────────────────────────
document.getElementById("generate").addEventListener("click", generateRoutes);

async function generateRoutes() {
  if (!startCoords) {
    const addrVal = document.getElementById("address").value.trim();
    if (addrVal) { await geocodeAddress(); if (!startCoords) return; }
    else return setStatus("Set a start — click the map, use your location, or type an address.", "error");
  }

  document.getElementById("sidebar").classList.remove("routes-mode");
  document.getElementById("new-search-btn").classList.add("hidden");

  const distanceMeters = parseFloat(slider.value) * 1000;
  const btn = document.getElementById("generate");
  btn.disabled = true;
  setStatus("Generating 3 routes…", "loading");
  clearRoutes();

  try {
    const pref = getPrefs();
    const fetcher = pref === "scenic"
      ? (_cfg, i) => fetchScenicRoute(startCoords, distanceMeters, i)
      : (cfg)     => fetchRoute(startCoords, distanceMeters, cfg);

    const results = await Promise.all(ROUTE_CONFIGS.map(fetcher));
    routeData = results;

    results.forEach((geojson, i) => {
      const layer = L.geoJSON(geojson, {
        style: { color: ROUTE_CONFIGS[i].color, weight: 4, opacity: 0.6 },
        onEachFeature: (_, l) => {
          l.on("click", (e) => { L.DomEvent.stopPropagation(e); selectRoute(i); });
        },
      }).addTo(map);
      routeLayers.push(layer);
    });

    const combined = routeLayers.map((l) => l.getBounds()).reduce((a, b) => a.extend(b));
    map.fitBounds(combined, { padding: [40, 40] });

    renderRouteCards(results);
    selectRoute(0); // also sets status

    if (window.innerWidth <= 640) {
      document.getElementById("sidebar").classList.add("routes-mode");
      document.getElementById("new-search-btn").classList.remove("hidden");
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ── ORS routing ───────────────────────────────────────────────
async function fetchWithTolerance(profile, baseBody, distanceMeters, baseSeed, label) {
  const TOLERANCE = 0.05;
  let best = null, bestDelta = Infinity, lastErr = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const body = {
      ...baseBody,
      options: { round_trip: { ...baseBody.options.round_trip, seed: baseSeed + attempt * 31 } },
    };
    try {
      const geojson = await orsPost(profile, body, label);
      const actual  = (geojson.features?.[0]?.properties?.summary?.distance ?? 0) * 1000;
      const delta   = Math.abs(actual - distanceMeters) / distanceMeters;
      if (delta <= TOLERANCE) return geojson;
      if (delta < bestDelta) { best = geojson; bestDelta = delta; }
    } catch (err) { lastErr = err; }
  }

  if (!best) throw lastErr ?? new Error(`Could not generate route (${label})`);
  return best;
}

async function fetchRoute(coords, distanceMeters, cfg) {
  const body = {
    coordinates: [coords],
    options: { round_trip: { length: distanceMeters, points: cfg.points, seed: cfg.seed } },
    units: "km", elevation: true, instructions: false,
  };
  return fetchWithTolerance("foot-walking", body, distanceMeters, cfg.seed, cfg.name);
}

async function fetchScenicRoute(coords, distanceMeters, variant) {
  const cfg = ROUTE_CONFIGS[variant];
  const body = {
    coordinates: [coords],
    options: { round_trip: { length: distanceMeters, points: cfg.points, seed: cfg.seed } },
    units: "km", elevation: true, instructions: false,
  };
  return fetchWithTolerance("foot-walking", body, distanceMeters, cfg.seed, cfg.name);
}

async function orsPost(profile, body, label) {
  const res = await fetch(`${ORS_BASE}/directions/${profile}/geojson`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ORS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status} (${label})`);
  }
  return res.json();
}

// ── Route cards ───────────────────────────────────────────────
function renderRouteCards(results) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";

  results.forEach((geojson, i) => {
    const cfg    = ROUTE_CONFIGS[i];
    const props  = geojson.features?.[0]?.properties?.summary;
    const ascent = geojson.features?.[0]?.properties?.ascent;
    const stats  = props
      ? `${props.distance.toFixed(1)} km · ${formatDuration(props.duration)}${ascent != null ? ` · ↑${Math.round(ascent)}m` : ""}`
      : cfg.name;

    const card = document.createElement("div");
    card.className = "route-card" + (i === selectedIndex ? " selected" : "");
    card.style.setProperty("--route-color", cfg.color);
    card.setAttribute("role", "listitem");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${cfg.name}: ${stats}`);
    card.innerHTML = `
      <div class="route-dot" aria-hidden="true" style="background:${cfg.color}"></div>
      <div class="route-card-info">
        <span class="route-name">${cfg.name}</span>
        <span class="route-stats">${stats}</span>
      </div>`;
    card.addEventListener("click", () => selectRoute(i));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRoute(i); } });
    container.appendChild(card);
  });

  container.classList.remove("hidden");
}

// ── Route selection ───────────────────────────────────────────
function selectRoute(index) {
  selectedIndex = index;

  routeLayers.forEach((layer, i) => {
    layer.setStyle({ weight: i === index ? 6 : 3, opacity: i === index ? 1 : 0.3 });
    if (i === index) layer.bringToFront();
  });

  document.querySelectorAll(".route-card").forEach((card, i) => {
    card.classList.toggle("selected", i === index);
    card.setAttribute("aria-selected", String(i === index));
  });

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
      data: {
        labels: xData,
        datasets: [{ data: yData, borderColor: cfg.color, backgroundColor: cfg.color + "33",
          borderWidth: 2, fill: true, pointRadius: 0, tension: 0.3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Distance (km)", font: { size: 11 } }, ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
          y: { title: { display: true, text: "Elevation (m)",  font: { size: 11 } }, ticks: { font: { size: 10 }, maxTicksLimit: 6 } },
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

function setStatus(msg, type = "") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = type;
}

// ── PWA install prompt ────────────────────────────────────────
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("install-btn").classList.remove("hidden");
});

document.getElementById("install-btn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === "accepted") {
    document.getElementById("install-btn").classList.add("hidden");
  }
  deferredInstallPrompt = null;
});

window.addEventListener("appinstalled", () => {
  document.getElementById("install-btn").classList.add("hidden");
  deferredInstallPrompt = null;
});

// ── Online / offline ──────────────────────────────────────────
window.addEventListener("offline", () => setStatus("You're offline. Route generation unavailable.", "error"));
window.addEventListener("online",  () => setStatus("Back online.", ""));

// ── Init ──────────────────────────────────────────────────────
setStatus("Click the map or type an address to set your start point.");
