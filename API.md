# 📡 API Reference - InventarioFoto PWA

## Endpoints Disponibles

### Gestión de Productos

#### GET `/api/productos`

Obtiene lista de productos. Parámetros opcionales: `tipo_id`, `q` (busca en nombre y código de barras), `limit` y `offset` (paginación; sin `limit` devuelve todo).

**Query Parameters:**
```
?tipo_producto_id=tipo-1    // Filtrar por tipo
?nombre=pintura              // Buscar por nombre
?limit=10                    // Límite de resultados
?offset=0                    // Offset para paginación
```

**Response:**
```json
{
  "productos": [
    {
      "id": "prod-abc123",
      "nombre": "Pintura Roja",
      "tipo_producto_id": "tipo-1",
      "cantidad": 5,
      "precio_unitario": 25.50,
      "foto_url": "/uploads/fotos/img123.jpg",
      "latitud": -12.0500,
      "longitud": -77.0250,
      "fecha_creacion": "2026-05-25T10:30:00"
    }
  ]
}
```

---

#### POST `/api/productos`

Crea un nuevo producto.

**Request:**
```json
{
  "nombre": "Pintura Acrílica Blanca",
  "tipo_producto_id": "tipo-1",
  "cantidad": 10,
  "precio_unitario": 25.50,
  "descripcion": "Pintura para interiores",
  "foto_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "latitud": -12.0500,
  "longitud": -77.0250
}
```

**Response (201 Created):**
```json
{
  "id": "prod-xyz789",
  "nombre": "Pintura Acrílica Blanca",
  "tipo_producto_id": "tipo-1",
  "cantidad": 10,
  "precio_unitario": 25.50,
  "foto_url": "/uploads/fotos/abc123.jpg",
  "foto_thumbnail": "data:image/jpeg;base64,...",
  "latitud": -12.0500,
  "longitud": -77.0250,
  "fecha_creacion": "2026-05-25T10:30:00"
}
```

**Errores:**
```json
{
  "error": "Nombre requerido"
}
```

---

#### PUT `/api/productos/<id>`

Actualiza un producto. Acepta `multipart/form-data` o JSON. Solo modifica los campos enviados (actualización parcial).

**Campos opcionales:** `nombre`, `descripcion`, `codigo_barras`, `cantidad`, `precio_unitario` (vacío = borrar precio), `tipo_producto_id`, `foto` (archivo) o `foto_base64` (reemplaza la foto anterior).

**Response (200):** el producto actualizado, con `tipo_nombre`, `tipo_icono` y `tipo_color`.

**Errores:** `404` si no existe, `400` si nombre vacío, tipo vacío, o cantidad/precio inválidos.

---

#### PUT `/api/tipos-producto/<id>`

Actualiza un tipo (JSON): `nombre`, `descripcion`, `icono`, `color`. Errores: `404` si no existe, `409` si el nombre ya está en uso, `400` si nombre vacío.

---

#### DELETE `/api/tipos-producto/<id>`

Elimina un tipo. Si tiene productos asociados devuelve `409` con `{productos: N}`; reintenta con `?reasignar_a=<otro_tipo_id>` para mover los productos antes de eliminar. **Response (200):** `{message, reasignados}`.

---

#### GET `/api/export`

Exporta el inventario. Parámetros: `formato` (`xlsx` por defecto, o `csv`), y opcionalmente los mismos filtros del listado (`tipo_id`, `q`).

**Response (200):** archivo descargable `inventario_YYYY-MM-DD.xlsx` (con cabecera con estilo, autofiltro, panel congelado y fila TOTAL) o `.csv` (UTF-8 con BOM, compatible con Excel).

---

#### DELETE `/api/productos/<id>`

Elimina un producto.

**Response (204 No Content):**
```
(sin contenido)
```

---

### 🌍 Geolocalización

#### POST `/api/productos` (con geolocalización)

Al crear un producto, incluye `latitud` y `longitud` para registrar la ubicación.

**Datos guardados:**
- `latitud` (REAL): Coordenada Y (-90 a +90)
- `longitud` (REAL): Coordenada X (-180 a +180)

