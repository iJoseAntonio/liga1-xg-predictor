from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import numpy as np
import os

app = FastAPI(
    title="Liga 1 Perú — XGBoost xG Predictor",
    description="API para predicción de rendimiento ofensivo en la Liga 1 del Perú",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = "modelo_xgboost_liga1.pkl"
DATA_PATH  = "bd_liga1.csv"

modelo      = None
df_historico = None

# Columnas del CSV para extraer stats por equipo
COLS_STATS_CSV = [
    'goles', 'Posesión de pelota', 'Goles esperados (xG)', 'Tiros totales',
    'Tiros a puerta', 'Disparos al palo', 'Tiros fuera', 'Tiros bloqueados',
    'Tiros adentro del area', 'Tiros desde fuera del area', 'Fueras de juego',
    'Pases', 'Pases precisos', 'Saques de banda', 'Pases al ultimo tercio',
    'Entradas', 'Intercepciones', 'Recuperaciones', 'Despejes', 'Corners',
    'Faltas', 'Tarjetas amarillas', 'Tarjetas rojas',
]

# Features exactas del modelo (ventanas 3+5)
COLS_MODELO = [
    'goles', 'Posesión de pelota', 'Goles esperados (xG)',
    'Tiros a puerta', 'Disparos al palo', 'Tiros fuera', 'Tiros bloqueados',
    'Tiros adentro del area', 'Tiros desde fuera del area', 'Fueras de juego',
    'Saques de banda', 'Pases al ultimo tercio',
    'Entradas', 'Intercepciones', 'Recuperaciones', 'Despejes',
    'Corners', 'Faltas', 'Tarjetas amarillas', 'Tarjetas rojas',
    'precision_pases', 'precision_tiros'
]

FEATURES_FINAL = (
    [f'{col}_prom_3' for col in COLS_MODELO] +
    [f'{col}_prom_5' for col in COLS_MODELO] +
    ['Local']
)


@app.on_event("startup")
def cargar_recursos():
    global modelo, df_historico
    if os.path.exists(MODEL_PATH):
        modelo = joblib.load(MODEL_PATH)
        print("Modelo cargado correctamente.")
    else:
        print(f"ADVERTENCIA: {MODEL_PATH} no encontrado.")

    if os.path.exists(DATA_PATH):
        df_historico = pd.read_csv(DATA_PATH, sep=';')
        df_historico['fecha'] = pd.to_datetime(
            df_historico['fecha'], format='%d/%m/%Y', errors='coerce'
        )
        print(f"Datos históricos cargados: {len(df_historico)} partidos.")
    else:
        print(f"ADVERTENCIA: {DATA_PATH} no encontrado.")


# ── Helper ────────────────────────────────────────────────────────────────────
def compute_team_features(team_name: str, is_local: int) -> dict | None:
    """Calcula rolling features (últimos 3 y 5 partidos) para un equipo."""
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

    # Ratios de eficiencia (misma lógica que train.py)
    df_t['precision_pases'] = (
        df_t['Pases precisos'] / df_t['Pases'].replace(0, np.nan)
    ).fillna(0)
    df_t['precision_tiros'] = (
        df_t['Tiros a puerta'] / df_t['Tiros totales'].replace(0, np.nan)
    ).fillna(0)

    # Promedios de las últimas 3 y 5 jornadas (equivalente a shift(1).rolling en entrenamiento)
    features = {'Local': is_local}
    for col in COLS_MODELO:
        features[f'{col}_prom_3'] = float(df_t[col].tail(3).mean())
        features[f'{col}_prom_5'] = float(df_t[col].tail(5).mean())

    return features


def run_model(features: dict) -> tuple[float, int]:
    X = pd.DataFrame([features])[FEATURES_FINAL]
    prob  = float(modelo.predict_proba(X)[0][1])
    clase = int(modelo.predict(X)[0])
    return round(prob * 100, 1), clase


# ── Schemas ───────────────────────────────────────────────────────────────────
class DatosEquipo(BaseModel):
    goles_prom_3: float
    posesion_prom_3: float
    xg_prom_3: float
    tiros_puerta_prom_3: float
    tiros_area_prom_3: float
    precision_pases_prom_3: float
    precision_tiros_prom_3: float
    goles_prom_5: float
    posesion_prom_5: float
    xg_prom_5: float
    tiros_puerta_prom_5: float
    tiros_area_prom_5: float
    precision_pases_prom_5: float
    precision_tiros_prom_5: float
    local: int


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "sistema": "Liga 1 Perú — XGBoost xG Predictor",
        "estado": "activo",
        "endpoints": ["/predict", "/predict-match", "/health", "/modelo-info", "/docs"]
    }


