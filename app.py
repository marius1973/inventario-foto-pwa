"""
InventarioFoto - Sistema de Inventario por Fotografia
======================================================
App fullstack: Flask backend + PWA frontend
Autor: Mario Manrique
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

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads/fotos'
DATABASE = 'inventario.db'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

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
            fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
            fecha_actualizacion TEXT DEFAULT CURRENT_TIMESTAMP,
            sincronizado INTEGER DEFAULT 1,
            FOREIGN KEY (tipo_producto_id) REFERENCES tipos_producto(id)
        )
    """)

    cursor.execute("SELECT COUNT(*) FROM tipos_producto")
    if cursor.fetchone()[0] == 0:
        tipos_default = [
            ('tipo-1', 'Electronica', 'Dispositivos electronicos', '🔌', '#3b82f6'),
            ('tipo-2', 'Herramientas', 'Herramientas manuales', '🔧', '#f59e0b'),
            ('tipo-3', 'Alimentos', 'Productos comestibles', '🍎', '#22c55e'),
            ('tipo-4', 'Ropa', 'Vestimenta', '👕', '#8b5cf6'),
            ('tipo-5', 'Hogar', 'Articulos de hogar', '🏠', '#ec4899'),
            ('tipo-6', 'Papeleria', 'Utiles de oficina', '✏️', '#06b6d4'),
            ('tipo-7', 'Sin clasificar', 'Pendiente de clasificar', '❓', '#64748b'),
        ]
        cursor.executemany(
            "INSERT INTO tipos_producto (id, nombre, descripcion, icono, color) VALUES (?, ?, ?, ?, ?)",
            tipos_default
        )

    conn.commit()
    conn.close()
    print("Base de datos inicializada")


def generar_thumbnail(image_data, max_size=(300, 300)):
    try:
        img = Image.open(io.BytesIO(image_data))
        img.thumbnail(max_size, Image.LANCZOS)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=70)
        img_str = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/jpeg;base64,{img_str}"
    except Exception as e:
        print(f"Error thumbnail: {e}")
        return None


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
        """, (tipo_id, nombre, data.get('descripcion', ''), data.get('icono', '📦'), data.get('color', '#3b82f6')))
        conn.commit()
        cursor.execute("SELECT * FROM tipos_producto WHERE id = ?", (tipo_id,))
        tipo = dict(cursor.fetchone())
        conn.close()
        return jsonify(tipo), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Ya existe ese tipo'}), 409


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
    if not row:
        conn.close()
        return jsonify({'error': 'No encontrado'}), 404
    producto = dict(row)
    conn.close()
    return jsonify(producto)


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
    texto_ocr = request.form.get('texto_ocr', '')

    if not nombre:
        return jsonify({'error': 'El nombre del producto es obligatorio'}), 400

    if nuevo_tipo_nombre and not tipo_producto_id:
        conn = get_db()
        cursor = conn.cursor()
        tipo_id = f"tipo-{uuid.uuid4().hex[:8]}"
        cursor.execute("INSERT INTO tipos_producto (id, nombre, descripcion, icono, color) VALUES (?, ?, ?, ?, ?)",
                       (tipo_id, nuevo_tipo_nombre.strip(), 'Creado desde app', '📦', '#3b82f6'))
        conn.commit()
        tipo_producto_id = tipo_id
        conn.close()

    if not tipo_producto_id:
        return jsonify({'error': 'Debe seleccionar un tipo o indicar uno nuevo'}), 400

    foto_url = None
    foto_thumbnail = None

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
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO productos (id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
        tipo_producto_id, foto_url, foto_thumbnail, texto_ocr, fecha_creacion, fecha_actualizacion, sincronizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (producto_id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
          tipo_producto_id, foto_url, foto_thumbnail, texto_ocr,
          datetime.now().isoformat(), datetime.now().isoformat(), 1))
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


@app.route('/api/estadisticas', methods=['GET'])
def get_estadisticas():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM productos")
    total_productos = cursor.fetchone()[0]
    cursor.execute("""
        SELECT COALESCE(SUM(cantidad * COALESCE(precio_unitario, 0)), 0) FROM productos
    """)
    valor_total = cursor.fetchone()[0]
    cursor.execute("""
        SELECT t.nombre, t.icono, t.color, COUNT(p.id) as cantidad
        FROM tipos_producto t
        LEFT JOIN productos p ON t.id = p.tipo_producto_id
        GROUP BY t.id
        ORDER BY cantidad DESC
    """)
    por_tipo = [dict(row) for row in cursor.fetchall()]
    cursor.execute("SELECT COUNT(*) FROM productos WHERE fecha_creacion >= datetime('now', '-7 days')")
    recientes = cursor.fetchone()[0]
    conn.close()
    return jsonify({'total_productos': total_productos, 'valor_total': round(valor_total, 2),
                    'productos_recientes': recientes, 'por_tipo': por_tipo})


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
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO productos (id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
                tipo_producto_id, foto_url, foto_thumbnail, texto_ocr, fecha_creacion, fecha_actualizacion, sincronizado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (producto_id, nombre, item.get('descripcion', ''), item.get('codigo_barras', ''),
                  item.get('cantidad', 1), item.get('precio_unitario'), tipo_id, foto_url, foto_thumbnail,
                  item.get('texto_ocr', ''), item.get('fecha_creacion', datetime.now().isoformat()),
                  datetime.now().isoformat(), 1))
            conn.commit()
            conn.close()
            sincronizados.append({'temp_id': item.get('temp_id'), 'server_id': producto_id})
        except Exception as e:
            print(f"Error sync: {e}")
    return jsonify({'sincronizados': len(sincronizados), 'detalles': sincronizados})


init_db()

if __name__ == '__main__':
    port = int(os.environ.get("PORT", "5000"))
    production = os.environ.get("FLASK_ENV") == "production"
    print("=" * 60)
    print("INVENTARIO FOTO - Sistema de Inventario por Fotografia")
    print("=" * 60)
    print(f"Abre http://127.0.0.1:{port} en tu navegador")
    print("=" * 60)
    app.run(debug=not production, host="0.0.0.0", port=port)