**Ejemplo:**
```json
{
  "nombre": "Producto",
  "tipo_producto_id": "tipo-1",
  "foto_base64": "...",
  "latitud": -12.0500,
  "longitud": -77.0250
}
```

**Respuesta incluye:**
```json
{
  "id": "prod-123",
  "latitud": -12.0500,
  "longitud": -77.0250,
  "enlace_mapa": "https://www.google.com/maps?q=-12.0500,-77.0250"
}
```

---

### 🤖 Análisis de Imágenes con IA

#### POST `/api/clasificar`

**IMPORTANTE**: Requiere `GEMINI_API_KEY` configurada.

Analiza una imagen de producto para detectar categoría y sugerir nombre.

**Request:**
```json
{
  "foto_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
}
```

**Response (200 OK):**
```json
{
  "tipo_id": "tipo-2",
  "tipo_nombre": "Herramientas",
  "nombre_sugerido": "Destornillador Phillips #2 cromado"
}
```

**Response sin GEMINI_API_KEY (503):**
```json
{
  "error": "Clasificación no configurada"
}
```

**Response con error de procesamiento (500):**
```json
{
  "error": "No se pudo clasificar"
}
```

**Cómo usar:**

```javascript
// Ejemplo en JavaScript
const clasificar = async (fotoBase64) => {
  const response = await fetch('/api/clasificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foto_base64: fotoBase64 })
  });
  
  if (response.ok) {
    const resultado = await response.json();
    console.log('Categoría detectada:', resultado.tipo_nombre);
    console.log('Nombre sugerido:', resultado.nombre_sugerido);
  }
};
```

---

### Gestión de Tipos

#### GET `/api/tipos-producto`

Obtiene lista de categorías/tipos.

**Response:**
```json
{
  "tipos": [
    {
      "id": "tipo-1",
      "nombre": "Pintura",
      "descripcion": "Productos de pintura",
      "icono": "🎨",
      "color": "#3b82f6"
    },
    {
      "id": "tipo-2",
      "nombre": "Herramientas",
      "descripcion": "Herramientas manuales",
      "icono": "🔧",
      "color": "#f59e0b"
    }
  ]
}
```

---

#### POST `/api/tipos-producto`

Crea una nueva categoría.

**Request:**
```json
{
  "nombre": "Adhesivos",
  "descripcion": "Pegamentos y adhesivos",
  "icono": "🖇️",
  "color": "#ec4899"
}
```

**Response (201 Created):**
```json
{
  "id": "tipo-8",
  "nombre": "Adhesivos",
  "descripcion": "Pegamentos y adhesivos",
  "icono": "🖇️",
  "color": "#ec4899"
}
```

---

### Sincronización Offline

#### POST `/api/sync`

Sincroniza cambios locales pendientes al servidor.

**Request:**
```json
{
  "productos": [
    {
      "id": "prod-local-1",
      "nombre": "Producto nuevo",
      "tipo_producto_id": "tipo-1",
      "cantidad": 5,
      "precio_unitario": 25,
      "foto_base64": "...",
      "latitud": -12.05,
      "longitud": -77.02,
      "timestamp": "2026-05-25T10:30:00Z"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "sincronizados": [
    {
      "id_local": "prod-local-1",
      "id_servidor": "prod-xyz789"
    }
  ],
  "timestamp": "2026-05-25T10:31:00Z"
}
```

---

### Configuración

#### GET `/api/config`

Obtiene configuración actual (ej: símbolo de moneda).

**Response:**
```json
{
  "moneda_simbolo": "S/"
}
```

---

#### POST `/api/config`

Actualiza configuración.

**Request:**
```json
{
  "moneda_simbolo": "$"
}
```

**Response:**
```json
{
  "moneda_simbolo": "$"
}
```

---

### Estadísticas

#### GET `/api/estadisticas`

Obtiene estadísticas del inventario.

