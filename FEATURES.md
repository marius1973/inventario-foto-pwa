# 🎯 Características Principales de InventarioFoto PWA

## 1. 📸 Captura de Fotos y Registro de Productos

**¿Qué hace?**

La aplicación permite capturar una foto del producto y registrarlo al instante con:
- Nombre del producto
- Categoría (tipo)
- Cantidad
- Precio unitario
- Descripción adicional

**¿Cómo usarlo?**

1. Abre la app en tu navegador o móvil
2. Haz clic en el botón de cámara
3. Toma una foto del producto
4. Completa los datos básicos
5. Haz clic en "Guardar"

---

## 2. 🌍 Geolocalización GPS

**¿Qué es?**

Cuando registras un producto, la app **captura automáticamente tu ubicación geográfica** (coordenadas GPS).

**¿Para qué sirve?**

- **Rastreo de ubicación**: Saber dónde se registró cada producto
- **Mapeo de inventario**: Ver todos los productos por zona geográfica
- **Historial de movimiento**: Seguir cómo se movió el producto
- **Análisis espacial**: Identificar patrones de distribución

**¿Cómo funciona?**

```
Usuario captura foto
    ↓
App pide permiso de ubicación al navegador
    ↓
Navegador obtiene coordenadas GPS
    ↓
Se guardan junto con el producto:
  - latitud: 12.0500°
  - longitud: -77.0250°
    ↓
En el detalle del producto aparece un botón con 📍
    ↓
Al hacer clic → Abre Google Maps con esa ubicación
```

**Configuración**

La geolocalización requiere **HTTPS en producción** y **permiso del usuario**. El navegador pedirá permiso la primera vez.

**Datos almacenados**

- `latitud` (REAL): Coordenada Y
- `longitud` (REAL): Coordenada X
- Se guardan en la tabla `productos` automáticamente

**Ejemplo**

```javascript
// En el código, se captura así:
this._capturarUbicacion(); // Geolocation API

// Resultado:
{
  latitud: -12.0500,
  longitud: -77.0250,
  // Se envía al servidor junto con el producto
}
```

---

## 3. 🤖 Análisis de Imágenes con IA

**¿Qué es?**

La app puede analizar automáticamente **la foto del producto** para sugerir:

1. **Categoría**: ¿Qué tipo de producto es?
2. **Nombre**: Una descripción breve y descriptiva

**¿Para qué sirve?**

- Acelerar el registro de productos
- Reducir errores manuales en clasificación
- Sugerir nombres consistentes
- Ahorrar tiempo en operaciones

**¿Cómo funciona?**

```
Usuario toma foto del producto
    ↓
Se abre formulario de registro
    ↓
App envía foto al servidor (si hay conexión)
    ↓
Servidor analiza imagen con modelo de visión IA
    ↓
Modelo responde:
  {
    "categoria": "Pintura",
    "nombre_sugerido": "Pintura acrílica roja brillante"
  }
    ↓
App muestra sugerencia al usuario con icono 🤖
    ↓
Usuario puede:
  - Aceptar sugerencia ✓
  - Editar manualmente
  - Ignorar
    ↓
Se guarda lo que eligió el usuario
```

**Ejemplos Reales**

| Foto | Categoría Detectada | Nombre Sugerido |
|------|-------------------|-----------------|
| 🎨 Lata de pintura | Pintura | Pintura látex blanca semi-mate |
| 🔧 Llave inglesa | Herramientas | Llave inglesa cromada 12" |
| 🥫 Lata de aceite | Lubricantes | Aceite industrial SAE 40 |
| 📦 Tuerca métrica | Ferretería | Tuerca M10 zincada |

**Requisitos de Configuración**

Para usar esta función, necesitas:

1. **API Key de Google Gemini**
   ```bash
   # En archivo .env o variable de entorno:
   GEMINI_API_KEY=tu-api-key-de-google-gemini
   ```

2. **Conexión a Internet** (en el servidor)
   - Solo funciona con conexión (para enviar imagen y recibir análisis)
   - Si no hay conexión, la app funciona sin esta función

3. **Permisos**
   - La app no envía imágenes a terceros sin tu configuración
   - Solo si configuras la variable GEMINI_API_KEY

**Limitaciones y Consideraciones**

- **Requiere conexión**: No funciona en modo offline
- **Velocidad**: El análisis toma 1-3 segundos
- **Precisión**: Funciona mejor con fotos claras y bien iluminadas
- **Privacidad**: Las imágenes se envían al servidor para análisis

**¿Cómo obtener API Key de Google Gemini?**

