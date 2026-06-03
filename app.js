/* ═══════════════════════════════════════════════════════════════════════
   app.js  —  Liga 1 Perú Dashboard
   Lee tabla_liga1_peru.csv con PapaParse e inyecta los datos en el DOM.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ── CONFIGURACIÓN ────────────────────────────────────────────────────────
const CSV_PATH         = 'tabla_liga1_peru.csv';
const MATCHES_CSV_PATH = 'partidos_liga1_2026.csv';
// Reemplaza con tu URL de Render una vez desplegado:
const API_URL          = 'https://liga1-xg-predictor.onrender.com';

// Map de nombres de equipos del CSV → ID de Sofascore para los escudos
const TEAM_IDS = {
  'Alianza Lima':       2311,
  'Los Chankas':        252254,
  'Cienciano':          2301,
  'Cusco':              63760,
  'Cusco FC':           63760,
  'Universitario':      2305,
  'Deportivo Garcilaso':458584,
  'Melgar':             2308,
  'Alianza Atlético':   2307,
  'Alianza Atletico':   2307,
  'Comerciantes Unidos':213609,
  'ADT':                335557,
  'Sporting Cristal':   2302,
  'Moquegua':           492848,
  'UTC':                87854,
  'Sport Boys':         2312,
  'Cajamarca':          1082002,
  'Atlético Grau':      282538,
  'Atletico Grau':      282538,
  'Sport Huancayo':     33895,
  'ADC Juan Pablo II':  511206,
};

// Zonas de la tabla (posiciones)
const PLAYOFF_POS    = [1];         // Amarillo
const RELEGATION_POS = [17, 18];    // Rojo

// Partidos cargados dinámicamente desde partidos_liga1_2026.csv
let MATCHES = {};

// ── ESTADO ───────────────────────────────────────────────────────────────
let currentRound  = 17;
let ROUND_MAX     = 17;
const ROUND_MIN   = 1;
let standingsData = [];
const predCache   = {};   // { "HomeTeam|AwayTeam": { local:{...}, visitante:{...} } }

// ── DOM REFS ─────────────────────────────────────────────────────────────
const $standingsTable = () => document.getElementById('standings-table');
const $matchesList    = () => document.getElementById('matches-list');
const $roundSelect    = () => document.getElementById('round-select');
const $loading        = () => document.getElementById('table-loading');
const $error          = () => document.getElementById('table-error');
const $tableWrap      = () => document.getElementById('table-wrap');
const $countdown      = () => document.getElementById('countdown');

// ── HELPERS ───────────────────────────────────────────────────────────────
function logoUrl(idOrName) {
  const id = typeof idOrName === 'number' ? idOrName : TEAM_IDS[idOrName];
  return id
    ? `https://img.sofascore.com/api/v1/team/${id}/image`
    : '';
}

function getTeamId(name) {
  // Búsqueda exacta primero, luego parcial
  if (TEAM_IDS[name]) return TEAM_IDS[name];
  const key = Object.keys(TEAM_IDS).find(k =>
    name.toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes(name.toLowerCase())
  );
  return key ? TEAM_IDS[key] : null;
}

function formBox(letter) {
  // CSV usa: V=victoria, E=empate, D=derrota
  const map = { V:'v', E:'e', D:'d' };
  const labels = { V:'V', E:'E', D:'D' };
  const cls = map[letter.toUpperCase()] || 'd';
  return `<div class="fb ${cls}">${labels[letter.toUpperCase()] || letter}</div>`;
}

// ── MATCHES CSV LOADER ────────────────────────────────────────────────────
function parseMatchDate(dateStr) {
  const [d, m, y] = (dateStr || '').split('/');
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function formatMatchDate(dateStr) {
  // "31/05/2026" → "31/5/26"
  const [d, m, y] = dateStr.split('/');
  return `${parseInt(d)}/${parseInt(m)}/${y.slice(2)}`;
}

function loadMatchesCSV() {
  Papa.parse(MATCHES_CSV_PATH, {
    download: true,
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    complete: (results) => {
      if (!results.data || results.data.length === 0) return;

      const grouped = {};
      results.data.forEach(row => {
        const jornada = (row['Jornada'] || '').trim();
        const m = jornada.match(/Apertura\s+(\d+)/i);
        if (!m) return;
        const roundNum = parseInt(m[1]);
        if (!grouped[roundNum]) grouped[roundNum] = [];
        grouped[roundNum].push(row);
      });

      // Sort each round's matches by date ascending
      Object.values(grouped).forEach(arr =>
        arr.sort((a, b) => parseMatchDate(a.fecha) - parseMatchDate(b.fecha))
      );

      MATCHES = {};
      Object.keys(grouped).forEach(r => {
        const roundNum = parseInt(r);
        let prevDate = null;
        MATCHES[roundNum] = grouped[r].map(row => {
          const rawDate  = (row['fecha'] || '').trim();
          const display  = rawDate && rawDate !== prevDate ? formatMatchDate(rawDate) : '';
          if (rawDate) prevDate = rawDate;

          const homeName  = (row['equipo_local']    || '').trim();
          const awayName  = (row['equipo_visitante'] || '').trim();
          const gl        = row['goles_local'];
          const gv        = row['goles_visitante'];
          const hasScore  = gl !== '' && gl !== undefined &&
                            gv !== '' && gv !== undefined;

          return {
            date:     display,
            hour:     hasScore ? 'FT' : null,
            homeId:   getTeamId(homeName),
            homeName,
            awayId:   getTeamId(awayName),
            awayName,
            sh:       hasScore ? parseInt(gl) : null,
            sa:       hasScore ? parseInt(gv) : null,
          };
        });
      });

      const rounds = Object.keys(MATCHES).map(Number);
      ROUND_MAX    = Math.max(...rounds);
      currentRound = ROUND_MAX;

      buildRoundSelect();
      renderMatches(currentRound);
      renderDestacado(currentRound);
      if (isPredTabActive()) renderPredictionsTab(currentRound);
    },
  });
}

// ── CSV LOADER ────────────────────────────────────────────────────────────
function loadCSV() {
  $loading().style.display  = 'flex';
  $error().style.display    = 'none';
  $tableWrap().style.display = 'none';

  Papa.parse(CSV_PATH, {
    download: true,
    header:   true,
    skipEmptyLines: true,
    complete: (results) => {
      if (!results.data || results.data.length === 0) {
        showError();
        return;
      }
      standingsData = results.data;
      $loading().style.display   = 'none';
      $tableWrap().style.display = 'block';
      renderStandings(standingsData);
    },
    error: () => showError(),
  });
}

function showError() {
  $loading().style.display = 'none';
  $error().style.display   = 'flex';
}

// ── RENDER STANDINGS ──────────────────────────────────────────────────────
function renderStandings(data) {
  const el = $standingsTable();
  let html = '';

  data.forEach((row, i) => {
    const pos  = parseInt(row['Posicion'] || row['posicion'] || i + 1);
    const name = (row['Equipo'] || '').trim();
    const teamId = getTeamId(name);
    const logo   = teamId
      ? `https://img.sofascore.com/api/v1/team/${teamId}/image`
      : '';

    const pj  = row['PJ']  || '-';
    const pg  = row['PG']  || '-';
    const pe  = row['PE']  || '-';
    const pp  = row['PP']  || '-';
    const dif = row['DIF'] || '-';
    const gls = row['Goles']   || '-';
    const pts = row['Puntos']  || '-';
    const forma = (row['Ultimos_5'] || '').trim();

    // Separadores de zona
    if (pos === 2)  html += `<div class="zone-sep"></div>`;
    if (pos === 17) html += `<div class="zone-sep"></div>`;

    const isPlayoff    = PLAYOFF_POS.includes(pos);
    const isRelegation = RELEGATION_POS.includes(pos);
    const rowClass = isPlayoff ? 'playoff-zone' : isRelegation ? 'relegation-zone' : '';
    const circleClass = isPlayoff ? 'playoff' : isRelegation ? 'relegation' : '';

    const formaHtml = forma.split('').map(formBox).join('');

    html += `
    <div class="team-row ${rowClass}" style="animation-delay:${i * 0.03}s">
      <span class="zone-indicator"></span>
      <div class="pos-circle ${circleClass}">${pos}</div>
      <div class="team-cell">
        ${logo
          ? `<img class="team-logo-sm" src="${logo}" alt="${name}"
               onerror="this.style.opacity=0.15">`
          : `<div style="width:20px;height:20px;flex-shrink:0"></div>`
        }
        <span class="team-name-cell">${name}</span>
      </div>
      <span class="td">${pj}</span>
      <span class="td">${pg}</span>
      <span class="td">${pe}</span>
      <span class="td">${pp}</span>
      <span class="td">${dif}</span>
      <span class="td">${gls}</span>
      <div class="form-mini">${formaHtml}</div>
      <span class="td pts">${pts}</span>
    </div>`;
  });

  el.innerHTML = html;
}

// ── RENDER MATCHES ────────────────────────────────────────────────────────
function renderMatches(round) {
  const matches = MATCHES[round] || [];
  const el = $matchesList();
  let html = '';

  matches.forEach((m, i) => {
    const finished = m.sh !== null;
    const homeWin  = finished && m.sh > m.sa;
    const awayWin  = finished && m.sa > m.sh;

    const dateHtml = m.date
      ? `<span class="match-date">${m.date}</span>` : '';
    const statusHtml = m.hour === 'FT'
      ? `<span class="match-ft">FT</span>`
      : m.hour
        ? `<span class="match-hour">${m.hour}</span>`
        : `<span class="match-hour"></span>`;

    const scoreHtml = finished
      ? `<div class="match-scores">
           <span class="match-score ${homeWin ? 'winner' : ''}">${m.sh}</span>
           <span class="match-score ${awayWin ? 'winner' : ''}">${m.sa}</span>
         </div>`
      : `<div style="min-width:16px"></div>`;

    // Slot de predicción (solo para partidos no jugados)
    const predSlot = !finished
      ? `<div class="match-pred" id="pred-${round}-${i}">
           <span class="pred-loading">···</span>
         </div>`
      : '';

    html += `
    <div class="match-row" style="animation-delay:${i * 0.04}s">
      <div class="match-time-cell">
        ${dateHtml}
        ${statusHtml}
      </div>
      <div class="match-teams">
        <div class="match-team-row">
          <img src="https://img.sofascore.com/api/v1/team/${m.homeId}/image/small"
               alt="${m.homeName}" onerror="this.style.opacity=0.15">
          <span class="match-team-name ${homeWin ? 'winner' : ''}">${m.homeName}</span>
          ${!finished ? `<span class="pred-badge home" id="pred-h-${round}-${i}"></span>` : ''}
        </div>
        <div class="match-team-row">
          <img src="https://img.sofascore.com/api/v1/team/${m.awayId}/image/small"
               alt="${m.awayName}" onerror="this.style.opacity=0.15">
          <span class="match-team-name ${awayWin ? 'winner' : ''}">${m.awayName}</span>
          ${!finished ? `<span class="pred-badge away" id="pred-a-${round}-${i}"></span>` : ''}
        </div>
      </div>
      ${scoreHtml}
      <div class="match-fav" onclick="toggleFav(this)">☆</div>
    </div>`;

    if (i < matches.length - 1) {
      html += `<div class="match-sep"></div>`;
    }
  });

  el.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Sin partidos para esta jornada</div>';

  // Lanzar predicciones para partidos pendientes
  fetchPredictions(round, matches);
}

// ── PREDICCIONES API ──────────────────────────────────────────────────────
async function getMatchResult(m) {
  const key = `result|${m.homeName}|${m.awayName}`;
  if (predCache[key]) return predCache[key];
  try {
    const url = `${API_URL}/match-result` +
      `?home=${encodeURIComponent(m.homeName)}` +
      `&away=${encodeURIComponent(m.awayName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    predCache[key] = data;
    return data;
  } catch (_) { return null; }
}

async function getPrediction(m) {
  const key = `${m.homeName}|${m.awayName}`;
  if (predCache[key]) return predCache[key];
  try {
    const url = `${API_URL}/predict-match` +
      `?home=${encodeURIComponent(m.homeName)}` +
      `&away=${encodeURIComponent(m.awayName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    predCache[key] = data;
    return data;
  } catch (_) { return null; }
}

async function fetchPredictions(round, matches) {
  const unplayed = matches
    .map((m, i) => ({ ...m, idx: i }))
    .filter(m => m.sh === null);
  if (!unplayed.length) return;
  for (const m of unplayed) {
    const data = await getPrediction(m);
    if (data) applyPrediction(round, m.idx, data);
  }
}

function applyPrediction(round, idx, data) {
  const hp = data.local.probabilidad;
  const ap = data.visitante.probabilidad;

  const elH = document.getElementById(`pred-h-${round}-${idx}`);
  const elA = document.getElementById(`pred-a-${round}-${idx}`);
  if (!elH || !elA) return;

  elH.textContent = `${hp}%`;
  elH.className   = `pred-badge home ${hp >= 60 ? 'pred-high' : 'pred-low'}`;
  elA.textContent = `${ap}%`;
  elA.className   = `pred-badge away ${ap >= 60 ? 'pred-high' : 'pred-low'}`;
}

// ── ROUND SELECT ──────────────────────────────────────────────────────────
function buildRoundSelect() {
  const sel = $roundSelect();
  sel.innerHTML = '';
  for (let r = ROUND_MAX; r >= ROUND_MIN; r--) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = `Apertura Ronda ${r}`;
    if (r === currentRound) opt.selected = true;
    sel.appendChild(opt);
  }
}

function changeRound(dir) {
  const next = currentRound + dir;
  if (next < ROUND_MIN || next > ROUND_MAX) return;
  currentRound = next;
  $roundSelect().value = currentRound;
  renderMatches(currentRound);
  renderDestacado(currentRound);
  if (isPredTabActive()) renderPredictionsTab(currentRound);
}

// ── DESTACADO ─────────────────────────────────────────────────────────────
function renderDestacado(round) {
  const el = document.getElementById('destacado-match');
  if (!el) return;

  const matches = MATCHES[round] || [];
  const played  = matches.filter(m => m.sh !== null);

  if (!played.length) {
    // Mostrar el próximo partido sin jugar
    const next = matches.find(m => m.sh === null);
    if (!next) {
      el.innerHTML = `<div class="match-no-data">Sin partidos en esta jornada</div>`;
      return;
    }
    el.innerHTML = buildDestacadoHTML(next, false);
    return;
  }

  // Partido con más goles totales
  const top = played.reduce((a, b) =>
    (a.sh + a.sa) >= (b.sh + b.sa) ? a : b
  );
  el.innerHTML = buildDestacadoHTML(top, true);
}

function buildDestacadoHTML(m, showScore) {
  const centerHTML = showScore
    ? `<div class="match-score-feat">${m.sh} - ${m.sa}</div>
       <div class="match-total-goals">${m.sh + m.sa} goles totales</div>`
    : `<div class="match-upcoming-time">${m.hour || '--:--'}</div>
       <div class="match-upcoming-label">${m.date || 'Próximo'}</div>`;

  return `
    <div class="team-feat">
      <img src="https://img.sofascore.com/api/v1/team/${m.homeId}/image"
           alt="${m.homeName}" onerror="this.style.opacity=0.15">
      <span>${m.homeName}</span>
    </div>
    <div class="match-center">${centerHTML}</div>
    <div class="team-feat">
      <img src="https://img.sofascore.com/api/v1/team/${m.awayId}/image"
           alt="${m.awayName}" onerror="this.style.opacity=0.15">
      <span>${m.awayName}</span>
    </div>`;
}

// ── FAVORITOS ─────────────────────────────────────────────────────────────
function toggleFav(el) {
  el.classList.toggle('active');
  el.textContent = el.classList.contains('active') ? '★' : '☆';
}

// ── PROGRESS BAR ─────────────────────────────────────────────────────────
function updateProgress() {
  const SEASON_START = new Date('2026-01-30');
  const SEASON_END   = new Date('2026-11-29');
  const now          = new Date();

  const total   = SEASON_END - SEASON_START;
  const elapsed = Math.min(Math.max(now - SEASON_START, 0), total);
  const pct     = (elapsed / total) * 100;

  const fill = document.querySelector('.progress-fill');
  if (fill) fill.style.width = `${pct.toFixed(1)}%`;

  const fmt = d => d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  const spans = document.querySelectorAll('.progress-dates span');
  if (spans[0]) spans[0].textContent = fmt(SEASON_START);
  if (spans[1]) spans[1].textContent = fmt(SEASON_END);
}

// ── COUNTDOWN ─────────────────────────────────────────────────────────────
function updateCountdown() {
  const el = $countdown();
  if (!el) return;
  const now    = new Date();
  const target = new Date();
  target.setDate(target.getDate() + 1);
  target.setHours(13, 15, 0, 0);
  const diff = target - now;
  if (diff <= 0) { el.textContent = 'En curso'; return; }
  const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${h}:${m}:${s}`;
}

// ── TABS ──────────────────────────────────────────────────────────────────
function setupMainTabs() {
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');
      if (tab.dataset.tab === 'predicciones') renderPredictionsTab(currentRound);
    });
  });
}

function isPredTabActive() {
  const t = document.querySelector('.main-tab.active');
  return t && t.dataset.tab === 'predicciones';
}

// ── PREDICCIONES TAB ──────────────────────────────────────────────────────
async function renderPredictionsTab(round) {
  const container = document.getElementById('pred-tab-content');
  const subtitle  = document.getElementById('pred-tab-round');
  if (!container) return;

  if (subtitle) subtitle.textContent = `Apertura — Jornada ${round}`;

  const matches = MATCHES[round] || [];
  if (!matches.length) {
    container.innerHTML = '<div class="empty-tab">Sin partidos para esta jornada</div>';
    return;
  }

  container.innerHTML =
    `<div style="padding:16px;color:var(--text3);font-size:12px">Cargando predicciones…</div>`;

  // Predicciones del modelo + resultados reales en paralelo
  const [preds, results] = await Promise.all([
    Promise.all(matches.map(m => getPrediction(m))),
    Promise.all(matches.map(m => m.sh !== null ? getMatchResult(m) : Promise.resolve(null))),
  ]);

  const html = matches.map((m, i) => {
    const pred = preds[i];
    if (!pred) {
      return `<div class="pred-card" style="padding:14px;color:var(--text3);font-size:12px;
              text-align:center">${m.homeName} vs ${m.awayName} — sin datos del modelo</div>`;
    }
    return `<div class="pred-card" style="animation-delay:${i * 0.05}s">
              ${buildPredCardHTML(m, pred, results[i])}
            </div>`;
  }).join('');

  container.innerHTML = html;
}

function buildPredCardHTML(m, data, result = null) {
  const finished = m.sh !== null;
  const hp = data.local.probabilidad;
  const ap = data.visitante.probabilidad;
  const hHigh = data.local.alto_rendimiento;
  const aHigh = data.visitante.alto_rendimiento;

  // Verificación con los 3 criterios reales si el partido ya se jugó
  const hOk = result
    ? (hHigh === result.local.cumple_target)
    : finished ? (hHigh === (m.sh >= 1)) : null;
  const aOk = result
    ? (aHigh === result.visitante.cumple_target)
    : finished ? (aHigh === (m.sa >= 1)) : null;

  const hBadge = hOk !== null
    ? `<span class="pred-check ${hOk ? 'ok' : 'fail'}">${hOk ? '✓' : '✗'}</span>` : '';
  const aBadge = aOk !== null
    ? `<span class="pred-check ${aOk ? 'ok' : 'fail'}">${aOk ? '✓' : '✗'}</span>` : '';

  // Estadísticas reales (solo si hay datos del backend)
  const hReal = result
    ? `<div class="pred-real">${result.local.goles}G · xG ${result.local.xg} · ${result.local.tiros_puerta} tiros</div>` : '';
  const aReal = result
    ? `<div class="pred-real">${result.visitante.goles}G · xG ${result.visitante.xg} · ${result.visitante.tiros_puerta} tiros</div>` : '';

  const centerHtml = finished
    ? `<div class="pred-scorebox">${m.sh}<span>-</span>${m.sa}</div>
       <div class="pred-vs">FT</div>`
    : `<div class="pred-vs">VS</div>
       ${m.date ? `<div class="pred-matchdate">${m.date}</div>` : ''}`;

  return `
    <div class="pred-team home">
      <div class="pred-team-head">
        <img class="pred-logo" src="https://img.sofascore.com/api/v1/team/${m.homeId}/image"
             alt="${m.homeName}" onerror="this.style.opacity=0.15">
        <span class="pred-name">${m.homeName}</span>
        ${hBadge}
      </div>
      <div class="pred-bar-wrap">
        <div class="pred-bar-fill ${hHigh ? 'p-high' : 'p-low'}" style="width:${hp}%"></div>
      </div>
      <div class="pred-bottom">
        <span class="pred-pct ${hHigh ? 'p-high' : 'p-low'}">${hp}%</span>
        <span class="pred-label">${hHigh ? 'Alto rendimiento' : 'Bajo rendimiento'}</span>
        ${hReal}
      </div>
    </div>

    <div class="pred-center">${centerHtml}</div>

    <div class="pred-team away">
      <div class="pred-team-head away">
        ${aBadge}
        <span class="pred-name">${m.awayName}</span>
        <img class="pred-logo" src="https://img.sofascore.com/api/v1/team/${m.awayId}/image"
             alt="${m.awayName}" onerror="this.style.opacity=0.15">
      </div>
      <div class="pred-bar-wrap away">
        <div class="pred-bar-fill ${aHigh ? 'p-high' : 'p-low'}" style="width:${ap}%"></div>
      </div>
      <div class="pred-bottom away">
        <span class="pred-pct ${aHigh ? 'p-high' : 'p-low'}">${ap}%</span>
        <span class="pred-label">${aHigh ? 'Alto rendimiento' : 'Bajo rendimiento'}</span>
        ${aReal}
      </div>
    </div>`;
}

function setupSubTabs() {
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // TODO: filtrar tabla por local/visitante
    });
  });
}

function setupPartidosTabs() {
  document.getElementById('tab-fecha').addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
  document.getElementById('tab-jornada').addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
}

function setupRoundNav() {
  document.getElementById('btn-prev').addEventListener('click', () => changeRound(-1));
  document.getElementById('btn-next').addEventListener('click', () => changeRound(+1));
  $roundSelect().addEventListener('change', (e) => {
    currentRound = parseInt(e.target.value);
    renderMatches(currentRound);
    renderDestacado(currentRound);
    if (isPredTabActive()) renderPredictionsTab(currentRound);
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupMainTabs();
  setupSubTabs();
  setupPartidosTabs();
  buildRoundSelect();
  setupRoundNav();

  // Load matches from CSV (renders after load)
  loadMatchesCSV();

  // Load CSV for standings
  loadCSV();

  // Progress bar temporada
  updateProgress();

  // Countdown
  updateCountdown();
  setInterval(updateCountdown, 1000);
});
