"""Tests de regresión: auth, fotos en BD y sync offline."""
import io
import os
import tempfile
import unittest
from pathlib import Path

# DB temporal antes de importar la app
_TMP = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
_TMP.close()
os.environ['SQLITE_PATH'] = _TMP.name
os.environ['FLASK_ENV'] = 'development'
os.environ['API_KEY'] = 'test-key-regression'
os.environ.pop('DATABASE_URL', None)

from app import app  # noqa: E402
from db import get_db, init_db  # noqa: E402
import security  # noqa: E402


def _tiny_jpeg():
    """JPEG mínimo válido (1x1)."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (1, 1), color=(10, 20, 30)).save(buf, format='JPEG')
    return buf.getvalue()


class InventarioTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = app
        cls.app.config['TESTING'] = True

    def setUp(self):
        security._hits.clear()
        conn = get_db()
        cur = conn.cursor()
        for table in ('productos', 'fotos', 'tipos_producto', 'configuracion'):
            cur.execute(f'DELETE FROM {table}')
        conn.commit()
        conn.close()
        init_db()
        self.client = self.app.test_client()

    def _login(self):
        r = self.client.post('/api/auth/login', json={'password': 'test-key-regression'})
        self.assertEqual(r.status_code, 200)
        return r

    def test_auth_bloquea_sin_token(self):
        r = self.client.get('/api/productos')
        self.assertEqual(r.status_code, 401)
        self.assertTrue(r.get_json().get('auth_required'))

    def test_auth_login_y_cookie(self):
        self._login()
        r = self.client.get('/api/productos')
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.get_json(), list)

    def test_auth_bearer(self):
        r = self.client.get(
            '/api/productos',
            headers={'Authorization': 'Bearer test-key-regression'},
        )
        self.assertEqual(r.status_code, 200)

    def test_foto_se_guarda_y_sirve(self):
        self._login()
        jpeg = _tiny_jpeg()
        data = {
            'nombre': 'Tornillo',
            'cantidad': '1',
            'tipo_producto_id': 'tipo-1',
            'foto': (io.BytesIO(jpeg), 'foto.jpg'),
        }
        r = self.client.post(
            '/api/productos',
            data=data,
            content_type='multipart/form-data',
            buffered=True,
        )
        self.assertEqual(r.status_code, 201, r.get_json())
        producto = r.get_json()
        self.assertTrue(producto['foto_url'].startswith('/fotos/'))
        self.assertTrue(producto.get('foto_thumbnail'))

        foto = self.client.get(producto['foto_url'])
        self.assertEqual(foto.status_code, 200)
        self.assertTrue(foto.data.startswith(b'\xff\xd8'))
        self.assertGreater(len(foto.data), 10)

        # Persiste en tabla fotos
        foto_id = producto['foto_url'].rsplit('/', 1)[1]
        conn = get_db()
        row = conn.cursor().execute(
            'SELECT id, mime, length(data) as n FROM fotos WHERE id = ?', (foto_id,)
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertGreater(row['n'], 0)

    def test_sync_crea_producto_con_foto_base64(self):
        self._login()
        import base64
        b64 = base64.b64encode(_tiny_jpeg()).decode()
        payload = {
            'productos': [{
                'temp_id': 'tmp-1',
                'nombre': 'Offline Item',
                'tipo_producto_id': 'tipo-1',
                'cantidad': 2,
                'foto_base64': f'data:image/jpeg;base64,{b64}',
            }]
        }
        r = self.client.post('/api/sync', json=payload)
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body['sincronizados'], 1)
        self.assertEqual(body['detalles'][0]['temp_id'], 'tmp-1')

        productos = self.client.get('/api/productos').get_json()
        self.assertEqual(len(productos), 1)
        self.assertEqual(productos[0]['nombre'], 'Offline Item')
        self.assertTrue(productos[0]['foto_url'].startswith('/fotos/'))

        foto = self.client.get(productos[0]['foto_url'])
        self.assertEqual(foto.status_code, 200)

    def test_sync_crea_tipo_nuevo(self):
        self._login()
        payload = {
            'productos': [{
                'temp_id': 'tmp-2',
                'nombre': 'Nuevo',
                'nuevo_tipo_nombre': 'Tipo Offline',
                'cantidad': 1,
            }]
        }
        r = self.client.post('/api/sync', json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()['sincronizados'], 1)
        tipos = self.client.get('/api/tipos-producto').get_json()
        nombres = [t['nombre'] for t in tipos]
        self.assertIn('Tipo Offline', nombres)

    def test_sync_ignora_sin_nombre(self):
        self._login()
        r = self.client.post('/api/sync', json={
            'productos': [{'temp_id': 'x', 'tipo_producto_id': 'tipo-1'}]
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()['sincronizados'], 0)

    def test_rate_limit_login(self):
        codes = [
            self.client.post('/api/auth/login', json={'password': 'bad'}).status_code
            for _ in range(12)
        ]
        self.assertIn(429, codes)


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2)
    finally:
        Path(_TMP.name).unlink(missing_ok=True)
