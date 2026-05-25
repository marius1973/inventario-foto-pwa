"""
InventarioFoto - Sistema de gestión de inventario con captura por fotografía.
Versión estable con mejoras de arquitectura.
"""

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import os
import uuid
from datetime import datetime
import base64
from PIL import Image
import io
from pathlib import Path
import json

# ============================================================================
# CONFIGURACIÓN
# ============================================================================

UPLOAD_FOLDER = 'uploads/fotos'
DATABASE = 'inventario.db'
MAX_CONTENT_LENGTH = 25 * 1024 * 1024
THUMBNAIL_SIZE = (300, 300)
THUMBNAIL_QUALITY = 70

Path(UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# ============================================================================
# DATABASE HELPERS
# ============================================================================

def get_db():
    """Obtiene una conexión a la base de datos."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Inicializa la base de datos."""
    conn = get_db()
    cursor = conn.cursor()

    # Crear tabla de tipos
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tipos_producto (
            id TEXT PRIMARY KEY,
            nombre TEXT NOT NULL UNIQUE,
            descripcion TEXT,
            icono TEXT DEFAULT '📦',
            color TEXT DEFAULT '#3b82f6',
            fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Crear tabla de productos
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS productos (
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
            latitud REAL,
            longitud REAL,
            fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
            fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP,
            sincronizado INTEGER DEFAULT 1,
            FOREIGN KEY (tipo_producto_id) REFERENCES tipos_producto(id)
        )
    """)

    # Crear tabla de configuración
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS configuracion (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            moneda_simbolo TEXT DEFAULT 'S/',
            fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migrar tabla existente si faltan columnas
    cursor.execute("PRAGMA table_info(productos)")
    columnas = [col[1] for col in cursor.fetchall()]
    if 'latitud' not in columnas:
        cursor.execute("ALTER TABLE productos ADD COLUMN latitud REAL")
    if 'longitud' not in columnas:
        cursor.execute("ALTER TABLE productos ADD COLUMN longitud REAL")

    # Insertar tipos por defecto
    cursor.execute("SELECT COUNT(*) as count FROM tipos_producto")
    if cursor.fetchone()['count'] == 0:
        tipos_default = [
            ('tipo-1', 'Electrónica', 'Dispositivos electrónicos', '🔌', '#3b82f6'),
            ('tipo-2', 'Herramientas', 'Herramientas manuales', '🔧', '#f59e0b'),
            ('tipo-3', 'Alimentos', 'Productos comestibles', '🍎', '#22c55e'),
            ('tipo-4', 'Ropa', 'Vestimenta', '👕', '#8b5cf6'),
            ('tipo-5', 'Hogar', 'Artículos de hogar', '🏠', '#ec4899'),
            ('tipo-6', 'Papelería', 'Útiles de oficina', '✏️', '#06b6d4'),
            ('tipo-7', 'Sin clasificar', 'Pendiente de clasificar', '❓', '#64748b'),
        ]
        cursor.executemany(
            "INSERT INTO tipos_producto (id, nombre, descripcion, icono, color) VALUES (?, ?, ?, ?, ?)",
            tipos_default
        )

    # Insertar configuración por defecto
    cursor.execute("SELECT COUNT(*) as count FROM configuracion")
    if cursor.fetchone()['count'] == 0:
        cursor.execute(
            "INSERT INTO configuracion (id, moneda_simbolo) VALUES (1, 'S/')"
        )

    conn.commit()
    conn.close()
    print("✅ Base de datos inicializada")


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def generar_thumbnail(image_data, max_size=THUMBNAIL_SIZE):
    """Genera un thumbnail en base64."""
    try:
        img = Image.open(io.BytesIO(image_data))
        img.thumbnail(max_size, Image.LANCZOS)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=THUMBNAIL_QUALITY)
        img_str = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/jpeg;base64,{img_str}"
    except Exception as e:
        print(f"Error generando thumbnail: {e}")
        return None


# ============================================================================
# ROUTES - FRONTEND
# ============================================================================

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/sw.js')
def service_worker():
    response = send_from_directory('static', 'sw.js')
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.route('/uploads/fotos/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ============================================================================
# API - CONFIGURACION
# ============================================================================

@app.route('/api/config', methods=['GET'])
def get_config():
    """Obtiene la configuración de la aplicación."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT moneda_simbolo FROM configuracion WHERE id = 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return jsonify({'moneda_simbolo': row['moneda_simbolo']})
    return jsonify({'moneda_simbolo': 'S/'})


@app.route('/api/config', methods=['POST'])
def update_config():
    """Actualiza la configuración de la aplicación."""
    data = request.get_json(silent=True) or {}
    moneda_simbolo = (data.get('moneda_simbolo') or 'S/').strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE configuracion SET moneda_simbolo = ? WHERE id = 1", (moneda_simbolo,))
    conn.commit()
    conn.close()
    return jsonify({'moneda_simbolo': moneda_simbolo}), 200


# ============================================================================
# API - TIPOS PRODUCTO
# ============================================================================

@app.route('/api/tipos-producto', methods=['GET'])
def get_tipos():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tipos_producto ORDER BY nombre")
    tipos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(tipos)


@app.route('/api/tipos-producto', methods=['POST'])
def create_tipo():
    data = request.get_json(silent=True) or {}
    nombre = (data.get('nombre') or '').strip()

    if not nombre:
        return jsonify({'error': 'El nombre del tipo es obligatorio'}), 400

    tipo_id = f"tipo-{uuid.uuid4().hex[:8]}"
    conn = get_db()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO tipos_producto (id, nombre, descripcion, icono, color)
            VALUES (?, ?, ?, ?, ?)
        """, (tipo_id, nombre, data.get('descripcion', ''),
              data.get('icono', '📦'), data.get('color', '#3b82f6')))
        conn.commit()
        cursor.execute("SELECT * FROM tipos_producto WHERE id = ?", (tipo_id,))
        tipo = dict(cursor.fetchone())
        conn.close()
        return jsonify(tipo), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Ya existe ese tipo'}), 409


# ============================================================================
# API - PRODUCTOS
# ============================================================================

@app.route('/api/productos', methods=['GET'])
def get_productos():
    tipo_id = request.args.get('tipo_id')
    busqueda = request.args.get('q')
    conn = get_db()
    cursor = conn.cursor()

    query = """
        SELECT p.*, t.nombre as tipo_nombre, t.icono as tipo_icono, t.color as tipo_color
        FROM productos p
        JOIN tipos_producto t ON p.tipo_producto_id = t.id
        WHERE 1=1
    """
    params = []

    if tipo_id:
        query += " AND p.tipo_producto_id = ?"
        params.append(tipo_id)

    if busqueda:
        query += " AND (p.nombre LIKE ? OR p.codigo_barras LIKE ?)"
        params.extend([f'%{busqueda}%', f'%{busqueda}%'])

    query += " ORDER BY p.fecha_creacion DESC"
    cursor.execute(query, params)
    productos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(productos)


@app.route('/api/productos/<producto_id>', methods=['GET'])
def get_producto(producto_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, t.nombre as tipo_nombre, t.icono as tipo_icono, t.color as tipo_color
        FROM productos p
        JOIN tipos_producto t ON p.tipo_producto_id = t.id
        WHERE p.id = ?
    """, (producto_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'No encontrado'}), 404

    return jsonify(dict(row))


@app.route('/api/productos', methods=['POST'])
def create_producto():
    nombre = request.form.get('nombre', '').strip()
    descripcion = request.form.get('descripcion', '')
    codigo_barras = request.form.get('codigo_barras', '')
    cantidad = int(request.form.get('cantidad', 1))
    precio = request.form.get('precio_unitario')
    precio_unitario = float(precio) if precio else None
    tipo_producto_id = (request.form.get('tipo_producto_id') or '').strip() or None
    nuevo_tipo_nombre = (request.form.get('nuevo_tipo_nombre') or '').strip()
    lat = request.form.get('latitud')
    lng = request.form.get('longitud')
    latitud = float(lat) if lat else None
    longitud = float(lng) if lng else None

    if not nombre:
        return jsonify({'error': 'El nombre del producto es obligatorio'}), 400

    # Crear tipo si es nuevo
    if nuevo_tipo_nombre and not tipo_producto_id:
        conn = get_db()
        cursor = conn.cursor()
        tipo_id = f"tipo-{uuid.uuid4().hex[:8]}"
        cursor.execute("INSERT INTO tipos_producto (id, nombre, descripcion, icono, color) VALUES (?, ?, ?, ?, ?)",
                       (tipo_id, nuevo_tipo_nombre, 'Creado desde app', '📦', '#3b82f6'))
        conn.commit()
        tipo_producto_id = tipo_id
        conn.close()

    if not tipo_producto_id:
        return jsonify({'error': 'Debe seleccionar un tipo'}), 400

    foto_url = None
    foto_thumbnail = None

    # Procesar foto
    if 'foto' in request.files:
        file = request.files['foto']
        if file and file.filename:
            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
            filename = f"{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            foto_url = f"/uploads/fotos/{filename}"
            with open(filepath, 'rb') as f:
                foto_thumbnail = generar_thumbnail(f.read())
    elif request.form.get('foto_base64'):
        foto_b64 = request.form.get('foto_base64')
        if ',' in foto_b64:
            foto_b64 = foto_b64.split(',')[1]
        img_data = base64.b64decode(foto_b64)
        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        with open(filepath, 'wb') as f:
            f.write(img_data)
        foto_url = f"/uploads/fotos/{filename}"
        foto_thumbnail = generar_thumbnail(img_data)

    producto_id = f"prod-{uuid.uuid4().hex[:8]}"
    ahora = datetime.now().isoformat()
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO productos (id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
        tipo_producto_id, foto_url, foto_thumbnail, texto_ocr, latitud, longitud,
        fecha_creacion, fecha_actualizacion, sincronizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (producto_id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
          tipo_producto_id, foto_url, foto_thumbnail, '', latitud, longitud, ahora, ahora, 1))
    conn.commit()

    cursor.execute("""
        SELECT p.*, t.nombre as tipo_nombre, t.icono as tipo_icono, t.color as tipo_color
        FROM productos p
        JOIN tipos_producto t ON p.tipo_producto_id = t.id
        WHERE p.id = ?
    """, (producto_id,))
    producto = dict(cursor.fetchone())
    conn.close()

    return jsonify(producto), 201


@app.route('/api/productos/<producto_id>', methods=['DELETE'])
def delete_producto(producto_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT foto_url FROM productos WHERE id = ?", (producto_id,))
    row = cursor.fetchone()

    if row and row['foto_url']:
        foto_path = row['foto_url'].replace('/uploads/fotos/', '')
        full_path = os.path.join(app.config['UPLOAD_FOLDER'], foto_path)
        if os.path.exists(full_path):
            os.remove(full_path)

    cursor.execute("DELETE FROM productos WHERE id = ?", (producto_id,))
    conn.commit()
    conn.close()

    return jsonify({'message': 'Eliminado'}), 200


# ============================================================================
# API - CLASIFICACIÓN IA (Gemini Vision)
# ============================================================================

gemini_client = None
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
if GEMINI_API_KEY:
    try:
        from google import genai
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Gemini no disponible: {e}")


@app.route('/api/clasificar', methods=['POST'])
def clasificar_producto():
    if not gemini_client:
        return jsonify({'error': 'Clasificación no configurada'}), 503

    data = request.get_json(silent=True) or {}
    foto_b64 = data.get('foto_base64', '')
    if not foto_b64:
        return jsonify({'error': 'Foto requerida'}), 400

    if ',' in foto_b64:
        foto_b64 = foto_b64.split(',')[1]

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nombre FROM tipos_producto ORDER BY nombre")
    tipos = [dict(row) for row in cursor.fetchall()]
    conn.close()

    nombres_tipos = [t['nombre'] for t in tipos]
    mapa_tipos = {t['nombre'].lower(): t['id'] for t in tipos}

    prompt = (
        f"Analiza esta imagen de un producto. "
        f"Clasifícalo en UNA de estas categorías: {', '.join(nombres_tipos)}. "
        f"También sugiere un nombre corto para el producto. "
        f"Responde SOLO con JSON válido, sin markdown, con este formato exacto: "
        f'{{"categoria": "nombre_categoria", "nombre_sugerido": "nombre_producto"}}'
    )

    try:
        from google.genai import types

        img_bytes = base64.b64decode(foto_b64)

        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                prompt,
            ],
        )

        texto = response.text.strip()
        if texto.startswith('```'):
            texto = texto.split('\n', 1)[1].rsplit('```', 1)[0].strip()

        resultado = json.loads(texto)
        categoria = resultado.get('categoria', '')
        tipo_id = mapa_tipos.get(categoria.lower())

        return jsonify({
            'tipo_id': tipo_id,
            'tipo_nombre': categoria,
            'nombre_sugerido': resultado.get('nombre_sugerido', ''),
        })

    except Exception as e:
        print(f"Error clasificando: {e}")
        return jsonify({'error': 'No se pudo clasificar'}), 500


