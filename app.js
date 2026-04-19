const OTTAWA_CENTER = [45.4215, -75.6972];
const ORS_BASE = "https://api.openrouteservice.org/v2";

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
    const results = await Promise.all(
      ROUTE_CONFIGS.map((cfg) => fetchRoute(apiKey, startCoords, distanceMeters, cfg))
    );

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

  const res = await fetch(`${ORS_BASE}/directions/foot-walking/geojson`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status} for ${cfg.name}`);
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

  // Update cards
  document.querySelectorAll(".route-card").forEach((card, i) => {
    card.classList.toggle("selected", i === index);
  });

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

// ── Route cards ───────────────────────────────────────────────
function renderRouteCards(results) {
  const container = document.getElementById("route-cards");
  container.innerHTML = "";

  results.forEach((geojson, i) => {
    const cfg = ROUTE_CONFIGS[i];
    const props = geojson.features?.[0]?.properties?.summary;
    const ascent = geojson.features?.[0]?.properties?.ascent;

    const stats = props
      ? `${props.distance.toFixed(1)} km · ${formatDuration(props.duration)}${ascent != null ? ` · ↑${Math.round(ascent)}m` : ""}`
      : cfg.name;

    const card = document.createElement("div");
    card.className = "route-card";
    card.style.setProperty("--route-color", cfg.color);
    card.innerHTML = `
      <div class="route-dot" style="background:${cfg.color}"></div>
      <div class="route-card-info">
        <span class="route-name">${cfg.name}</span>
        <span class="route-stats">${stats}</span>
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
