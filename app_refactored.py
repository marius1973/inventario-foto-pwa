"""
InventarioFoto - Sistema de gestión de inventario con captura por fotografía.

Una aplicación PWA full-stack que permite registrar productos mediante fotos,
categorizarlos y sincronizar datos en modo offline.

Autor: Mario Manrique
"""

import logging
import sqlite3
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass
from enum import Enum

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import uuid
import base64
from PIL import Image
import io
import os


# ============================================================================
# CONFIGURACIÓN
# ============================================================================

class Config:
    """Configuración centralizada de la aplicación."""

    # Base de datos
    DATABASE_PATH = Path('inventario.db')

    # Almacenamiento de archivos
    UPLOAD_FOLDER = Path('uploads/fotos')
    MAX_UPLOAD_SIZE = 25 * 1024 * 1024  # 25MB

    # Imágenes
    THUMBNAIL_SIZE = (300, 300)
    THUMBNAIL_QUALITY = 70
    PHOTO_QUALITY = 85

    # Aplicación
    DEBUG = os.environ.get('FLASK_ENV') != 'production'
    PORT = int(os.environ.get('PORT', '5000'))


config = Config()
config.UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# EXCEPCIONES Y ENUMS
# ============================================================================

class InventarioException(Exception):
    """Excepción base para la aplicación."""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class ProductoNotFound(InventarioException):
    """El producto no existe."""
    def __init__(self):
        super().__init__('Producto no encontrado', 404)


class TipoProductoNotFound(InventarioException):
    """El tipo de producto no existe."""
    def __init__(self):
        super().__init__('Tipo de producto no encontrado', 404)


class TipoProductoDuplicate(InventarioException):
    """El tipo de producto ya existe."""
    def __init__(self):
        super().__init__('Ya existe un tipo con ese nombre', 409)


# ============================================================================
# MODELOS DE DATOS
# ============================================================================

@dataclass
class TipoProducto:
    """Modelo para tipo de producto."""
    id: str
    nombre: str
    descripcion: str = ''
    icono: str = '📦'
    color: str = '#3b82f6'
    fecha_creacion: str = None

    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'nombre': self.nombre,
            'descripcion': self.descripcion,
            'icono': self.icono,
            'color': self.color,
            'fecha_creacion': self.fecha_creacion or datetime.now().isoformat()
        }


@dataclass
class Producto:
    """Modelo para producto."""
    id: str
    nombre: str
    tipo_producto_id: str
    descripcion: str = ''
    codigo_barras: str = ''
    cantidad: int = 1
    precio_unitario: Optional[float] = None
    foto_url: Optional[str] = None
    foto_thumbnail: Optional[str] = None
    texto_ocr: str = ''
    fecha_creacion: str = None
    fecha_actualizacion: str = None

    def to_dict(self, tipo_info: Optional[Dict] = None) -> Dict:
        data = {
            'id': self.id,
            'nombre': self.nombre,
            'descripcion': self.descripcion,
            'codigo_barras': self.codigo_barras,
            'cantidad': self.cantidad,
            'precio_unitario': self.precio_unitario,
            'tipo_producto_id': self.tipo_producto_id,
            'foto_url': self.foto_url,
            'foto_thumbnail': self.foto_thumbnail,
            'texto_ocr': self.texto_ocr,
            'fecha_creacion': self.fecha_creacion,
            'fecha_actualizacion': self.fecha_actualizacion or datetime.now().isoformat(),
        }
        if tipo_info:
            data.update({
                'tipo_nombre': tipo_info.get('nombre'),
                'tipo_icono': tipo_info.get('icono'),
                'tipo_color': tipo_info.get('color'),
            })
        return data


# ============================================================================
# SERVICIOS
# ============================================================================