# ============================================================================
# API - ESTADÍSTICAS
# ============================================================================

@app.route('/api/estadisticas', methods=['GET'])
def get_estadisticas():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) as count FROM productos")
    total_productos = cursor.fetchone()['count']

    cursor.execute("SELECT COALESCE(SUM(cantidad * COALESCE(precio_unitario, 0)), 0) as valor FROM productos")
    valor_total = cursor.fetchone()['valor']

    cursor.execute("""
        SELECT t.nombre, t.icono, t.color, COUNT(p.id) as cantidad
        FROM tipos_producto t
        LEFT JOIN productos p ON t.id = p.tipo_producto_id
        GROUP BY t.id
        ORDER BY cantidad DESC
    """)
    por_tipo = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT COUNT(*) as count FROM productos WHERE fecha_creacion >= datetime('now', '-7 days')")
    recientes = cursor.fetchone()['count']

    conn.close()

    return jsonify({
        'total_productos': total_productos,
        'valor_total': round(valor_total, 2),
        'productos_recientes': recientes,
        'por_tipo': por_tipo
    })


# ============================================================================
# API - SINCRONIZACIÓN
# ============================================================================

@app.route('/api/sync', methods=['POST'])
def sync_offline():
    data = request.get_json(silent=True) or {}
    productos_pendientes = data.get('productos', [])
    sincronizados = []

    for item in productos_pendientes:
        try:
            nombre = (item.get('nombre') or '').strip()
            if not nombre:
                continue

            producto_id = f"prod-{uuid.uuid4().hex[:8]}"
            foto_url = None
            foto_thumbnail = None

            if item.get('foto_base64'):
                foto_b64 = item['foto_base64']
                if ',' in foto_b64:
                    foto_b64 = foto_b64.split(',')[1]
                img_data = base64.b64decode(foto_b64)
                filename = f"{uuid.uuid4().hex}.jpg"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                with open(filepath, 'wb') as f:
                    f.write(img_data)
                foto_url = f"/uploads/fotos/{filename}"
                foto_thumbnail = generar_thumbnail(img_data)

            tipo_id = item.get('tipo_producto_id')
            if tipo_id:
                tipo_id = str(tipo_id).strip() or None
            else:
                tipo_id = None

            nuevo = (item.get('nuevo_tipo_nombre') or '').strip()
            if nuevo and not tipo_id:
                tipo_id = f"tipo-{uuid.uuid4().hex[:8]}"
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("INSERT INTO tipos_producto (id, nombre, descripcion, icono, color) VALUES (?, ?, ?, ?, ?)",
                               (tipo_id, nuevo, 'Creado offline', '📦', '#3b82f6'))
                conn.commit()
                conn.close()

            if not tipo_id:
                continue

            ahora = datetime.now().isoformat()
            sync_lat = float(item['latitud']) if item.get('latitud') else None
            sync_lng = float(item['longitud']) if item.get('longitud') else None
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO productos (id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
                tipo_producto_id, foto_url, foto_thumbnail, texto_ocr, latitud, longitud,
                fecha_creacion, fecha_actualizacion, sincronizado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (producto_id, nombre, item.get('descripcion', ''), item.get('codigo_barras', ''),
                  item.get('cantidad', 1), item.get('precio_unitario'), tipo_id, foto_url, foto_thumbnail,
                  item.get('texto_ocr', ''), sync_lat, sync_lng, item.get('fecha_creacion', ahora), ahora, 1))
            conn.commit()
            conn.close()

            sincronizados.append({'temp_id': item.get('temp_id'), 'server_id': producto_id})
        except Exception as e:
            print(f"Error sync: {e}")

    return jsonify({'sincronizados': len(sincronizados), 'detalles': sincronizados})


# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================

init_db()

if __name__ == '__main__':
    print("=" * 70)
    print("INVENTARIO FOTO - Sistema de Inventario por Fotografía")
    print("=" * 70)
    print("🌐 Abre http://127.0.0.1:5000 en tu navegador")
    print("=" * 70)

    port = int(os.environ.get("PORT", "5000"))
    app.run(debug=True, host="0.0.0.0", port=port)
