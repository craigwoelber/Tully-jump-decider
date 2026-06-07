/* ===================================================
   Tully Jump Decider — app.js
   Pure vanilla JS, no dependencies
   =================================================== */

'use strict';

// ---- Constants ----

const KTHA_LAT = 35.3826;
const KTHA_LON = -86.2462;
const WINDS_ALOFT_STATION = 'BNA'; // Nashville — closest upper-air station
const YOUTUBE_VIDEO_ID = 'FbYeEsBNeIM'; // Tullahoma DZ live cam

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const NWS_HEADERS = {
  'User-Agent': 'tully-jump-decider/1.0 (craig.woelber@ramseysolutions.com)',
  'Accept': 'application/geo+json',
};

// ---- DOM refs ----

const verdictBanner  = document.getElementById('verdictBanner');
const verdictText    = document.getElementById('verdictText');
const verdictSub     = document.getElementById('verdictSub');
const updatedAtEl    = document.getElementById('updatedAt');
const refreshBtn     = document.getElementById('refreshBtn');
const errorBanner    = document.getElementById('errorBanner');
const youtubeContainer = document.getElementById('youtubeContainer');

// ---- Auto-refresh timer ----

let refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadWeather(), REFRESH_INTERVAL_MS);
}

// ---- Helpers ----

function degToCompass(deg) {
  if (deg == null || isNaN(deg)) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                 'S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function mpsToMph(mps) {
  return mps * 2.237;
}