@app.get("/health")
def health():
    return {
        "modelo_cargado": modelo is not None,
        "datos_cargados": df_historico is not None,
        "partidos_historicos": len(df_historico) if df_historico is not None else 0,
        "features": len(FEATURES_FINAL),
        "version": "1.0.0"
    }


@app.get("/predict-match")
def predict_match(
    home: str = Query(..., description="Nombre del equipo local"),
    away: str = Query(..., description="Nombre del equipo visitante"),
):
    """
    Predice el rendimiento ofensivo de ambos equipos usando sus últimos 3 y 5 partidos.
    Ejemplo: /predict-match?home=Universitario&away=Alianza Lima
    """
    if modelo is None:
        raise HTTPException(status_code=503, detail="Modelo no disponible")
    if df_historico is None:
        raise HTTPException(status_code=503, detail="Datos históricos no disponibles")

    home_feats = compute_team_features(home, is_local=1)
    away_feats = compute_team_features(away, is_local=0)

    if home_feats is None:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para: {home}")
    if away_feats is None:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para: {away}")

    home_prob, home_clase = run_model(home_feats)
    away_prob, away_clase = run_model(away_feats)

    return {
        "local": {
            "equipo":           home,
            "probabilidad":     home_prob,
            "alto_rendimiento": home_clase == 1,
        },
        "visitante": {
            "equipo":           away,
            "probabilidad":     away_prob,
            "alto_rendimiento": away_clase == 1,
        },
    }


@app.post("/predict")
def predecir_equipo(datos: DatosEquipo):
    if modelo is None:
        raise HTTPException(status_code=503, detail="Modelo no disponible")

    fila = {
        'goles_prom_3':                    datos.goles_prom_3,
        'Posesión de pelota_prom_3':       datos.posesion_prom_3,
        'Goles esperados (xG)_prom_3':     datos.xg_prom_3,
        'Tiros a puerta_prom_3':           datos.tiros_puerta_prom_3,
        'Tiros adentro del area_prom_3':   datos.tiros_area_prom_3,
        'precision_pases_prom_3':          datos.precision_pases_prom_3,
        'precision_tiros_prom_3':          datos.precision_tiros_prom_3,
        'goles_prom_5':                    datos.goles_prom_5,
        'Posesión de pelota_prom_5':       datos.posesion_prom_5,
        'Goles esperados (xG)_prom_5':     datos.xg_prom_5,
        'Tiros a puerta_prom_5':           datos.tiros_puerta_prom_5,
        'Tiros adentro del area_prom_5':   datos.tiros_area_prom_5,
        'precision_pases_prom_5':          datos.precision_pases_prom_5,
        'precision_tiros_prom_5':          datos.precision_tiros_prom_5,
        'Local':                           datos.local,
    }
    for feat in FEATURES_FINAL:
        if feat not in fila:
            fila[feat] = 0.0

    prob, clase = run_model(fila)
    return {
        "probabilidad_alto_rendimiento": prob,
        "clasificacion": "Alto Rendimiento Ofensivo" if clase == 1 else "Rendimiento Deficiente",
        "clase":           clase,
        "condicion_local": "Local" if datos.local == 1 else "Visitante",
    }


@app.get("/modelo-info")
def info_modelo():
    return {
        "total_features": len(FEATURES_FINAL),
        "ventanas":   ["prom_3 (momentum inmediato)", "prom_5 (tendencia reciente)"],
        "target":     "xG > 1.5 AND Tiros a puerta > 4 AND Goles >= 1",
        "algoritmo":  "XGBoost con SMOTE + división temporal 80/20",
        "features":   FEATURES_FINAL,
    }
