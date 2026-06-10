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
  'CD Juan Pablo II':   511206,   // alias: nombre en tabla_liga1_peru.csv
};

// Normaliza nombres inconsistentes entre CSVs
const TEAM_NAME_MAP = {
  'CD Juan Pablo II': 'ADC Juan Pablo II',
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
let _statsLoaded  = false;
let _rendLoaded   = false;

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
          const display  = rawDate ? formatMatchDate(rawDate) : '';
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
    const pos     = parseInt(row['Posicion'] || row['posicion'] || i + 1);
    const rawName = (row['Equipo'] || '').trim();
    const name    = TEAM_NAME_MAP[rawName] || rawName;
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
  // Usa xG como indicador principal en el panel de partidos
  const hp = data.local.xg.probabilidad;
  const ap = data.visitante.xg.probabilidad;

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
      const name = tab.dataset.tab;
      if (name === 'predicciones') renderPredictionsTab(currentRound);
      if (name === 'estadisticas' && !_statsLoaded) { renderEstadisticasTab(); _statsLoaded = true; }
      if (name === 'rendimiento'  && !_rendLoaded)  { renderRendimientoTab();  _rendLoaded  = true; }
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

  const hXG  = data.local.xg;
  const hTir = data.local.tiros;
  const hGol = data.local.goles;
  const aXG  = data.visitante.xg;
  const aTir = data.visitante.tiros;
  const aGol = data.visitante.goles;

  // Verificación ✓/✗ por cada modelo (solo cuando hay resultado real)
  function chk(predicted, real) {
    if (real === undefined || real === null) return '';
    const ok = predicted === real;
    return `<span class="pred-check ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✗'}</span>`;
  }

  const hChecks = result ? [
    chk(hXG.alto,  result.local.cumple_xg),
    chk(hTir.alto, result.local.cumple_tiros),
    chk(hGol.alto, result.local.cumple_goles),
  ].join('') : '';

  const aChecks = result ? [
    chk(aXG.alto,  result.visitante.cumple_xg),
    chk(aTir.alto, result.visitante.cumple_tiros),
    chk(aGol.alto, result.visitante.cumple_goles),
  ].join('') : '';

  // 3 barras apiladas
  const BARS = [
    { label: 'xG ≥ 1.5',  key: 'xg'    },
    { label: 'Tiros ≥ 5', key: 'tiros'  },
    { label: 'Goles ≥ 2', key: 'goles'  },
  ];

  function barsHome(d) {
    return BARS.map(b => {
      const m = d[b.key];
      return `
        <div class="pred-bar-row">
          <span class="pred-bar-label">${b.label}</span>
          <div class="pred-bar-track">
            <div class="pred-bar-fill ${m.alto ? 'p-high' : 'p-low'}" style="width:${m.probabilidad}%"></div>
          </div>
          <span class="pred-bar-pct">${m.probabilidad}%</span>
        </div>`;
    }).join('');
  }

  function barsAway(d) {
    return BARS.map(b => {
      const m = d[b.key];
      return `
        <div class="pred-bar-row away">
          <span class="pred-bar-pct">${m.probabilidad}%</span>
          <div class="pred-bar-track away">
            <div class="pred-bar-fill ${m.alto ? 'p-high' : 'p-low'}" style="width:${m.probabilidad}%"></div>
          </div>
          <span class="pred-bar-label">${b.label}</span>
        </div>`;
    }).join('');
  }

  // Stats reales del partido
  const hReal = result
    ? `<div class="pred-real">xG ${result.local.xg} · ${result.local.tiros_puerta} tiros · ${result.local.goles}G</div>` : '';
  const aReal = result
    ? `<div class="pred-real away">xG ${result.visitante.xg} · ${result.visitante.tiros_puerta} tiros · ${result.visitante.goles}G</div>` : '';

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
        <div class="pred-check-group">${hChecks}</div>
      </div>
      <div class="pred-bars-stack">${barsHome(data.local)}</div>
      ${hReal}
    </div>

    <div class="pred-center">${centerHtml}</div>

    <div class="pred-team away">
      <div class="pred-team-head away">
        <div class="pred-check-group">${aChecks}</div>
        <span class="pred-name">${m.awayName}</span>
        <img class="pred-logo" src="https://img.sofascore.com/api/v1/team/${m.awayId}/image"
             alt="${m.awayName}" onerror="this.style.opacity=0.15">
      </div>
      <div class="pred-bars-stack">${barsAway(data.visitante)}</div>
      ${aReal}
    </div>`;
}

// ── ESTADÍSTICAS TAB ──────────────────────────────────────────────────────
async function renderEstadisticasTab() {
  const tabEl = document.getElementById('tab-estadisticas');
  if (!tabEl) return;

  tabEl.innerHTML = `
    <div class="stats-tab-wrap">
      <div class="stats-tab-header">
        <span class="pred-tab-title">Estadísticas ofensivas</span>
        <span class="pred-tab-sub">Promedios por partido — Apertura 2026</span>
      </div>
      <div class="stats-table-wrap">
        <div id="stats-table-content">
          <div class="loading-state"><div class="spinner"></div><span>Cargando ranking...</span></div>
        </div>
      </div>
    </div>`;

  const content = document.getElementById('stats-table-content');

  try {
    const res = await fetch(`${API_URL}/team-rankings`);
    if (!res.ok) throw new Error();
    const data = await res.json();

    if (!data.length) {
      content.innerHTML = '<div class="empty-tab">Sin datos disponibles</div>';
      return;
    }

    const maxXG    = Math.max(...data.map(t => t.xg_avg));
    const maxTiros = Math.max(...data.map(t => t.tiros_avg));
    const maxGoles = Math.max(...data.map(t => t.goles_avg));
    const maxPos   = Math.max(...data.map(t => t.posesion_avg));

    let html = `
      <div class="stats-table-head">
        <span>#</span>
        <span>Equipo</span>
        <span style="text-align:center">PJ</span>
        <span>xG prom ↓</span>
        <span>Tiros prom</span>
        <span>Goles prom</span>
        <span>Posesión</span>
      </div>`;

    data.forEach((team, i) => {
      const id   = getTeamId(team.equipo);
      const logo = id ? `https://img.sofascore.com/api/v1/team/${id}/image` : '';
      const xgW   = ((team.xg_avg      / maxXG)    * 100).toFixed(0);
      const tirW  = ((team.tiros_avg   / maxTiros)  * 100).toFixed(0);
      const golW  = ((team.goles_avg   / maxGoles)  * 100).toFixed(0);
      const posW  = ((team.posesion_avg / maxPos)   * 100).toFixed(0);
      const xgHi  = team.xg_avg    >= 1.5;
      const tirHi = team.tiros_avg >= 5;
      const golHi = team.goles_avg >= 2;

      html += `
        <div class="stats-row" style="animation-delay:${i * 0.03}s">
          <span class="stats-rank">${i + 1}</span>
          <div class="stats-team-cell">
            ${logo
              ? `<img src="${logo}" alt="${team.equipo}" onerror="this.style.opacity=0.15">`
              : '<div style="width:22px;flex-shrink:0"></div>'}
            <span>${team.equipo}</span>
          </div>
          <span class="stats-num-cell">${team.partidos}</span>
          <div class="stats-bar-cell">
            <div class="stats-bar-header">
              <span class="stats-val${xgHi ? ' stat-hi' : ''}">${team.xg_avg}</span>
              ${xgHi ? '<span class="stats-hi-dot">●</span>' : ''}
            </div>
            <div class="stats-mini-bar-track">
              <div class="stats-mini-bar-fill xg-bar" style="width:${xgW}%"></div>
            </div>
          </div>
          <div class="stats-bar-cell">
            <div class="stats-bar-header">
              <span class="stats-val${tirHi ? ' stat-hi' : ''}">${team.tiros_avg}</span>
              ${tirHi ? '<span class="stats-hi-dot">●</span>' : ''}
            </div>
            <div class="stats-mini-bar-track">
              <div class="stats-mini-bar-fill tiros-bar" style="width:${tirW}%"></div>
            </div>
          </div>
          <div class="stats-bar-cell">
            <div class="stats-bar-header">
              <span class="stats-val${golHi ? ' stat-hi' : ''}">${team.goles_avg}</span>
              ${golHi ? '<span class="stats-hi-dot">●</span>' : ''}
            </div>
            <div class="stats-mini-bar-track">
              <div class="stats-mini-bar-fill goles-bar" style="width:${golW}%"></div>
            </div>
          </div>
          <div class="stats-bar-cell">
            <div class="stats-bar-header">
              <span class="stats-val">${team.posesion_avg}%</span>
            </div>
            <div class="stats-mini-bar-track">
              <div class="stats-mini-bar-fill posesion-bar" style="width:${posW}%"></div>
            </div>
          </div>
        </div>`;
    });

    content.innerHTML = html;
  } catch (_) {
    content.innerHTML = '<div class="empty-tab">No se pudo cargar las estadísticas</div>';
  }
}