class ImagenService:
    """Servicio para procesamiento de imágenes."""

    @staticmethod
    def generar_thumbnail(image_data: bytes, max_size: Tuple[int, int] = None) -> Optional[str]:
        """
        Genera un thumbnail en base64 a partir de datos de imagen.

        Args:
            image_data: Bytes de la imagen original
            max_size: Tamaño máximo (ancho, alto)

        Returns:
            Data URL con la imagen en base64, o None si falla
        """
        if max_size is None:
            max_size = config.THUMBNAIL_SIZE

        try:
            img = Image.open(io.BytesIO(image_data))
            img.thumbnail(max_size, Image.LANCZOS)

            # Convertir a RGB si es necesario
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')

            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=config.THUMBNAIL_QUALITY)
            img_b64 = base64.b64encode(buffer.getvalue()).decode()

            return f"data:image/jpeg;base64,{img_b64}"
        except Exception as error:
            logger.error(f"Error generando thumbnail: {error}")
            return None

    @staticmethod
    def guardar_imagen(image_data: bytes, nombre_base: str = None) -> Tuple[str, str]:
        """
        Guarda una imagen y genera su thumbnail.

        Args:
            image_data: Bytes de la imagen
            nombre_base: Nombre base del archivo (sin extensión)

        Returns:
            Tupla con (url_imagen, url_thumbnail)
        """
        nombre_archivo = f"{nombre_base or uuid.uuid4().hex}.jpg"
        ruta_archivo = config.UPLOAD_FOLDER / nombre_archivo

        try:
            ruta_archivo.write_bytes(image_data)
            url_imagen = f"/uploads/fotos/{nombre_archivo}"
            thumbnail = ImagenService.generar_thumbnail(image_data)

            return url_imagen, thumbnail
        except Exception as error:
            logger.error(f"Error guardando imagen: {error}")
            raise InventarioException("No se pudo guardar la imagen", 500)


