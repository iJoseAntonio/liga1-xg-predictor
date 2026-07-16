# Liga 1 Perú — XGBoost xG Predictor

Modelo de Machine Learning para predicción de rendimiento ofensivo en la Liga 1 del Perú.
Tesis — UNMSM, Facultad de Ingeniería de Sistemas e Informática.

## Estructura
```
├── back/                        ← Backend (Render Web Service)
│   ├── main.py                   ← API FastAPI
│   ├── requirements.txt
│   ├── .python-version
│   ├── data/                     ← Datos consumidos por el backend
│   │   ├── bd_liga1.csv           ← Dataset histórico (se actualiza por jornada)
│   │   └── partidos_liga1_2026.csv← Fixture de la temporada actual
│   └── modelos/
│       ├── shap_values.json       ← Valores SHAP (endpoint /shap-values)
│       ├── corregidos/            ← Modelos vigentes (usados por main.py)
│       │   ├── Goles/             ← .pkl + hiperparámetros + métricas (Goles ≥ 2)
│       │   ├── Goles_Esperadas/    ← .pkl + hiperparámetros + métricas (xG ≥ 1.5)
│       │   ├── Tiros_Puerta/       ← .pkl + hiperparámetros + métricas (Tiros ≥ 5)
│       │   └── metricas_modelos.json ← Comparación combinada de los 3 targets
│       └── legacy/                ← Modelos anteriores (Optuna optimizado contra
│                                     test, conservados como referencia histórica)
│
├── frontend/                    ← Sitio estático (Azure Static Web Apps)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── tabla_liga1_peru.csv      ← Tabla de posiciones, leída client-side
│
└── notebooks/                   ← Notebooks de análisis y entrenamiento
    ├── Ingenieria_Caracteristicas_Modelos_Predictivos.ipynb
    ├── Modelo_Predictivo_Goles.ipynb
    ├── Modelo_Predictivo_Goles_Esperados.ipynb
    ├── Modelo_Predictivo_Tiros_Puerta.ipynb
    └── Seleccion_Umbrales_Target..ipynb
```

> **Nota metodológica:** los modelos en `back/modelos/legacy/` fueron optimizados con
> Optuna evaluando directamente contra el conjunto de test, lo cual infla sus métricas
> reportadas (data leakage). Los modelos en `back/modelos/corregidos/` usan validación
> cruzada temporal (`TimeSeriesSplit`) dentro del conjunto de entrenamiento, evitando
> ese problema — son los que usa la API en producción.

> **Despliegue:** el backend vive en `back/` y se despliega en Render con **Root
> Directory = `back`** (ver sección Render más abajo). El frontend (`frontend/`) se
> despliega por separado en Azure Static Web Apps (ver
> `.github/workflows/azure-static-web-apps-*.yml`, `app_location: "/frontend"`).

## Ciclo de actualización por jornada
Reentrenar los 3 modelos corriendo `notebooks/Ingenieria_Caracteristicas_Modelos_Predictivos.ipynb`
(cambiando `MODELO_ACTIVO` entre `'goles'`, `'tiros'`, `'xg'`), luego:
```bash
git add .
git commit -m "jornada X actualizada"
git push
```

## Render — configuración
- **Runtime:** Python 3
- **Root Directory:** `back`
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
