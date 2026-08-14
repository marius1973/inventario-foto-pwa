"""Auth por API_KEY (Bearer o cookie) + rate limit in-memory por IP."""
from collections import defaultdict, deque
from time import time

from flask import jsonify, request

from config import Config

_COOKIE = 'api_token'
_hits: dict[str, deque] = defaultdict(deque)


def client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _prune(bucket: deque, window: int, now: float) -> None:
    while bucket and bucket[0] <= now - window:
        bucket.popleft()


def rate_limited(limit: int, window: int, key: str | None = None) -> bool:
    """True si se excedió el límite."""
    now = time()
    bucket_key = f'{key or request.endpoint}:{client_ip()}'
    bucket = _hits[bucket_key]
    _prune(bucket, window, now)
    if len(bucket) >= limit:
        return True
    bucket.append(now)
    return False


def extract_token() -> str | None:
    auth = request.headers.get('Authorization', '')
    if auth.lower().startswith('bearer '):
        return auth[7:].strip() or None
    return request.cookies.get(_COOKIE) or None


def token_valid(token: str | None) -> bool:
    if not Config.auth_required():
        return True
    return bool(token) and token == Config.API_KEY


def rate_limit_for_path(path: str) -> tuple[int, int]:
    if path == '/api/auth/login':
        return Config.RATE_LOGIN
    if path.startswith('/api/clasificar'):
        return Config.RATE_CLASIFICAR
    if path.startswith('/api/sync'):
        return Config.RATE_SYNC
    return Config.RATE_DEFAULT


def register_security(app):
    @app.before_request
    def _guard():
        if request.method == 'OPTIONS':
            return None

        path = request.path
        if not (
            path.startswith('/api/')
            or path.startswith('/fotos/')
            or path.startswith('/uploads/fotos/')
        ):
            return None

        limit, window = rate_limit_for_path(path)
        if rate_limited(limit, window, key=path):
            return jsonify({'error': 'Demasiadas solicitudes. Intenta más tarde.'}), 429

        if path in ('/api/auth/status', '/api/auth/login'):
            return None

        if not Config.auth_required():
            return None

        if not token_valid(extract_token()):
            return jsonify({'error': 'No autorizado', 'auth_required': True}), 401

        return None

    @app.after_request
    def _security_headers(response):
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        return response


def set_auth_cookie(response, token: str):
    response.set_cookie(
        _COOKIE,
        token,
        httponly=True,
        secure=Config.IS_PRODUCTION,
        samesite='Lax',
        max_age=60 * 60 * 24 * 30,
    )
    return response


def clear_auth_cookie(response):
    response.delete_cookie(_COOKIE)
    return response
