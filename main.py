from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import numpy as np
import json
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
modelo = None

@app.on_event("startup")
def cargar_modelo():
    global modelo
    if os.path.exists(MODEL_PATH):
        modelo = joblib.load(MODEL_PATH)
        print("Modelo cargado correctamente.")
    else:
        print(f"ADVERTENCIA: {MODEL_PATH} no encontrado.")

# ── Features exactas del notebook (ventanas 3+5) ──────────────────────────────
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

# ── Schemas ───────────────────────────────────────────────────────────────────
class DatosEquipo(BaseModel):
    # Promedios de ventana 3 (últimos 3 partidos)
    goles_prom_3: float
    posesion_prom_3: float
    xg_prom_3: float
    tiros_puerta_prom_3: float
    tiros_area_prom_3: float
    precision_pases_prom_3: float
    precision_tiros_prom_3: float
    # Promedios de ventana 5 (últimos 5 partidos)
    goles_prom_5: float
    posesion_prom_5: float
    xg_prom_5: float
    tiros_puerta_prom_5: float
    tiros_area_prom_5: float
    precision_pases_prom_5: float
    precision_tiros_prom_5: float
    # Variable situacional
    local: int  # 1 = local, 0 = visitante

class FixtureJornada(BaseModel):
    fixture: dict  # {"Universitario": 1, "Alianza Lima": 0, ...}

# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "sistema": "Liga 1 Perú — XGBoost xG Predictor",
        "estado": "activo",
        "endpoints": ["/predict", "/predict-jornada", "/health", "/docs"]
    }

@app.get("/health")
def health():
    return {
        "modelo_cargado": modelo is not None,
        "features": len(FEATURES_FINAL),
        "version": "1.0.0"
    }

@app.post("/predict")
def predecir_equipo(datos: DatosEquipo):
    if modelo is None:
        raise HTTPException(status_code=503, detail="Modelo no disponible")

    fila = {
        'goles_prom_3': datos.goles_prom_3,
        'Posesión de pelota_prom_3': datos.posesion_prom_3,
        'Goles esperados (xG)_prom_3': datos.xg_prom_3,
        'Tiros a puerta_prom_3': datos.tiros_puerta_prom_3,
        'Tiros adentro del area_prom_3': datos.tiros_area_prom_3,
        'precision_pases_prom_3': datos.precision_pases_prom_3,
        'precision_tiros_prom_3': datos.precision_tiros_prom_3,
        'goles_prom_5': datos.goles_prom_5,
        'Posesión de pelota_prom_5': datos.posesion_prom_5,
        'Goles esperados (xG)_prom_5': datos.xg_prom_5,
        'Tiros a puerta_prom_5': datos.tiros_puerta_prom_5,
        'Tiros adentro del area_prom_5': datos.tiros_area_prom_5,
        'precision_pases_prom_5': datos.precision_pases_prom_5,
        'precision_tiros_prom_5': datos.precision_tiros_prom_5,
        'Local': datos.local,
    }

    # Rellenar columnas faltantes con 0
    for feat in FEATURES_FINAL:
        if feat not in fila:
            fila[feat] = 0.0

    X = pd.DataFrame([fila])[FEATURES_FINAL]
    prob = float(modelo.predict_proba(X)[0][1])
    clase = int(modelo.predict(X)[0])

    return {
        "probabilidad_alto_rendimiento": round(prob * 100, 1),
        "clasificacion": "Alto Rendimiento Ofensivo" if clase == 1 else "Rendimiento Deficiente",
        "clase": clase,
        "condicion_local": "Local" if datos.local == 1 else "Visitante"
    }

@app.get("/modelo-info")
def info_modelo():
    return {
        "total_features": len(FEATURES_FINAL),
        "ventanas": ["prom_3 (momentum inmediato)", "prom_5 (tendencia reciente)"],
        "target": "xG > 1.5 AND Tiros a puerta > 4 AND Goles >= 1",
        "algoritmo": "XGBoost con SMOTE + división temporal 80/20",
        "features": FEATURES_FINAL
    }