1. Ve a https://makersuite.google.com/app/apikey
2. Crea una nueva API key gratuita
3. Configura la variable de entorno en tu servidor

---

## 4. 💾 Sincronización Offline

**¿Qué es?**

La app **funciona completamente sin internet** y se sincroniza automáticamente cuando te conectas.

**¿Cómo funciona?**

```
Sin Internet:
  - Tomas foto → Se guarda LOCALMENTE en el navegador
  - Completas datos → Se almacena en IndexedDB
  - Ves confirmación inmediata
  
Conexión Restaurada:
  - App detecta que volvió la conexión
  - Envía automáticamente todos los registros pendientes
  - Resuelve conflictos (última actualización gana)
  - Sincronización transparente para el usuario
```

---

## 5. 🔍 Búsqueda y Filtrado

Busca productos por:

- **Nombre**: "Pintura roja"
- **Categoría**: "Herramientas"
- **Descripción**: Texto libre

Las búsquedas funcionan incluso en modo offline.

---

## 6. 📊 Estadísticas y Reportes

Dashboard con:

- Total de productos registrados
- Valor total del inventario
- Productos por categoría
- Productos registrados recientemente
- Configuración de moneda (S/, $, €, etc.)

---

## Comparación de Características

| Característica | Offline | Online | Sincronización |
|---|---|---|---|
| Captura de fotos | ✅ | ✅ | ✓ |
| Registro de productos | ✅ | ✅ | ✓ |
| **Geolocalización** | ⚠️* | ✅ | ✓ |
| **Análisis IA** | ❌ | ✅ | - |
| Búsqueda | ✅ | ✅ | - |
| Eliminación | ✅ | ✅ | ✓ |
| Estadísticas | ✅ | ✅ | - |

*⚠️ La geolocalización funciona offline pero depende del navegador

---

## Arquitectura Técnica

### Frontend (JavaScript + Tailwind CSS)

```
CameraManager
  └─ Captura fotos con getUserMedia API

GeoLocationService
  └─ Obtiene coordenadas GPS (Geolocation API)

ApiService
  └─ /api/clasificar → Envía foto para análisis
  └─ /api/productos → Guarda con ubicación

StorageService
  └─ IndexedDB para datos offline
  └─ Sincronización automática
```

### Backend (Python Flask + SQLite)

```
/api/clasificar (POST)
  ├─ Recibe: foto_base64
  ├─ Procesa: Google Gemini Vision API
  ├─ Responde: {tipo_id, tipo_nombre, nombre_sugerido}
  └─ No toca BD (solo análisis)

/api/productos (POST)
  ├─ Recibe: nombre, tipo_id, latitud, longitud, foto
  ├─ Valida datos
  ├─ Guarda en SQLite con coordenadas GPS
  └─ Responde: producto creado
```

---

## Fórmulas y Cálculos

### Valor Total del Inventario

```
Valor = Σ(cantidad × precio_unitario)
```

### MTBF y MTTR (en contexto de mantenimiento)

Si se usa para inventario de equipos:

```
MTBF = Tiempo total operativo / Número de fallas
MTTR = Tiempo total reparación / Número de fallas
Disponibilidad = MTBF / (MTBF + MTTR) × 100%
```

---

## Seguridad y Privacidad

- **Geolocalización**: Requiere permiso del usuario, datos locales y en servidor
- **Imágenes**: Se procesan en el servidor, no se almacenan sin tu permiso
- **API Keys**: Nunca expongas tu GEMINI_API_KEY en el código público
- **Datos offline**: Se sincroniza al servidor con Last-Write-Wins

---

## Preguntas Frecuentes

**¿Funciona sin internet?**
Sí, excepto el análisis IA (que necesita conexión al servidor).

**¿Cuánto espacio usa localmente?**
Depende de cantidad de fotos. Base64 hace fotos 33% más grandes.

**¿La IA ve mi foto siempre?**
Solo si configuras GEMINI_API_KEY. Sin ella, no se envía nada.

**¿Puedo exportar los datos?**
Sí, todos se sincronizan al servidor en SQLite (puedes hacer backup).

**¿Es lento con muchos productos?**
La búsqueda en IndexedDB es rápida (<100ms) hasta 10k productos.

---

## Roadmap Futuro

- [ ] Exportar a Excel/CSV
- [ ] Reportes PDF
- [ ] Detección de código de barras
- [ ] Notificaciones push
- [ ] Múltiples ubicaciones
- [ ] Usuarios y permisos
- [ ] API REST pública
- [ ] Aplicación móvil (React Native)