class ProductoService:
    """Servicio de lógica de productos."""

    def __init__(self, db_path: Path):
        self.db_path = db_path

    def _get_connection(self) -> sqlite3.Connection:
        """Obtiene una conexión a la base de datos."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def crear_producto(self, nombre: str, tipo_id: str, foto_base64: Optional[str] = None,
                      descripcion: str = '', codigo: str = '', cantidad: int = 1,
                      precio: Optional[float] = None) -> Producto:
        """
        Crea un nuevo producto.

        Args:
            nombre: Nombre del producto
            tipo_id: ID del tipo de producto
            foto_base64: Foto en base64 (opcional)
            descripcion: Descripción
            codigo: Código de barras
            cantidad: Cantidad
            precio: Precio unitario

        Returns:
            Producto creado

        Raises:
            InventarioException: Si hay error en la validación o guardado
        """
        nombre = (nombre or '').strip()
        if not nombre:
            raise InventarioException("El nombre del producto es obligatorio")

        tipo_id = (tipo_id or '').strip()
        if not tipo_id:
            raise InventarioException("Debe especificar un tipo de producto")

        producto_id = f"prod-{uuid.uuid4().hex[:8]}"
        foto_url = None
        foto_thumbnail = None

        # Procesar foto si existe
        if foto_base64:
            foto_b64 = foto_base64
            if ',' in foto_b64:
                foto_b64 = foto_b64.split(',')[1]

            try:
                image_data = base64.b64decode(foto_b64)
                foto_url, foto_thumbnail = ImagenService.guardar_imagen(image_data)
            except Exception as error:
                logger.error(f"Error procesando foto: {error}")
                raise InventarioException("Error procesando la fotografía", 400)

        # Guardar en BD
        ahora = datetime.now().isoformat()
        conn = self._get_connection()

        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO productos
                (id, nombre, descripcion, codigo_barras, cantidad, precio_unitario,
                 tipo_producto_id, foto_url, foto_thumbnail, texto_ocr,
                 fecha_creacion, fecha_actualizacion, sincronizado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (producto_id, nombre, descripcion, codigo, cantidad, precio,
                  tipo_id, foto_url, foto_thumbnail, '',
                  ahora, ahora, 1))
            conn.commit()

            producto = Producto(
                id=producto_id, nombre=nombre, tipo_producto_id=tipo_id,
                descripcion=descripcion, codigo_barras=codigo,
                cantidad=cantidad, precio_unitario=precio,
                foto_url=foto_url, foto_thumbnail=foto_thumbnail,
                fecha_creacion=ahora, fecha_actualizacion=ahora
            )

            logger.info(f"Producto creado: {producto_id}")
            return producto
        except sqlite3.IntegrityError as error:
            logger.error(f"Error de integridad: {error}")
            raise InventarioException("Error al guardar el producto", 400)
        finally:
            conn.close()

    def obtener_producto(self, producto_id: str) -> Optional[Dict]:
        """Obtiene un producto por ID."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT p.*, t.nombre as tipo_nombre, t.icono as tipo_icono, t.color as tipo_color
                FROM productos p
                JOIN tipos_producto t ON p.tipo_producto_id = t.id
                WHERE p.id = ?
            """, (producto_id,))

            row = cursor.fetchone()
            if not row:
                raise ProductoNotFound()

            return dict(row)
        finally:
            conn.close()

    def listar_productos(self, tipo_id: Optional[str] = None, busqueda: Optional[str] = None) -> List[Dict]:
        """Obtiene una lista de productos con filtros opcionales."""
        conn = self._get_connection()
        try:
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
                busqueda_pattern = f'%{busqueda}%'
                params.extend([busqueda_pattern, busqueda_pattern])

            query += " ORDER BY p.fecha_creacion DESC"
            cursor.execute(query, params)

            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def eliminar_producto(self, producto_id: str) -> bool:
        """Elimina un producto y su foto asociada."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            # Obtener ruta de foto
            cursor.execute("SELECT foto_url FROM productos WHERE id = ?", (producto_id,))
            row = cursor.fetchone()

            if row and row['foto_url']:
                nombre_archivo = row['foto_url'].replace('/uploads/fotos/', '')
                ruta_foto = config.UPLOAD_FOLDER / nombre_archivo

                if ruta_foto.exists():
                    ruta_foto.unlink()
                    logger.info(f"Foto eliminada: {nombre_archivo}")

            cursor.execute("DELETE FROM productos WHERE id = ?", (producto_id,))
            conn.commit()

            logger.info(f"Producto eliminado: {producto_id}")
            return True
        except Exception as error:
            logger.error(f"Error eliminando producto: {error}")
            return False
        finally:
            conn.close()


class TipoProductoService:
    """Servicio para gestión de tipos de productos."""

    def __init__(self, db_path: Path):
        self.db_path = db_path

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def crear_tipo(self, nombre: str, descripcion: str = '', icono: str = '📦',
                   color: str = '#3b82f6') -> TipoProducto:
        """Crea un nuevo tipo de producto."""
        nombre = (nombre or '').strip()
        if not nombre:
            raise InventarioException("El nombre del tipo es obligatorio")

        tipo_id = f"tipo-{uuid.uuid4().hex[:8]}"
        conn = self._get_connection()

        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO tipos_producto (id, nombre, descripcion, icono, color)
                VALUES (?, ?, ?, ?, ?)
            """, (tipo_id, nombre, descripcion, icono, color))
            conn.commit()

            logger.info(f"Tipo creado: {tipo_id}")
            return TipoProducto(tipo_id, nombre, descripcion, icono, color)
        except sqlite3.IntegrityError:
            raise TipoProductoDuplicate()
        finally:
            conn.close()

    def listar_tipos(self) -> List[Dict]:
        """Obtiene todos los tipos de productos."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tipos_producto ORDER BY nombre")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()


# ============================================================================
# DECORADORES Y HELPERS
# ============================================================================

