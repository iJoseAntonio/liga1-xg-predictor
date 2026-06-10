from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import joblib
import pandas as pd
import numpy as np
import os

app = FastAPI(
    title="Liga 1 Perú — Predictor Multi-Modelo",
    description="Predice xG>=1.5, Tiros>4 y Goles>=2 por equipo",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_XG_PATH    = "modelo_xgboost_liga1_xG.pkl"
MODEL_TIROS_PATH = "modelo_xgboost_liga1_tiros_puerta.pkl"
MODEL_GOLES_PATH = "modelo_xgboost_liga_goles.pkl"
DATA_PATH        = "bd_liga1.csv"

modelo_xg    = None
modelo_tiros = None
modelo_goles = None
df_historico = None

# Columnas raw a extraer del CSV (superset de los 3 modelos)
COLS_STATS_CSV = [
    'goles', 'Posesión de pelota', 'Goles esperados (xG)', 'Tiros totales',
    'Tiros a puerta', 'Tiros adentro del area', 'Tiros desde fuera del area',
    'Pases', 'Pases precisos', 'Pases al ultimo tercio',
    'Entradas', 'Intercepciones', 'Recuperaciones',
    'Corners', 'Faltas', 'Tarjetas amarillas', 'Tarjetas rojas',
]

# Features modelo xG — usa ratios de eficiencia (sin Pases raw)
COLS_XG = [
    'goles', 'Posesión de pelota', 'Goles esperados (xG)', 'Tiros totales',
    'Tiros a puerta', 'Tiros adentro del area', 'Tiros desde fuera del area',
    'Pases al ultimo tercio', 'Entradas', 'Intercepciones', 'Recuperaciones',
    'Corners', 'Faltas', 'Tarjetas amarillas', 'Tarjetas rojas',
    'precision_pases', 'precision_tiros',
]

# Features modelos Tiros y Goles — usa Pases raw (sin ratios)
COLS_TIROS = [
    'goles', 'Posesión de pelota', 'Goles esperados (xG)', 'Tiros totales',
    'Tiros a puerta', 'Tiros adentro del area', 'Tiros desde fuera del area',
    'Pases', 'Pases precisos', 'Pases al ultimo tercio',
    'Entradas', 'Intercepciones', 'Recuperaciones',
    'Corners', 'Faltas', 'Tarjetas amarillas', 'Tarjetas rojas',
]

COLS_GOLES = COLS_TIROS

FEATURES_XG    = [f'{c}_prom_3' for c in COLS_XG]    + [f'{c}_prom_5' for c in COLS_XG]    + ['Local']
FEATURES_TIROS = [f'{c}_prom_3' for c in COLS_TIROS] + [f'{c}_prom_5' for c in COLS_TIROS] + ['Local']
FEATURES_GOLES = [f'{c}_prom_3' for c in COLS_GOLES] + [f'{c}_prom_5' for c in COLS_GOLES] + ['Local']


@app.on_event("startup")
def cargar_recursos():
    global modelo_xg, modelo_tiros, modelo_goles, df_historico

    for path, attr in [
        (MODEL_XG_PATH, 'xg'),
        (MODEL_TIROS_PATH, 'tiros'),
        (MODEL_GOLES_PATH, 'goles'),
    ]:
        if os.path.exists(path):
            try:
                m = joblib.load(path)
                if attr == 'xg':    modelo_xg    = m
                elif attr == 'tiros': modelo_tiros = m
                else:               modelo_goles = m
                print(f"Modelo {attr} cargado: {path}")
            except Exception as e:
                print(f"ERROR cargando {path}: {e}")
        else:
            print(f"ADVERTENCIA: {path} no encontrado.")

    if os.path.exists(DATA_PATH):
        try:
            df_historico = pd.read_csv(DATA_PATH, sep=';', encoding='utf-8-sig')
            df_historico.columns = df_historico.columns.str.strip()
            df_historico['fecha'] = pd.to_datetime(
                df_historico['fecha'], format='%d/%m/%Y', errors='coerce'
            )
            print(f"Datos históricos cargados: {len(df_historico)} partidos.")
        except Exception as e:
            print(f"ERROR cargando {DATA_PATH}: {e}")
    else:
        print(f"ADVERTENCIA: {DATA_PATH} no encontrado.")


def compute_team_stats(team_name: str, is_local: int) -> dict | None:
    """Calcula rolling features (últimos 3 y 5 partidos) para los 3 modelos."""
    if df_historico is None or df_historico.empty:
        return None

    rows = []
    for _, m in df_historico.iterrows():
        if m.get('equipo_local') == team_name:
            suffix = '_local'
        elif m.get('equipo_visitante') == team_name:
            suffix = '_visitante'
        else:
            continue
        row = {'Fecha': m['fecha']}
        for col in COLS_STATS_CSV:
            val = m.get(f'{col}{suffix}', 0)
            row[col] = pd.to_numeric(val, errors='coerce') or 0.0
        rows.append(row)

    if not rows:
        return None

    df_t = pd.DataFrame(rows).sort_values('Fecha').reset_index(drop=True)

    # Ratios usados por el modelo xG
    df_t['precision_pases'] = (
        df_t['Pases precisos'] / df_t['Pases'].replace(0, np.nan)
    ).fillna(0)
    df_t['precision_tiros'] = (
        df_t['Tiros a puerta'] / df_t['Tiros totales'].replace(0, np.nan)
    ).fillna(0)

    # Union de todas las columnas necesarias para los 3 modelos
    all_cols = list(dict.fromkeys(COLS_XG + COLS_TIROS))

    features = {'Local': is_local}
    for col in all_cols:
        features[f'{col}_prom_3'] = float(df_t[col].tail(3).mean())
        features[f'{col}_prom_5'] = float(df_t[col].tail(5).mean())

    return features


def run_model(modelo, stats: dict, feature_list: list) -> tuple[float, int]:
    X = pd.DataFrame([stats])[feature_list]
    prob  = float(modelo.predict_proba(X)[0][1])
    clase = int(modelo.predict(X)[0])
    return round(prob * 100, 1), clase


@app.get("/")
def root():
    return {
        "sistema": "Liga 1 Perú — Predictor Multi-Modelo",
        "modelos": {
            "xg":    "Goles esperados >= 1.5",
            "tiros": "Tiros a puerta > 4",
            "goles": "Goles >= 2",
        },
        "endpoints": ["/predict-match", "/match-result", "/health", "/docs"]
    }


@app.get("/health")
def health():
    return {
        "modelo_xg":    modelo_xg    is not None,
        "modelo_tiros": modelo_tiros is not None,
        "modelo_goles": modelo_goles is not None,
        "datos_cargados": df_historico is not None,
        "partidos_historicos": len(df_historico) if df_historico is not None else 0,
        "features_xg":    len(FEATURES_XG),
        "features_tiros": len(FEATURES_TIROS),
        "features_goles": len(FEATURES_GOLES),
        "version": "2.0.0"
    }


@app.get("/predict-match")
def predict_match(
    home: str = Query(..., description="Nombre del equipo local"),
    away: str = Query(..., description="Nombre del equipo visitante"),
):
    """
    Predice xG>=1.5, tiros>4 y goles>=2 para ambos equipos.
    Ejemplo: /predict-match?home=Universitario&away=Alianza Lima
    """
    if any(m is None for m in [modelo_xg, modelo_tiros, modelo_goles]):
        raise HTTPException(status_code=503, detail="Modelos no disponibles")
    if df_historico is None:
        raise HTTPException(status_code=503, detail="Datos históricos no disponibles")

    home_stats = compute_team_stats(home, is_local=1)
    away_stats = compute_team_stats(away, is_local=0)

    if home_stats is None:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para: {home}")
    if away_stats is None:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para: {away}")

    def predict_all(stats: dict) -> dict:
        xg_p,  xg_c  = run_model(modelo_xg,    stats, FEATURES_XG)
        tir_p, tir_c = run_model(modelo_tiros,  stats, FEATURES_TIROS)
        gol_p, gol_c = run_model(modelo_goles,  stats, FEATURES_GOLES)
        return {
            "xg":    {"probabilidad": xg_p,  "alto": xg_c  == 1},
            "tiros": {"probabilidad": tir_p, "alto": tir_c == 1},
            "goles": {"probabilidad": gol_p, "alto": gol_c == 1},
        }

    return {
        "local":     {"equipo": home, **predict_all(home_stats)},
        "visitante": {"equipo": away, **predict_all(away_stats)},
    }


@app.get("/match-result")
def match_result(
    home: str = Query(..., description="Equipo local"),
    away: str = Query(..., description="Equipo visitante"),
):
    """
    Devuelve el resultado real y si cada equipo cumplió los 3 targets:
    xG >= 1.5, Tiros a puerta > 4, Goles >= 2.
    """
    if df_historico is None:
        raise HTTPException(status_code=503, detail="Datos no disponibles")

    mask = (
        (df_historico['equipo_local']     == home) &
        (df_historico['equipo_visitante'] == away)
    )
    found = df_historico[mask]

    if found.empty:
        raise HTTPException(status_code=404, detail=f"Partido no encontrado: {home} vs {away}")

    row = found.sort_values('fecha', ascending=False).iloc[0]

    def team_stats(suffix: str) -> dict:
        def n(col):
            return pd.to_numeric(row.get(f'{col}{suffix}', 0), errors='coerce') or 0.0
        goles = int(n('goles'))
        xg    = round(float(n('Goles esperados (xG)')), 2)
        tiros = int(n('Tiros a puerta'))
        return {
            "goles":        goles,
            "xg":           xg,
            "tiros_puerta": tiros,
            "cumple_xg":    bool(xg >= 1.5),
            "cumple_tiros": bool(tiros > 4),
            "cumple_goles": bool(goles >= 2),
        }

    return {
        "fecha":     row['fecha'].strftime('%d/%m/%Y') if pd.notna(row['fecha']) else None,
        "local":     team_stats('_local'),
        "visitante": team_stats('_visitante'),
    }


@app.get("/modelo-info")
def info_modelo():
    return {
        "modelos": {
            "xg":    {"target": "xG >= 1.5",      "features": len(FEATURES_XG)},
            "tiros": {"target": "Tiros > 4",       "features": len(FEATURES_TIROS)},
            "goles": {"target": "Goles >= 2",      "features": len(FEATURES_GOLES)},
        },
        "ventanas":  ["prom_3 (momentum inmediato)", "prom_5 (tendencia reciente)"],
        "algoritmo": "XGBoost + SMOTE + división temporal 80/20",
    }