function cToF(c) {
  return c * 9 / 5 + 32;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Parse an ISO8601 interval validTime string like
 * "2024-01-01T12:00:00+00:00/PT1H" and return the start Date.
 */
function parseValidTimeStart(validTime) {
  const isoStart = validTime.split('/')[0];
  return new Date(isoStart);
}

/**
 * Given NWS time-series values array, find the value valid for right now.
 * Each entry: { validTime: "...", value: number|null }
 * The interval tells us how long the value is valid for.
 */
function getCurrentValue(valuesArray) {
  if (!valuesArray || !valuesArray.length) return null;

  const now = Date.now();

  for (const entry of valuesArray) {
    const startDate = parseValidTimeStart(entry.validTime);
    const startMs   = startDate.getTime();

    // Parse duration from the interval part (e.g. PT1H, PT3H, PT6H)
    const durationStr = entry.validTime.split('/')[1] || 'PT1H';
    const durationMs  = parseISO8601Duration(durationStr);

    const endMs = startMs + durationMs;

    if (now >= startMs && now < endMs) {
      return entry.value;
    }
  }

  // If nothing matched exactly (data gap or stale), return the most-recent past value
  let best = null;
  let bestTime = -Infinity;
  for (const entry of valuesArray) {
    const startMs = parseValidTimeStart(entry.validTime).getTime();
    if (startMs <= now && startMs > bestTime) {
      bestTime = startMs;
      best = entry.value;
    }
  }
  return best;
}

/**
 * Parse ISO8601 duration string to milliseconds.
 * Supports: PT1H, PT3H, PT6H, P1D, etc.
 */
function parseISO8601Duration(dur) {
  const hoursMatch = dur.match(/(\d+)H/);
  const minsMatch  = dur.match(/(\d+)M/);
  const daysMatch  = dur.match(/P(\d+)D/);
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const mins  = minsMatch  ? parseInt(minsMatch[1],  10) : 0;
  const days  = daysMatch  ? parseInt(daysMatch[1],  10) : 0;
  return ((days * 24 + hours) * 60 + mins) * 60 * 1000;
}

// ---- Decision logic ----

function statusSurfaceWind(mph) {
  if (mph === null) return 'unavailable';
  if (mph < 12)  return 'good';
  if (mph <= 17) return 'caution';
  return 'nogo';
}

function statusAloft3k(kts) {
  if (kts === null) return 'unavailable';
  if (kts < 15)  return 'good';
  if (kts <= 25) return 'caution';
  return 'nogo';
}

function statusAloft6k(kts) {
  if (kts === null) return 'unavailable';
  if (kts < 20)  return 'good';
  if (kts <= 30) return 'caution';
  return 'nogo';
}

function statusAloft9k(kts) {
  if (kts === null) return 'unavailable';
  if (kts < 25)  return 'good';
  if (kts <= 35) return 'caution';
  return 'nogo';
}

function statusAloft12k(kts) {
  if (kts === null) return 'unavailable';
  if (kts < 30)  return 'good';
  if (kts <= 40) return 'caution';
  return 'nogo';
}

function statusSkyCover(pct, ceilingFt) {
  // A ceiling below jump altitude blocks skydiving regardless of coverage %
  if (ceilingFt != null && ceilingFt < 8000)  return 'nogo';
  if (ceilingFt != null && ceilingFt < 12000) return 'caution';
  if (pct === null) return 'unavailable';
  if (pct < 30)  return 'good';
  if (pct <= 60) return 'caution';
  return 'nogo';
}

function statusPrecip(pct) {
  if (pct === null) return 'unavailable';
  if (pct < 10)  return 'good';
  if (pct <= 25) return 'caution';
  return 'nogo';
}

function statusTemp(f) {
  if (f === null) return 'unavailable';
  if (f >= 45 && f <= 90)   return 'good';
  if ((f >= 35 && f < 45) || (f > 90 && f <= 100)) return 'caution';
  return 'nogo';
}

function computeVerdict(statuses) {
  const active = statuses.filter(s => s !== 'unavailable');
  if (!active.length) return { verdict: 'loading', sub: 'No data available' };

  const nogoCount    = active.filter(s => s === 'nogo').length;
  const cautionCount = active.filter(s => s === 'caution').length;

  if (nogoCount >= 1) {
    return { verdict: 'nogo', sub: `${nogoCount} no-go factor${nogoCount > 1 ? 's' : ''}` };
  }
  if (cautionCount >= 2) {
    return { verdict: 'caution', sub: `${cautionCount} caution factors` };
  }
  if (cautionCount === 1) {
    return { verdict: 'go', sub: '1 caution factor — conditions generally OK' };
  }
  return { verdict: 'go', sub: 'All factors look good — go jump!' };
}

// ---- UI update helpers ----

function setCard(id, value, unit, dir, status) {
  const card  = document.getElementById(`card-${id}`);
  const dot   = document.getElementById(`dot-${id}`);
  const valEl = document.getElementById(`val-${id}`);
  const dirEl = document.getElementById(`dir-${id}`);

  // Clear old status classes
  card.classList.remove('good', 'caution', 'nogo', 'unavailable');
  dot.classList.remove('good', 'caution', 'nogo', 'unavailable');

  card.classList.add(status);
  dot.classList.add(status);

  if (value === null || value === undefined) {
    valEl.textContent = '—';
    valEl.innerHTML = '&mdash;';
  } else {
    valEl.innerHTML = `${value}<span class="card-unit"> ${unit}</span>`;
  }

  if (dirEl) {
    dirEl.textContent = dir || '';
  }
}

function setVerdict(verdict, sub) {
  verdictBanner.classList.remove('go', 'caution', 'nogo', 'loading');

  if (verdict === 'go') {
    verdictBanner.classList.add('go');
    verdictText.textContent = 'GO';
    verdictSub.textContent = sub;
  } else if (verdict === 'caution') {
    verdictBanner.classList.add('caution');
    verdictText.textContent = 'CAUTION';
    verdictSub.textContent = sub;
  } else if (verdict === 'nogo') {
    verdictBanner.classList.add('nogo');
    verdictText.textContent = 'NO-GO';
    verdictSub.textContent = sub;
  } else {
    verdictBanner.classList.add('loading');
    verdictText.textContent = 'Loading…';
    verdictSub.textContent = sub || 'Fetching weather data';
  }
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.classList.remove('visible');
}

function setRefreshing(isRefreshing) {
  if (isRefreshing) {
    refreshBtn.disabled = true;
    refreshBtn.querySelector('.refresh-icon').textContent = '⟳';
    refreshBtn.classList.add('spinning');
  } else {
    refreshBtn.disabled = false;
    refreshBtn.querySelector('.refresh-icon').textContent = '↻';
    refreshBtn.classList.remove('spinning');
  }
}

// ---- NWS data fetch ----

function cloudLayersToSkyInfo(layers) {
  if (!layers || !layers.length) return { pct: 0, label: 'Clear', ceilingFt: null };

  const amountPct = { SKC: 0, CLR: 0, FEW: 12, SCT: 37, BKN: 75, OVC: 100 };
  let maxPct = 0;
  let maxLabel = 'Clear';
  let ceilingFt = null;

  for (const layer of layers) {
    const pct = amountPct[layer.amount] ?? 0;
    if (pct > maxPct) { maxPct = pct; maxLabel = layer.amount; }
    if ((layer.amount === 'BKN' || layer.amount === 'OVC') && layer.base?.value != null) {
      const ft = Math.round(layer.base.value * 3.28084);
      if (ceilingFt === null || ft < ceilingFt) ceilingFt = ft;
    }
  }

  return { pct: maxPct, label: maxLabel, ceilingFt };
}

async function fetchKTHAMetar() {
  const resp = await fetch(
    'https://api.weather.gov/stations/KTHA/observations/latest',
    { headers: NWS_HEADERS }
  );
  if (!resp.ok) throw new Error(`KTHA METAR: ${resp.status}`);
  const data = await resp.json();
  const props = data.properties;

  const windSpeedMps = props.windSpeed?.value;
  const windGustMps  = props.windGust?.value;
  const windDirDeg   = props.windDirection?.value;
  const tempC        = props.temperature?.value;
  const skyInfo      = cloudLayersToSkyInfo(props.cloudLayers || []);

  return {
    windSpeedMph: windSpeedMps != null ? Math.round(mpsToMph(windSpeedMps)) : null,
    windGustMph:  windGustMps  != null ? Math.round(mpsToMph(windGustMps))  : null,
    windDirDeg:   windDirDeg   != null ? Math.round(windDirDeg)              : null,
    windDirLabel: windDirDeg   != null ? degToCompass(windDirDeg)            : null,
    skyCoverPct:  skyInfo.pct,
    skyLabel:     skyInfo.label,
    ceilingFt:    skyInfo.ceilingFt,
    tempF:        tempC != null ? Math.round(cToF(tempC)) : null,
  };
}

async function fetchGridpointForecast() {
  const pointsResp = await fetch(
    `https://api.weather.gov/points/${KTHA_LAT},${KTHA_LON}`,
    { headers: NWS_HEADERS }
  );
  if (!pointsResp.ok) throw new Error(`NWS points API: ${pointsResp.status}`);
  const pointsData = await pointsResp.json();

  const gridUrl = pointsData.properties.forecastGridData;
  if (!gridUrl) throw new Error('NWS did not return forecastGridData URL');

  const gridResp = await fetch(gridUrl, { headers: NWS_HEADERS });
  if (!gridResp.ok) throw new Error(`NWS grid API: ${gridResp.status}`);
  const gridData = await gridResp.json();

  const precipPct = getCurrentValue(gridData.properties.probabilityOfPrecipitation?.values);
  return { precipPct: precipPct != null ? Math.round(precipPct) : null };
}

async function fetchNWSData() {
  const [metarResult, forecastResult] = await Promise.allSettled([
    fetchKTHAMetar(),
    fetchGridpointForecast(),
  ]);

  if (metarResult.status === 'rejected' && forecastResult.status === 'rejected') {
    throw new Error('Both KTHA METAR and NWS gridpoint failed');
  }

  const metar    = metarResult.status === 'fulfilled'    ? metarResult.value    : {};
  const forecast = forecastResult.status === 'fulfilled' ? forecastResult.value : {};

  return { ...metar, precipPct: forecast.precipPct ?? null };
}

// ---- AWC Winds Aloft fetch ----

/**
 * Parse a 4-char wind field from AWC text format.
 * Format: DDSS (or DDSS+TT / DDSS-TT)
 * Returns { dir: degrees, speed: knots } or null if calm/light-variable/unavailable.
 */
function parseWindField(field) {
  if (!field || field.length < 4) return null;

  // Take only the first 4 characters (DD + SS)
  const raw = field.slice(0, 4);

  if (raw === '9900') return { dir: null, speed: 0, label: 'Light & Variable' };
  if (raw === '0000') return { dir: null, speed: 0, label: 'Calm' };
  if (raw === '////') return null; // not available

  let dd = parseInt(raw.slice(0, 2), 10);
  let ss = parseInt(raw.slice(2, 4), 10);

  if (isNaN(dd) || isNaN(ss)) return null;

  let speed = ss;
  let dir   = dd * 10;

  // Speeds > 100 kts are encoded: add 50 to direction tens, subtract 100 from speed
  // e.g. DD=51, SS=05 → dir=(51-50)*10=10°, speed=05+100=105 kts
  if (dd > 36 && dd < 99) {
    dir   = (dd - 50) * 10;
    speed = ss + 100;
  }

  return { dir, speed, label: `${dir}° / ${speed} kts` };
}

async function fetchWindsAloft() {
  const url = 'https://aviationweather.gov/api/data/windtemp?level=lo&fcst=06&region=all&layout=false';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`AWC winds aloft: ${resp.status}`);

  const text = await resp.text();
  return parseWindsAloftText(text, WINDS_ALOFT_STATION);
}

