# InventarioFoto

> Sistema de inventario movil por fotografia. Toma una foto, registra el producto. Si no existe el tipo, lo creas al instante.

# Arquitectura de InventarioFoto PWA

![Arquitectura Completa](docs/arquitectura.png)


## Caracteristicas

- **Captura fotografica**: Usa la camara del celular
- **Offline-first**: Funciona sin internet
- **Tipos dinamicos**: Crea categorias "al vuelo"
- **PWA**: Instalable como app nativa
- **Responsive**: Disenado para uso en campo

## Stack

| Capa | Tecnologia |
|------|-----------|
| Backend | Python Flask + SQLite |
| Frontend | Vanilla JS + Tailwind CSS |
| Camara | getUserMedia API |
| Storage | IndexedDB (offline) |

## Instalacion

```bash
pip install -r requirements.txt
python app.py
```

Abre http://localhost:5000 en tu navegador.

En iOS/Android: Abre Safari/Chrome → Compartir → "Agregar a inicio"

## API Endpoints

| Metodo | Endpoint | Descripcion |
|--------|----------|-------------|
| GET | /api/productos | Lista productos |
| POST | /api/productos | Crea desde foto |
| DELETE | /api/productos/<id> | Elimina |
| GET | /api/tipos-producto | Lista tipos |
| POST | /api/tipos-producto | Crea tipo nuevo |
| POST | /api/sync | Sincroniza offline |
| GET | /api/estadisticas | Stats |

## Autor

Mario Manrique
