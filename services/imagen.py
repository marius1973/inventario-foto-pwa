"""Procesamiento y persistencia de fotos."""
import base64
import io
import uuid
from datetime import datetime

from PIL import Image

from config import Config
from db import get_db, to_blob


def generar_thumbnail(image_data, max_size=None):
    max_size = max_size or Config.THUMBNAIL_SIZE
    try:
        img = Image.open(io.BytesIO(image_data))
        img.thumbnail(max_size, Image.LANCZOS)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=Config.THUMBNAIL_QUALITY)
        img_str = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/jpeg;base64,{img_str}"
    except Exception as e:
        print(f"Error generando thumbnail: {e}")
        return None


def guardar_foto(img_data, mime='image/jpeg'):
    """Guarda la foto en la BD y devuelve (foto_url, foto_thumbnail)."""
    foto_id = uuid.uuid4().hex
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO fotos (id, mime, data, fecha_creacion) VALUES (?, ?, ?, ?)",
        (foto_id, mime or 'image/jpeg', to_blob(img_data), datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return f"/fotos/{foto_id}", generar_thumbnail(img_data)