/**
 * Parse the plain-text AWC winds aloft report.
 * Example line:
 *   BNA  9900 2714 2723+02 2725-07 274535-21 284845-35 285760-52
 * Columns: STN  3000  6000  9000  12000  18000  24000  30000  34000  39000
 *
 * The header line tells us the altitude columns.
 */
function parseWindsAloftText(text, station) {
  const lines = text.split('\n');

  // Find the header line that contains altitude columns
  // It looks like:  FT   3000  6000  9000  12000  18000  24000  30000  34000  39000
  let headerLine = null;
  let headerIdx  = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*FT\s+3000/.test(lines[i])) {
      headerLine = lines[i];
      headerIdx  = i;
      break;
    }
  }

  if (!headerLine) {
    throw new Error('AWC response: could not find altitude header line');
  }

  // Parse the header tokens to get the ordered list of altitudes in this report.
  // Header looks like:  FT   3000  6000  9000 12000 18000 24000 30000 34000 39000
  // Split on whitespace; skip the leading "FT" token.
  const headerTokens = headerLine.trim().split(/\s+/);
  // headerTokens[0] === 'FT', rest are altitude strings
  const orderedAlts = headerTokens.slice(1).map(t => parseInt(t, 10)).filter(n => !isNaN(n));

  // Find the station line
  const stationRe = new RegExp(`^${station}\\s+`, 'i');
  let stationLine = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (stationRe.test(lines[i])) {
      stationLine = lines[i];
      break;
    }
  }

  if (!stationLine) {
    throw new Error(`AWC response: station ${station} not found`);
  }

  // Parse data fields by splitting on whitespace.
  // The line is:  STN  F3000 F6000 F9000 F12000 [F18000 ...]
  // Wind fields may have a temp suffix like "2714+02" — parseWindField handles that.
  const parts = stationLine.trim().split(/\s+/);
  // parts[0] = station name, parts[1..] = wind fields in altitude order

  const fieldMap = {};
  for (let i = 0; i < orderedAlts.length; i++) {
    const alt   = orderedAlts[i];
    const field = parts[i + 1] || null; // +1 to skip station name
    if (field) fieldMap[alt] = field;
  }

  const result = {};
  for (const alt of [3000, 6000, 9000, 12000]) {
    result[alt] = parseWindField(fieldMap[alt] || null);
  }

  return result;
}

