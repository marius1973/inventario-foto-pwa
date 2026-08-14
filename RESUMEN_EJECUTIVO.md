# Estado real del refactor — InventarioFoto

Documento alineado con el código en el repo (no con un plan aspiracional).

## Arquitectura actual (aplicada)

```
app.py                 Factory Flask + rutas UI/fotos
config.py              Env (API_KEY, FLASK_ENV, rate limits)
security.py            Auth Bearer/cookie + rate limit in-memory
db.py                  SQLite local / Postgres si DATABASE_URL
services/imagen.py     Thumbnail + persistencia de fotos en BD
routes/auth.py         /api/auth/status|login|logout
routes/api.py          REST productos, tipos, sync, export, IA
static/js/app.js       PWA (ApiService + InventarioApp; aún monolítico)
```

## Qué sí está hecho

- Capas backend mínimas (config / security / services / routes)
- Auth con `API_KEY` (obligatoria en `FLASK_ENV=production`)
- Rate limit por IP (login, clasificar, sync, API general)
- Fotos en BD (`/fotos/<id>`), sync offline con foto base64
- Dual DB: SQLite / Postgres
- Deploy: `render.yaml` + `Dockerfile`/`fly.toml`
- Tests de regresión: `python -m unittest tests.test_api -v`

## Qué NO está hecho (no lo trates como implementado)

- Models/dataclasses, Exceptions custom, decorators `@handle_exceptions`
- Servicios de dominio ProductoService / TipoProductoService
- Frontend partido en módulos (sigue siendo un `app.js` grande)
- JWT multi-usuario / roles
- ORM, Swagger, suite E2E

## Próximos pasos (opcionales)

1. Más tests (export, delete foto, tipos)
2. Partir `app.js` solo si duele mantenerlo
3. Deploy Fly: instalar flyctl → `fly launch` / `fly deploy` + `fly secrets set API_KEY=...`
4. Auth multi-usuario solo si deja de ser un inventario de un solo operador
