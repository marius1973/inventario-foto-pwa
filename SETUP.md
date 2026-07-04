# 🚀 Guía de Configuración - InventarioFoto PWA

## Instalación Rápida

### 1. Clonar repositorio

```bash
git clone https://github.com/marius1973/inventario-foto-pwa.git
cd inventario-foto-pwa
```

### 2. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 3. Ejecutar la app

```bash
python app.py
```

Abre http://localhost:5000 en tu navegador.

---

## Configuración de Variables de Entorno

### Variable: GEMINI_API_KEY

Para habilitar **análisis de imágenes con IA**, necesitas una API Key de Google Gemini.

#### ¿Por qué?

Sin esta configuración:
- ✅ La app funciona normalmente
- ❌ No hay análisis automático de categorías
- ❌ No hay sugerencia automática de nombres

Con GEMINI_API_KEY:
- ✅ Análisis automático de fotos
- ✅ Sugerencias de categoría y nombre
- ✅ Formulario muestra badge 🤖 con sugerencias

#### Obtener tu API Key

**Opción 1: Gratuitamente (Límite 60 solicitudes/minuto)**

1. Ve a: https://makersuite.google.com/app/apikey
2. Haz clic en "Create API Key"
3. Copia la clave que aparece
4. Guárdala de forma segura

**Opción 2: Versión de Pago (Mayor límite)**

1. Ve a Google Cloud Console
2. Activa Gemini API
3. Crea credenciales tipo API Key
4. Configura cuota según tu necesidad

#### Configurar la Variable

**Linux/Mac:**

```bash
export GEMINI_API_KEY="tu-api-key-aqui"
python app.py
```

**Windows (PowerShell):**

```powershell
$env:GEMINI_API_KEY="tu-api-key-aqui"
python app.py
```

**Windows (CMD):**

```cmd
set GEMINI_API_KEY=tu-api-key-aqui
python app.py
```

**Archivo .env (Recomendado)**

Crea un archivo `.env` en la raíz del proyecto:

```env
GEMINI_API_KEY=tu-api-key-aqui
```

Luego ejecuta:

```bash
python app.py
```

La app detectará automáticamente la variable en `.env`.

#### Verificar que funciona

1. Abre la app
2. Captura una foto de un producto
3. Espera 2-3 segundos
4. Deberías ver un badge 🤖 con sugerencias

Si no aparece el badge:
- Verifica que la variable esté configurada
- Revisa la consola del navegador (F12) para errores
- Asegúrate de tener conexión a internet

---

## Configuración en Producción

### Render (Recomendado)

1. Crea cuenta en https://render.com
2. Conecta tu repositorio GitHub
3. En la sección "Environment", agrega:

```
GEMINI_API_KEY = tu-api-key-aqui
```

4. Deploy automático cuando hagas push

### Variables de Entorno Importantes

| Variable | Valor por Defecto | Descripción |
|----------|------------------|-------------|
| GEMINI_API_KEY | (vacío) | API Key para análisis de imágenes |
| DATABASE | inventario.db | Archivo SQLite |
| UPLOAD_FOLDER | uploads/fotos | Carpeta para fotos |
| PORT | 5000 | Puerto del servidor |
| FLASK_ENV | production | Modo de ejecución |

---

## Estructura del Proyecto

```
inventario-foto-pwa/
├── app.py                          # Backend Flask + API
├── requirements.txt                # Dependencias Python
├── static/
│   ├── js/
│   │   ├── app.js                 # App principal
│   │   └── app.js (servicios)     # ApiService, StorageService, etc.
│   ├── css/
│   │   └── styles.css             # Tailwind + custom
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                       # Service Worker
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── templates/
│   └── index.html                 # HTML principal
├── uploads/fotos/                 # Carpeta de fotos subidas
├── README.md                       # Documentación principal
├── FEATURES.md                     # Este archivo - Guía de características
├── SETUP.md                        # Este archivo - Guía de configuración
├── render.yaml                     # Configuración Render (producción)
├── Procfile                        # Configuración Heroku
└── .env                            # Variables locales (no commitear)
```

---

## Base de Datos

### Tablas

#### tipos_producto

