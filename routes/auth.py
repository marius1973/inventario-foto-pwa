"""Endpoints de autenticación."""
from flask import Blueprint, jsonify, request

from config import Config
from security import clear_auth_cookie, extract_token, set_auth_cookie, token_valid

auth_bp = Blueprint('auth', __name__)


@auth_bp.get('/api/auth/status')
def auth_status():
    required = Config.auth_required()
    return jsonify({
        'auth_required': required,
        'authenticated': (not required) or token_valid(extract_token()),
    })


@auth_bp.post('/api/auth/login')
def auth_login():
    if not Config.auth_required():
        return jsonify({'token': '', 'auth_required': False})

    data = request.get_json(silent=True) or {}
    password = (data.get('password') or data.get('api_key') or '').strip()
    if password != Config.API_KEY:
        return jsonify({'error': 'Clave incorrecta'}), 401

    resp = jsonify({'token': Config.API_KEY, 'auth_required': True})
    set_auth_cookie(resp, Config.API_KEY)
    return resp


@auth_bp.post('/api/auth/logout')
def auth_logout():
    resp = jsonify({'ok': True})
    clear_auth_cookie(resp)
    return resp
