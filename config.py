"""Configuración centralizada desde variables de entorno."""
import os
from pathlib import Path


class Config:
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads/fotos')
    MAX_CONTENT_LENGTH = 25 * 1024 * 1024
    THUMBNAIL_SIZE = (300, 300)
    THUMBNAIL_QUALITY = 70

    FLASK_ENV = os.environ.get('FLASK_ENV', 'development')
    API_KEY = (os.environ.get('API_KEY') or '').strip()
    IS_PRODUCTION = FLASK_ENV == 'production'

    # Rate limits: (máximo, ventana_segundos)
    RATE_DEFAULT = (120, 60)
    RATE_LOGIN = (10, 900)
    RATE_CLASIFICAR = (10, 60)
    RATE_SYNC = (30, 60)

    @classmethod
    def auth_required(cls) -> bool:
        return bool(cls.API_KEY)

    @classmethod
    def assert_production_secrets(cls) -> None:
        if cls.IS_PRODUCTION and not cls.API_KEY:
            raise SystemExit(
                'FATAL: API_KEY es obligatoria en producción '
                '(FLASK_ENV=production). Configúrala como secret.'
            )


Path(Config.UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)