```sql
CREATE TABLE tipos_producto (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    descripcion TEXT,
    icono TEXT DEFAULT '📦',
    color TEXT DEFAULT '#3b82f6',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### productos

```sql
CREATE TABLE productos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    codigo_barras TEXT,
    cantidad INTEGER DEFAULT 1,
    precio_unitario REAL,
    tipo_producto_id TEXT NOT NULL,
    foto_url TEXT,
    foto_thumbnail TEXT,
    texto_ocr TEXT,
    latitud REAL,                    -- 🌍 NUEVA: Coordenada GPS
    longitud REAL,                   -- 🌍 NUEVA: Coordenada GPS
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP,
    sincronizado INTEGER DEFAULT 1,
    FOREIGN KEY (tipo_producto_id) REFERENCES tipos_producto(id)
);
```

#### configuracion

```sql
CREATE TABLE configuracion (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    moneda_simbolo TEXT DEFAULT 'S/',
    fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### POST /api/clasificar

**Análisis de imagen con IA**

**Request:**
```json
{
  "foto_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRgA..."
}
```

**Response (Éxito):**
```json
{
  "tipo_id": "tipo-2",
  "tipo_nombre": "Herramientas",
  "nombre_sugerido": "Destornillador Phillips #2"
}
```

**Response (Sin IA configurada):**
```json
{
  "error": "Clasificación no configurada"
}
```

**Nota**: Este endpoint **solo funciona con conexión** y requiere `GEMINI_API_KEY` configurada.

### POST /api/productos

**Crear producto (con geolocalización)**

**Request:**
```json
{
  "nombre": "Pintura Acrílica",
  "tipo_producto_id": "tipo-1",
  "cantidad": 5,
  "precio_unitario": 25.50,
  "descripcion": "Para interiores",
  "foto_base64": "data:image/jpeg;base64,/9j/...",
  "latitud": -12.0500,              // 🌍 NUEVA
  "longitud": -77.0250             // 🌍 NUEVA
}
```

**Response:**
```json
{
  "id": "prod-abc123",
  "nombre": "Pintura Acrílica",
  "latitud": -12.0500,
  "longitud": -77.0250,
  "fecha_creacion": "2026-05-25T10:30:00"
}
```

---

## Troubleshooting

### Error: "No module named 'google'"

**Solución:**
```bash
pip install google-generativeai
```

### Error: "Gemini no disponible"

**Causas comunes:**

1. **Variable no configurada**
   ```bash
   # Verifica que existe
   echo $GEMINI_API_KEY
   ```

2. **API Key inválida**
   - Obtén una nueva en https://makersuite.google.com/app/apikey

3. **Sin conexión a internet (servidor)**
   - Verifica que el servidor tiene acceso a Google APIs

### Error: "No se puede acceder a la cámara"

Verifica:
- [ ] HTTPS en producción (requerido para acceder a cámara)
- [ ] Permiso de cámara en el navegador
- [ ] Navegador moderno (Chrome, Firefox, Safari, Edge)

### La geolocalización no aparece

Verifica:
- [ ] El navegador pide permiso de ubicación
- [ ] Has permitido acceso a ubicación
- [ ] Tienes GPS/conexión de red (para obtener ubicación)

---

## Deployment

### Render.com (Recomendado)

1. Push tu código a GitHub
2. Crea cuenta en https://render.com
3. Conecta repositorio
4. En "Environment", agrega variables:
   ```
   GEMINI_API_KEY=tu-api-key-aqui
   ```
5. Deploy automático

### Heroku (Alternativa)

```bash
heroku login
heroku create tu-app-name
heroku config:set GEMINI_API_KEY=tu-api-key-aqui
git push heroku main
```

### Localmente (Desarrollo)

```bash
# Linux/Mac
export GEMINI_API_KEY="..."
python app.py

# Windows
set GEMINI_API_KEY=...
python app.py
```

---

## Mejores Prácticas

### Seguridad

❌ **NO hagas esto:**
```python
# Nunca hardcodees la API Key
GEMINI_API_KEY = "abc123..."  # ¡PELIGRO!
```

✅ **Haz esto:**
```python
# Usa variables de entorno
import os
api_key = os.environ.get('GEMINI_API_KEY')
```

### Git

❌ **No commits:**
- `.env` (contiene API Keys)
- `__pycache__/`
- `*.pyc`
- `uploads/fotos/*` (archivos grandes)

✅ **Sí commits:**
- `.env.example` (plantilla sin valores)
- Código fuente
- Documentación
- Configuración

**Archivo .gitignore:**
```
.env
__pycache__/
*.pyc
uploads/fotos/*
!uploads/fotos/.gitkeep
node_modules/
.DS_Store
```

### Performance

- Comprime imágenes antes de enviar
- Usa thumbnails (300x300px) para vista previa
- Limpia base de datos periódicamente
- Implementa paginación en búsquedas

---

## Monitoreo en Producción

### Logs

```bash
# Ver últimas líneas
tail -f logs/app.log

# Buscar errores
grep "Error\|Exception" logs/app.log

# Contar solicitudes a /api/clasificar
grep "/api/clasificar" logs/app.log | wc -l
```

### Métricas útiles

- Total de productos registrados
- Productos con ubicación GPS
- Análisis IA exitosos vs fallidos
- Uso de almacenamiento

---

## Soporte

### Documentación adicional

- [README.md](README.md) - Visión general
- [FEATURES.md](FEATURES.md) - Detalle de características
- [RESUMEN_EJECUTIVO.md](RESUMEN_EJECUTIVO.md) - Análisis arquitectónico

### Contacto

Para reportar bugs o sugerencias:
1. GitHub Issues: https://github.com/marius1973/inventario-foto-pwa/issues
2. Pull Requests: https://github.com/marius1973/inventario-foto-pwa/pulls

