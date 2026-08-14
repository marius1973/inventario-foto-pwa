"""
InventarioFoto - Factory Flask + rutas de UI/fotos.
"""
import os

from flask import Flask, Response, jsonify, render_template, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from config import Config
from db import get_db, init_db
from routes import api_bp, auth_bp
from security import register_security


def create_app():
    Config.assert_production_secrets()

    app = Flask(__name__)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    CORS(app, supports_credentials=True)
    app.config['MAX_CONTENT_LENGTH'] = Config.MAX_CONTENT_LENGTH
    app.config['UPLOAD_FOLDER'] = Config.UPLOAD_FOLDER

    register_security(app)
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    @app.route('/sw.js')
    def service_worker():
        return send_from_directory('static', 'sw.js', mimetype='application/javascript')

    @app.route('/fotos/<foto_id>')
    def foto_db(foto_id):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT mime, data FROM fotos WHERE id = ?", (foto_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({'error': 'No encontrado'}), 404
        return Response(bytes(row['data']), mimetype=row['mime'] or 'image/jpeg')

    @app.route('/uploads/fotos/<filename>')
    def uploaded_file(filename):
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

    init_db()
    return app


app = create_app()

if __name__ == '__main__':
    print("=" * 70)
    print("INVENTARIO FOTO - Sistema de Inventario por Fotografía")
    print("=" * 70)
    print("Abre http://127.0.0.1:5000 en tu navegador")
    if Config.auth_required():
        print("Auth: API_KEY activa (login requerido)")
    else:
        print("Auth: desactivada (define API_KEY para proteger la API)")
    print("=" * 70)

    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=port)