**Response:**
```json
{
  "total_productos": 42,
  "valor_total": 1050.75,
  "productos_recientes": 5,
  "por_tipo": [
    {
      "nombre": "Pintura",
      "icono": "🎨",
      "color": "#3b82f6",
      "cantidad": 20
    },
    {
      "nombre": "Herramientas",
      "icono": "🔧",
      "color": "#f59e0b",
      "cantidad": 15
    }
  ]
}
```

---

## Formatos Comunes

### foto_base64

Las fotos se envían en formato Base64 Data URL:

```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwwDAwsFBAMEBQAFB...
```

Para convertir en JavaScript:
```javascript
// Desde canvas (cámara)
canvas.toDataURL('image/jpeg')

// Desde input file
const file = document.getElementById('fileInput').files[0];
const reader = new FileReader();
reader.onload = (e) => {
  const base64 = e.target.result; // Ya incluye "data:image/jpeg;base64,"
};
reader.readAsDataURL(file);
```

### Coordenadas GPS

```javascript
{
  "latitud": -12.0500,    // Rango: -90 a +90
  "longitud": -77.0250    // Rango: -180 a +180
}

// Para abrir en Google Maps:
// https://www.google.com/maps?q=LATITUD,LONGITUD
// https://www.google.com/maps?q=-12.0500,-77.0250
```

### Timestamps

Formato ISO 8601:
```
2026-05-25T10:30:00Z       // UTC
2026-05-25T10:30:00-05:00  // Con zona horaria
```

---

## Códigos de Estado HTTP

| Código | Significado | Ejemplo |
|--------|------------|---------|
| 200 | Éxito (GET, POST sin creación) | Obtener productos |
| 201 | Creado | POST /api/productos |
| 204 | Sin contenido | DELETE successful |
| 400 | Solicitud inválida | Datos faltantes |
| 404 | No encontrado | ID de producto inválido |
| 500 | Error del servidor | Error en procesamiento |
| 503 | Servicio no disponible | IA no configurada |

---

## Headers Comunes

**Request:**
```
Content-Type: application/json
```

**Response:**
```
Content-Type: application/json
```

---

## Ejemplos Completos

### Crear Producto con Geolocalización

```bash
curl -X POST http://localhost:5000/api/productos \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Pintura Roja Brillante",
    "tipo_producto_id": "tipo-1",
    "cantidad": 10,
    "precio_unitario": 35.50,
    "foto_base64": "data:image/jpeg;base64,...",
    "latitud": -12.0500,
    "longitud": -77.0250
  }'
```

### Analizar Imagen con IA

```bash
curl -X POST http://localhost:5000/api/clasificar \
  -H "Content-Type: application/json" \
  -d '{
    "foto_base64": "data:image/jpeg;base64,..."
  }'
```

### Buscar Productos

```bash
curl http://localhost:5000/api/productos?nombre=pintura&tipo_producto_id=tipo-1
```

---

## Limitaciones y Consideraciones

### Análisis de Imágenes (/api/clasificar)

- **Requiere conexión** a Google Gemini API
- **Requiere GEMINI_API_KEY** configurada
- **Tarda 1-3 segundos** por imagen
- **Límite gratuito**: 60 solicitudes/minuto
- **Funciona mejor con** fotos claras y bien iluminadas
- **No funciona offline**

### Geolocalización

- **Requiere permiso del usuario** en el navegador
- **Funciona en HTTP y HTTPS**
- **Precisión**: ±20-50 metros (depende de GPS/red)
- **Funciona offline**: La captura se almacena localmente

### Fotos

- **Tamaño máximo**: 25MB (configurable)
- **Formatos**: JPEG, PNG, WebP
- **Se comprimen**: Automáticamente a JPEG
- **Thumbnails**: 300x300px con calidad 70

---

## Roadmap API

- [ ] Autenticación con JWT
- [ ] Rate limiting por IP
- [ ] Paginación automática
- [ ] Filtros avanzados
- [ ] Exportar a CSV/Excel
- [ ] Webhooks para eventos
- [ ] GraphQL endpoint
- [ ] Versionado de API (v1, v2)

