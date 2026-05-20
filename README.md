# Liga 1 Perú — XGBoost xG Predictor

Modelo de Machine Learning para predicción de rendimiento ofensivo en la Liga 1 del Perú.
Tesis — UNMSM, Facultad de Ingeniería de Sistemas e Informática.

## Estructura
```
├── main.py                        ← API FastAPI (Render Web Service)
├── train.py                       ← Reentrenamiento local por jornada
├── modelo_xgboost_liga1.pkl       ← Modelo entrenado
├── hiperparametros_optimos_78.json← Hiperparámetros óptimos (Optuna)
├── requirements.txt               ← Dependencias
└── BD/
    └── bd_liga1_Peru.csv          ← Dataset actualizado
```

## Ciclo de actualización por jornada
```bash
python train.py
git add .
git commit -m "jornada X actualizada"
git push
```

## Render — configuración
- **Runtime:** Python 3
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
