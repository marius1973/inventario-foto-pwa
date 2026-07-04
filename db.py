"""
Capa de base de datos para InventarioFoto.
- Producción (Render): Postgres, si existe la variable DATABASE_URL.
- Local: SQLite (inventario.db), sin configuración extra.

El resto del código escribe SQL con placeholders '?' (estilo SQLite);
esta capa los convierte a '%s' cuando corre sobre Postgres.
"""
import os
import sqlite3
from datetime import datetime

DATABASE_URL = os.environ.get('DATABASE_URL', '')
USE_POSTGRES = DATABASE_URL.startswith(('postgres://', 'postgresql://'))
SQLITE_PATH = os.environ.get('SQLITE_PATH', 'inventario.db')

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras
    IntegrityError = psycopg2.IntegrityError
    BLOB_TYPE = 'BYTEA'
else:
    IntegrityError = sqlite3.IntegrityError
    BLOB_TYPE = 'BLOB'


def to_blob(data):
    """Adapta bytes para insertarlos en una columna BLOB/BYTEA."""
    if USE_POSTGRES:
        return psycopg2.Binary(data)
    return data


class _PgCursor:
    """Cursor de Postgres que acepta placeholders '?' estilo SQLite."""

    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql, params=()):
        self._cursor.execute(sql.replace('?', '%s'), params)
        return self

    def executemany(self, sql, seq_params):
        self._cursor.executemany(sql.replace('?', '%s'), seq_params)

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def close(self):
        self._cursor.close()


class _PgConnection:
    """Conexión de Postgres con la misma interfaz que sqlite3.Connection."""

    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return _PgCursor(
            self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        )

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def get_db():
    """Obtiene una conexión a la base de datos (Postgres o SQLite)."""
    if USE_POSTGRES:
        return _PgConnection(psycopg2.connect(DATABASE_URL))
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Crea tablas y datos por defecto si no existen."""
    conn = get_db()
    cursor = conn.cursor()
    ahora = datetime.now().isoformat()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tipos_producto (
            id TEXT PRIMARY KEY,
            nombre TEXT NOT NULL UNIQUE,
            descripcion TEXT,
            icono TEXT DEFAULT '📦',
            color TEXT DEFAULT '#3b82f6',
            fecha_creacion TEXT
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
            latitud REAL,
            longitud REAL,
            fecha_creacion TEXT,
            fecha_actualizacion TEXT,
            sincronizado INTEGER DEFAULT 1,
            FOREIGN KEY (tipo_producto_id) REFERENCES tipos_producto(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS configuracion (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            moneda_simbolo TEXT DEFAULT 'S/',
            fecha_actualizacion TEXT
        )
    """)

    # Fotos almacenadas en la BD (persisten en Render, donde el disco es efímero)
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS fotos (
            id TEXT PRIMARY KEY,
            mime TEXT DEFAULT 'image/jpeg',
            data {BLOB_TYPE},
            fecha_creacion TEXT
        )
    """)

    # Migración solo para bases SQLite antiguas
    if not USE_POSTGRES:
        cursor.execute("PRAGMA table_info(productos)")
        columnas = [col[1] for col in cursor.fetchall()]
        if 'latitud' not in columnas:
            cursor.execute("ALTER TABLE productos ADD COLUMN latitud REAL")
        if 'longitud' not in columnas:
            cursor.execute("ALTER TABLE productos ADD COLUMN longitud REAL")

    # Tipos por defecto
    cursor.execute("SELECT COUNT(*) as count FROM tipos_producto")
    if cursor.fetchone()['count'] == 0:
        tipos_default = [
            ('tipo-1', 'Electrónica', 'Dispositivos electrónicos', '🔌', '#3b82f6', ahora),
            ('tipo-2', 'Herramientas', 'Herramientas manuales', '🔧', '#f59e0b', ahora),
            ('tipo-3', 'Alimentos', 'Productos comestibles', '🍎', '#22c55e', ahora),
            ('tipo-4', 'Ropa', 'Vestimenta', '👕', '#8b5cf6', ahora),
            ('tipo-5', 'Hogar', 'Artículos de hogar', '🏠', '#ec4899', ahora),
            ('tipo-6', 'Papelería', 'Útiles de oficina', '✏️', '#06b6d4', ahora),
            ('tipo-7', 'Sin clasificar', 'Pendiente de clasificar', '❓', '#64748b', ahora),
        ]
        cursor.executemany(
            "INSERT INTO tipos_producto (id, nombre, descripcion, icono, color, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)",
            tipos_default
        )

    # Configuración por defecto
    cursor.execute("SELECT COUNT(*) as count FROM configuracion")
    if cursor.fetchone()['count'] == 0:
        cursor.execute(
            "INSERT INTO configuracion (id, moneda_simbolo, fecha_actualizacion) VALUES (1, 'S/', ?)",
            (ahora,)
        )

    conn.commit()
    conn.close()
    backend = 'Postgres' if USE_POSTGRES else 'SQLite'
    print(f"✅ Base de datos inicializada ({backend})")