// ── RENDIMIENTO TAB — helpers ─────────────────────────────────────────────
let _radarChart = null;

const MODEL_COLORS = {
  'XGBoost':             '#a78bfa',
  'LightGBM':            '#38bdf8',
  'Random Forest':       '#4ade80',
  'Logistic Regression': '#fbbf24',
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderCompChart(varKey, metricsData) {
  if (_radarChart) { _radarChart.destroy(); _radarChart = null; }
  const canvas = document.getElementById('comp-radar');
  if (!canvas || !metricsData[varKey]) return;

  const { modelos } = metricsData[varKey];
  const labels   = ['Accuracy', 'Precision', 'Recall', 'F1', 'AUC-ROC'];
  const datasets = modelos.map(m => {
    const col = MODEL_COLORS[m.nombre] || '#888';
    return {
      label:               m.nombre,
      data:                [m.accuracy, m.precision, m.recall, m.f1, m.auc_roc],
      borderColor:         col,
      backgroundColor:     hexToRgba(col, 0.1),
      pointBackgroundColor: col,
      pointRadius:         4,
      borderWidth:         2,
    };
  });

  _radarChart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: {
            stepSize: 0.2,
            color: '#555',
            font: { size: 9 },
            backdropColor: 'transparent',
          },
          grid:        { color: '#333' },
          angleLines:  { color: '#333' },
          pointLabels: { color: '#aaa', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#aaa', font: { size: 11 }, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${(ctx.raw * 100).toFixed(1)}%`,
          },
        },
      },
    },
  });

  const tbody = document.getElementById('comp-table-body');
  if (!tbody) return;
  tbody.innerHTML = modelos.map(m => {
    const col = MODEL_COLORS[m.nombre] || '#888';
    return `
      <div class="comp-table-row">
        <span class="comp-model-name" style="color:${col}">${m.nombre}</span>
        <span>${(m.accuracy  * 100).toFixed(1)}%</span>
        <span>${(m.precision * 100).toFixed(1)}%</span>
        <span>${(m.recall    * 100).toFixed(1)}%</span>
        <span>${(m.f1        * 100).toFixed(1)}%</span>
        <span>${m.auc_roc.toFixed(4)}</span>
      </div>`;
  }).join('');
}