// ---- YouTube embed ----

function renderYoutube() {
  if (!YOUTUBE_VIDEO_ID) {
    youtubeContainer.innerHTML = `
      <div class="youtube-placeholder">
        <p>Live cam not configured.</p>
        <p style="margin-top:0.5rem">Set <code>YOUTUBE_VIDEO_ID</code> in <code>app.js</code>.</p>
      </div>`;
    return;
  }

  youtubeContainer.innerHTML = `
    <div class="youtube-embed-wrap">
      <iframe
        src="https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=0"
        title="Tullahoma DZ Live Cam"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>`;
}

// ---- Main load ----

async function loadWeather() {
  clearError();
  setRefreshing(true);
  setVerdict('loading', 'Fetching weather data…');

  // Reset all cards to unavailable
  const allCards = ['surfaceWind','skyCover','precip','temp','aloft3k','aloft6k','aloft9k','aloft12k'];
  for (const id of allCards) {
    setCard(id, null, '', '', 'unavailable');
  }

  let nwsData   = null;
  let aloftData = null;
  let nwsError  = null;
  let aloftError= null;

  // Fetch both in parallel
  const [nwsResult, aloftResult] = await Promise.allSettled([
    fetchNWSData(),
    fetchWindsAloft(),
  ]);

  if (nwsResult.status === 'fulfilled') {
    nwsData = nwsResult.value;
  } else {
    nwsError = nwsResult.reason?.message || 'NWS fetch failed';
    console.error('NWS error:', nwsResult.reason);
  }

  if (aloftResult.status === 'fulfilled') {
    aloftData = aloftResult.value;
  } else {
    aloftError = aloftResult.reason?.message || 'AWC fetch failed';
    console.error('AWC error:', aloftResult.reason);
  }

  // Show error if both failed
  if (nwsError && aloftError) {
    showError(`Unable to load weather data. NWS: ${nwsError}. AWC: ${aloftError}. Check your connection and try again.`);
  } else if (nwsError) {
    showError(`Surface weather unavailable (NWS): ${nwsError}`);
  } else if (aloftError) {
    showError(`Winds aloft unavailable (AWC): ${aloftError}`);
  }

  // ---- Surface cards ----

  let sw = null, sc = null, pp = null, tp = null;

  if (nwsData) {
    sw = statusSurfaceWind(nwsData.windSpeedMph);
    sc = statusSkyCover(nwsData.skyCoverPct, nwsData.ceilingFt);
    pp = statusPrecip(nwsData.precipPct);
    tp = statusTemp(nwsData.tempF);

    const gustStr   = nwsData.windGustMph ? ` · Gust ${nwsData.windGustMph}` : '';
    const windLabel = nwsData.windDirLabel
      ? `${nwsData.windDirLabel} (${nwsData.windDirDeg}°)${gustStr}`
      : '';

    setCard('surfaceWind',
      nwsData.windSpeedMph !== null ? nwsData.windSpeedMph : null,
      'mph', windLabel, sw);

    const ceilStr = nwsData.ceilingFt
      ? `Ceiling ${nwsData.ceilingFt.toLocaleString()} ft`
      : '';
    setCard('skyCover', nwsData.skyLabel || null, '', ceilStr, sc);

    setCard('precip',
      nwsData.precipPct !== null ? `${nwsData.precipPct}%` : null,
      '', '', pp);

    setCard('temp',
      nwsData.tempF !== null ? `${nwsData.tempF}°F` : null,
      '', '', tp);
  }

  // ---- Winds aloft cards ----

  let a3 = null, a6 = null, a9 = null, a12 = null;

  if (aloftData) {
    const fmt = (w) => {
      if (!w) return { val: null, dir: '' };
      if (w.label === 'Light & Variable') return { val: 0, dir: 'Light & Variable' };
      if (w.label === 'Calm')             return { val: 0, dir: 'Calm' };
      return {
        val: w.speed,
        dir: w.dir != null ? `${w.dir}° ${degToCompass(w.dir)}` : '',
      };
    };

    const w3  = aloftData[3000];
    const w6  = aloftData[6000];
    const w9  = aloftData[9000];
    const w12 = aloftData[12000];

    a3  = statusAloft3k (w3  ? w3.speed  : null);
    a6  = statusAloft6k (w6  ? w6.speed  : null);
    a9  = statusAloft9k (w9  ? w9.speed  : null);
    a12 = statusAloft12k(w12 ? w12.speed : null);

    const f3  = fmt(w3);
    const f6  = fmt(w6);
    const f9  = fmt(w9);
    const f12 = fmt(w12);

    setCard('aloft3k',  f3.val  !== null ? f3.val  : null, 'kts', f3.dir,  a3);
    setCard('aloft6k',  f6.val  !== null ? f6.val  : null, 'kts', f6.dir,  a6);
    setCard('aloft9k',  f9.val  !== null ? f9.val  : null, 'kts', f9.dir,  a9);
    setCard('aloft12k', f12.val !== null ? f12.val : null, 'kts', f12.dir, a12);
  }

  // ---- Verdict ----

  const statuses = [sw, sc, pp, tp].filter(s => s !== null);
  const { verdict, sub } = computeVerdict(statuses);
  setVerdict(verdict, sub);

  // ---- Updated timestamp ----

  updatedAtEl.textContent = `Last updated: ${formatTime(new Date())}`;

  setRefreshing(false);
  scheduleRefresh();
}

// ---- Init ----

refreshBtn.addEventListener('click', () => {
  loadWeather();
});

renderYoutube();
loadWeather();