def handle_exceptions(f):
    """Decorador para manejo centralizado de excepciones."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except InventarioException as error:
            logger.warning(f"Error controlado: {error.message}")
            return jsonify({'error': error.message}), error.status_code
        except Exception as error:
            logger.error(f"Error no esperado: {error}", exc_info=True)
            return jsonify({'error': 'Error interno del servidor'}), 500
    return decorated_function


# ============================================================================
# INICIALIZACIÓN
# ============================================================================

def inicializar_base_datos():
    """Inicializa la estructura de la base de datos."""
    conn = sqlite3.connect(str(config.DATABASE_PATH))
    cursor = conn.cursor()

    # Tabla de tipos
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

    # Tabla de productos
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

    # Insertar tipos por defecto si no existen
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

    conn.commit()
    conn.close()
    logger.info("Base de datos inicializada")


def crear_aplicacion() -> Flask:
    """Factory function para crear la aplicación Flask."""
    app = Flask(__name__)
    CORS(app)
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_UPLOAD_SIZE

    # Inicializar servicios
    producto_service = ProductoService(config.DATABASE_PATH)
    tipo_service = TipoProductoService(config.DATABASE_PATH)

    # ====================================================================
    # RUTAS - Frontend
    # ====================================================================

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
        return send_from_directory(config.UPLOAD_FOLDER, filename)

    # ====================================================================
    # RUTAS - API Tipos
    # ====================================================================

    @app.route('/api/tipos-producto', methods=['GET'])
    @handle_exceptions
    def api_get_tipos():
        """Obtiene todos los tipos de productos."""
        tipos = tipo_service.listar_tipos()
        return jsonify(tipos)

    @app.route('/api/tipos-producto', methods=['POST'])
    @handle_exceptions
    def api_create_tipo():
        """Crea un nuevo tipo de producto."""
        data = request.get_json(silent=True) or {}

        tipo = tipo_service.crear_tipo(
            nombre=data.get('nombre', ''),
            descripcion=data.get('descripcion', ''),
            icono=data.get('icono', '📦'),
            color=data.get('color', '#3b82f6')
        )

        return jsonify(tipo.to_dict()), 201

    # ====================================================================
    # RUTAS - API Productos
    # ====================================================================

    @app.route('/api/productos', methods=['GET'])
    @handle_exceptions
    def api_get_productos():
        """Obtiene productos con filtros opcionales."""
        tipo_id = request.args.get('tipo_id')
        busqueda = request.args.get('q')

        productos = producto_service.listar_productos(tipo_id=tipo_id, busqueda=busqueda)
        return jsonify(productos)

    @app.route('/api/productos/<producto_id>', methods=['GET'])
    @handle_exceptions
    def api_get_producto(producto_id):
        """Obtiene un producto específico."""
        producto = producto_service.obtener_producto(producto_id)
        return jsonify(producto)

    @app.route('/api/productos', methods=['POST'])
    @handle_exceptions
    def api_create_producto():
        """Crea un nuevo producto."""
        nombre = request.form.get('nombre', '').strip()
        descripcion = request.form.get('descripcion', '')
        codigo = request.form.get('codigo_barras', '')
        cantidad = int(request.form.get('cantidad', 1))
        precio_str = request.form.get('precio_unitario', '')
        precio = float(precio_str) if precio_str else None
        tipo_id = request.form.get('tipo_producto_id', '').strip()
        nuevo_tipo_nombre = request.form.get('nuevo_tipo_nombre', '').strip()
        foto_base64 = request.form.get('foto_base64')

        # Crear tipo si es nuevo
        if nuevo_tipo_nombre and not tipo_id:
            tipo_obj = tipo_service.crear_tipo(nuevo_tipo_nombre, 'Creado desde app')
            tipo_id = tipo_obj.id

        # Crear producto
        producto = producto_service.crear_producto(
            nombre=nombre,
            tipo_id=tipo_id,
            foto_base64=foto_base64,
            descripcion=descripcion,
            codigo=codigo,
            cantidad=cantidad,
            precio=precio
        )

        # Obtener info completa con tipo
        producto_dict = producto_service.obtener_producto(producto.id)
        return jsonify(producto_dict), 201

    @app.route('/api/productos/<producto_id>', methods=['DELETE'])
    @handle_exceptions
    def api_delete_producto(producto_id):
        """Elimina un producto."""
        producto_service.eliminar_producto(producto_id)
        return jsonify({'message': 'Producto eliminado'}), 200

    # ====================================================================
    # RUTAS - Estadísticas
    # ====================================================================

    @app.route('/api/estadisticas', methods=['GET'])
    @handle_exceptions
    def api_estadisticas():
        """Obtiene estadísticas de inventario."""
        conn = sqlite3.connect(str(config.DATABASE_PATH))
        conn.row_factory = sqlite3.Row

        try:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) as count FROM productos")
            total = cursor.fetchone()['count']

            cursor.execute("""
                SELECT COALESCE(SUM(cantidad * COALESCE(precio_unitario, 0)), 0) as valor
                FROM productos
            """)
            valor_total = cursor.fetchone()['valor']

            cursor.execute("""
                SELECT t.nombre, t.icono, t.color, COUNT(p.id) as cantidad
                FROM tipos_producto t
                LEFT JOIN productos p ON t.id = p.tipo_producto_id
                GROUP BY t.id
                ORDER BY cantidad DESC
            """)
            por_tipo = [dict(row) for row in cursor.fetchall()]

            cursor.execute("""
                SELECT COUNT(*) as count FROM productos
                WHERE fecha_creacion >= datetime('now', '-7 days')
            """)
            recientes = cursor.fetchone()['count']

            return jsonify({
                'total_productos': total,
                'valor_total': round(valor_total, 2),
                'productos_recientes': recientes,
                'por_tipo': por_tipo
            })
        finally:
            conn.close()

    # ====================================================================
    # RUTAS - Sincronización
    # ====================================================================

    @app.route('/api/sync', methods=['POST'])
    @handle_exceptions
    def api_sync():
        """Sincroniza productos pendientes desde modo offline."""
        data = request.get_json(silent=True) or {}
        productos_pendientes = data.get('productos', [])
        sincronizados = []

        for item in productos_pendientes:
            try:
                nombre = (item.get('nombre') or '').strip()
                if not nombre:
                    continue

                tipo_id = (item.get('tipo_producto_id') or '').strip() or None
                nuevo_tipo = (item.get('nuevo_tipo_nombre') or '').strip()

                # Crear tipo si es necesario
                if nuevo_tipo and not tipo_id:
                    tipo_obj = tipo_service.crear_tipo(nuevo_tipo, 'Creado offline')
                    tipo_id = tipo_obj.id

                if not tipo_id:
                    continue

                # Crear producto
                producto = producto_service.crear_producto(
                    nombre=nombre,
                    tipo_id=tipo_id,
                    foto_base64=item.get('foto_base64'),
                    descripcion=item.get('descripcion', ''),
                    codigo=item.get('codigo_barras', ''),
                    cantidad=item.get('cantidad', 1),
                    precio=item.get('precio_unitario')
                )

                sincronizados.append({
                    'temp_id': item.get('temp_id'),
                    'server_id': producto.id
                })
            except Exception as error:
                logger.error(f"Error sincronizando producto: {error}")

        return jsonify({
            'sincronizados': len(sincronizados),
            'detalles': sincronizados
        })

    return app


# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================

# Crear la aplicación a nivel de módulo para gunicorn
inicializar_base_datos()
app = crear_aplicacion()

# Solo para ejecución local (python app.py)
if __name__ == '__main__':
    print("=" * 70)
    print("INVENTARIO FOTO - Sistema de Inventario por Fotografía")
    print("=" * 70)
    print(f"Abre http://127.0.0.1:{config.PORT} en tu navegador")
    print("=" * 70)

   