// ── RENDIMIENTO TAB ────────────────────────────────────────────────────────
async function renderRendimientoTab() {
  const tabEl = document.getElementById('tab-rendimiento');
  if (!tabEl) return;

  tabEl.innerHTML = `
    <div class="rend-tab-wrap">
      <div class="rend-sub-nav">
        <div class="rend-sub-tabs">
          <button class="rend-sub-tab active" data-section="backtesting">Backtesting</button>
          <button class="rend-sub-tab" data-section="comp">Comparación</button>
        </div>
      </div>
      <div id="rend-tab-content">
        <div class="loading-state"><div class="spinner"></div><span>Calculando...</span></div>
      </div>
    </div>`;

  const content = document.getElementById('rend-tab-content');

  try {
    const [perfRes, metricsRes] = await Promise.all([
      fetch(`${API_URL}/model-performance`),
      fetch(`${API_URL}/model-metrics`),
    ]);

    if (!perfRes.ok) throw new Error();
    const perfData    = await perfRes.json();
    const metricsData = metricsRes.ok ? await metricsRes.json() : null;

    function accColor(pct) {
      return pct >= 70 ? 'acc-green' : pct >= 50 ? 'acc-yellow' : 'acc-red';
    }

    // ── Sección Backtesting ──────────────────────────────────────────────
    let backHtml = '';
    if (!perfData.rounds || !perfData.rounds.length) {
      backHtml = `<div style="padding:24px 16px;color:var(--text3);font-size:13px">
        Sin datos post-entrenamiento. Modelos entrenados hasta el 27/04/2026.</div>`;
    } else {
      const { resumen, rounds } = perfData;
      const totalPred = rounds.reduce((s, r) => s + r.total, 0);
      backHtml = `
        <div class="acc-summary">
          <div class="acc-card">
            <span class="acc-card-label">xG ≥ 1.5</span>
            <span class="acc-card-value ${accColor(resumen.xg_accuracy)}">${resumen.xg_accuracy}%</span>
            <span class="acc-card-sub">Accuracy global</span>
          </div>
          <div class="acc-card">
            <span class="acc-card-label">Tiros ≥ 5</span>
            <span class="acc-card-value ${accColor(resumen.tiros_accuracy)}">${resumen.tiros_accuracy}%</span>
            <span class="acc-card-sub">Accuracy global</span>
          </div>
          <div class="acc-card">
            <span class="acc-card-label">Goles ≥ 2</span>
            <span class="acc-card-value ${accColor(resumen.goles_accuracy)}">${resumen.goles_accuracy}%</span>
            <span class="acc-card-sub">Accuracy global</span>
          </div>
        </div>
        <div class="rend-meta">${resumen.total_rondas} jornadas evaluadas · ${totalPred} predicciones</div>
        <div class="rend-table-wrap">
          <div class="rend-table-head">
            <span>Ronda</span>
            <span>Semana del</span>
            <span style="text-align:center">n</span>
            <span>xG ≥ 1.5</span>
            <span>Tiros ≥ 5</span>
            <span>Goles ≥ 2</span>
          </div>
          ${rounds.map((r, i) => `
            <div class="rend-table-row" style="animation-delay:${i * 0.05}s">
              <span class="rend-jornada">${r.jornada}</span>
              <span class="rend-fecha">${r.fecha}</span>
              <span class="rend-n">${r.total}</span>
              <span class="acc-badge ${accColor(r.xg_pct)}">${r.xg_pct}%</span>
              <span class="acc-badge ${accColor(r.tiros_pct)}">${r.tiros_pct}%</span>
              <span class="acc-badge ${accColor(r.goles_pct)}">${r.goles_pct}%</span>
            </div>`).join('')}
        </div>`;
    }

    // ── Sección Comparación ───────────────────────────────────────────────
    let compHtml = '';
    if (metricsData) {
      const varKeys = Object.keys(metricsData);
      compHtml = `
        <div class="comp-header">
          <span class="pred-tab-title">Comparación de Algoritmos</span>
          <span class="pred-tab-sub">Test set — división temporal 80/20</span>
        </div>
        <div class="comp-var-tabs" id="comp-var-tabs">
          ${varKeys.map((k, i) => `
            <button class="comp-var-tab${i === 0 ? ' active' : ''}" data-var="${k}">
              ${metricsData[k].label}
            </button>`).join('')}
        </div>
        <div class="comp-chart-wrap">
          <canvas id="comp-radar"></canvas>
        </div>
        <div class="comp-table-wrap">
          <div class="comp-table-head">
            <span>Modelo</span>
            <span>Accuracy</span>
            <span>Precision</span>
            <span>Recall</span>
            <span>F1</span>
            <span>AUC-ROC</span>
          </div>
          <div id="comp-table-body"></div>
        </div>`;
    } else {
      compHtml = `<div style="padding:40px;color:var(--text3);font-size:13px;text-align:center">
        Sin datos de comparación disponibles.</div>`;
    }

    content.innerHTML = `
      <div id="rend-section-backtesting" class="rend-section">${backHtml}</div>
      <div id="rend-section-comp"        class="rend-section comp-section" style="display:none">${compHtml}</div>`;

    // Sub-tab switching
    document.querySelectorAll('.rend-sub-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rend-sub-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.section;
        document.querySelectorAll('.rend-section').forEach(s => {
          s.style.display = s.id === `rend-section-${target}` ? '' : 'none';
        });
        // Lazy-init: chart solo cuando el canvas es visible
        if (target === 'comp' && metricsData && !_radarChart) {
          renderCompChart(Object.keys(metricsData)[0] || 'xg', metricsData);
        }
      });
    });

    // Variable tabs dentro de Comparación
    if (metricsData) {
      document.querySelectorAll('.comp-var-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.comp-var-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderCompChart(btn.dataset.var, metricsData);
        });
      });
    }
  } catch (_) {
    content.innerHTML = '<div class="empty-tab">No se pudo cargar el rendimiento del modelo</div>';
  }
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
