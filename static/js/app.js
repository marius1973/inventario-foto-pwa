/**
 * InventarioFoto - Aplicación PWA de gestión de inventario
 *
 * Arquitectura:
 * - ApiService: Comunicación con backend
 * - StorageService: Gestión de IndexedDB (datos offline)
 * - SyncService: Sincronización de datos
 * - CameraManager: Captura y procesamiento de fotos
 * - UIManager: Renderización y eventos
 * - InventarioApp: Orquestación principal
 */

// ============================================================================
// CONSTANTES
// ============================================================================

const CONSTANTS = {
    API_BASE: '',
    CACHE_KEY_PRODUCTOS: 'productos',
    CACHE_KEY_TIPOS: 'tipos',
    DB_NAME: 'InventarioDB',
    DB_VERSION: 1,
    PRODUCTOS_POR_PAGINA: 10,
    PAGE_SIZE: 50,
    TOAST_DURATION_MS: 3000,
    CAMERA_TIMEOUT_MS: 2000,
    VIDEO_FRAME_WAIT_ATTEMPTS: 30,
    THUMBNAIL_PLACEHOLDER: '📦',
};

// ============================================================================
// API SERVICE - Comunicación con servidor
// ============================================================================

class ApiService {
    /**
     * Servicio para todas las comunicaciones REST con el backend.
     */

    static async fetchJson(endpoint, options = {}) {
        const url = `${CONSTANTS.API_BASE}${endpoint}`;
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Error ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error en ${endpoint}:`, error);
            throw error;
        }
    }

    // Tipos de productos
    static getTipos() {
        return this.fetchJson('/api/tipos-producto');
    }

    static crearTipo(nombre, descripcion = '', icono = '📦', color = '#3b82f6') {
        return this.fetchJson('/api/tipos-producto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, descripcion, icono, color }),
        });
    }

    static actualizarTipo(id, datos) {
        return this.fetchJson(`/api/tipos-producto/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos),
        });
    }

    static async eliminarTipo(id, reasignarA = null) {
        const url = reasignarA
            ? `/api/tipos-producto/${id}?reasignar_a=${encodeURIComponent(reasignarA)}`
            : `/api/tipos-producto/${id}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const body = await respuesta.json().catch(() => ({}));
        return { ok: respuesta.ok, status: respuesta.status, body };
    }

    // Productos
    static getProductos(filtros = {}) {
        const params = new URLSearchParams();
        if (filtros.tipo_id) params.append('tipo_id', filtros.tipo_id);
        if (filtros.q) params.append('q', filtros.q);
        if (filtros.limit) params.append('limit', filtros.limit);
        if (filtros.offset) params.append('offset', filtros.offset);

        const queryString = params.toString();
        const endpoint = queryString ? `/api/productos?${queryString}` : '/api/productos';
        return this.fetchJson(endpoint);
    }

    static getProducto(id) {
        return this.fetchJson(`/api/productos/${id}`);
    }

    static crearProducto(formData) {
        return this.fetchJson('/api/productos', {
            method: 'POST',
            body: formData,
        });
    }

    static actualizarProducto(id, formData) {
        return this.fetchJson(`/api/productos/${id}`, {
            method: 'PUT',
            body: formData,
        });
    }

    static eliminarProducto(id) {
        return this.fetchJson(`/api/productos/${id}`, {
            method: 'DELETE',
        });
    }

    static getEstadisticas() {
        return this.fetchJson('/api/estadisticas');
    }

    static sincronizar(productos) {
        return this.fetchJson('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productos }),
        });
    }

    // Configuración
    static getConfig() {
        return this.fetchJson('/api/config');
    }

    static updateConfig(moneda_simbolo) {
        return this.fetchJson('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moneda_simbolo }),
        });
    }

    static clasificarFoto(foto_base64) {
        return this.fetchJson('/api/clasificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ foto_base64 }),
        });
    }
}

// ============================================================================
// STORAGE SERVICE - Gestión de datos offline
// ============================================================================

class StorageService {
    /**
     * Maneja almacenamiento en IndexedDB para soporte offline.
     */

    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(CONSTANTS.DB_NAME, CONSTANTS.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('productos')) {
                    db.createObjectStore('productos', { keyPath: 'temp_id' });
                }
                if (!db.objectStoreNames.contains('tipos')) {
                    db.createObjectStore('tipos', { keyPath: 'id' });
                }
            };
        });
    }

    async guardarPendiente(producto) {
        const tempId = `temp-${Date.now()}`;
        producto.temp_id = tempId;
        producto.fecha_creacion = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readwrite');
            const store = tx.objectStore('productos');
            const request = store.put(producto);

            request.onsuccess = () => resolve(tempId);
            request.onerror = () => reject(request.error);
        });
    }

    async obtenerPendientes() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readonly');
            const store = tx.objectStore('productos');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async limpiarPendientes() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readwrite');
            const store = tx.objectStore('productos');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// ============================================================================
// SYNC SERVICE - Sincronización de datos
// ============================================================================

class SyncService {
    /**
     * Gestiona la sincronización de datos entre cliente y servidor.
     */

    constructor(storageService) {
        this.storage = storageService;
        this.onProgress = null;
    }

    async sincronizar() {
        const pendientes = await this.storage.obtenerPendientes();

        if (pendientes.length === 0) {
            return { sincronizados: 0, total: 0 };
        }

        try {
            const resultado = await ApiService.sincronizar(pendientes);
            await this.storage.limpiarPendientes();
            return resultado;
        } catch (error) {
            console.error('Error en sincronización:', error);
            throw error;
        }
    }

    async obtenerPendientes() {
        return await this.storage.obtenerPendientes();
    }

    async obtenerCountPendientes() {
        const pendientes = await this.obtenerPendientes();
        return pendientes.length;
    }
}

// ============================================================================
// CAMERA MANAGER - Gestión de captura de fotos
// ============================================================================

class CameraManager {
    /**
     * Maneja la captura de fotos desde cámara o galería.
     */

    constructor() {
        this.stream = null;
        this.fotoCapturada = null;
    }

    crearInputFoto() {
        if (this._fotoInput) return this._fotoInput;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.className = 'sr-only';
        input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;';

        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';

            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                this.fotoCapturada = reader.result;
                this.onFotoCapturada?.(this.fotoCapturada);
            };
            reader.onerror = () => {
                console.error('Error leyendo imagen');
                this.onError?.('No se pudo leer la imagen');
            };
            reader.readAsDataURL(file);
        });

        document.body.appendChild(input);
        this._fotoInput = input;
        return input;
    }

    abrirGaleria(options = {}) {
        const input = this.crearInputFoto();
        const esMovil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        const forzarCamara = options.capture === true;
        if (esMovil && forzarCamara) {
            input.setAttribute('capture', 'environment');
        } else {
            input.removeAttribute('capture');
        }

        input.click();
    }

    async abrirCamara() {
        if (!this._puedeLeerCamara()) {
            this.onError?.('Tu navegador no permite usar la cámara aquí');
            if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')) {
                setTimeout(() => this.abrirGaleria(), 200);
            }
            return;
        }

        if (!window.isSecureContext) {
            this.onError?.('Conexión no segura: usa HTTPS o elige una foto.');
            if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')) {
                setTimeout(() => this.abrirGaleria(), 300);
            }
            return;
        }

        const restricciones = [
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            { video: { facingMode: 'environment' }, audio: false },
            { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
            { video: true, audio: false },
        ];

        for (const restriccion of restricciones) {
            try {
                this._detenerStream();
                const stream = await navigator.mediaDevices.getUserMedia(restriccion);
                this._iniciarStream(stream);
                return;
            } catch (error) {
                console.log(`Restricción falló, intentando siguiente...`, error.name);
                continue;
            }
        }

        this.onError?.('No se pudo acceder a la cámara');
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
            setTimeout(() => this.abrirGaleria(), 400);
        }
    }

    _puedeLeerCamara() {
        return navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
    }

    _iniciarStream(stream) {
        this.stream = stream;
        const video = document.getElementById('camera-video');
        if (video) {
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            video.play().catch(() => {
                // Algunos dispositivos requieren gesto del usuario
            });
        }
        this.onStreamStarted?.();
    }

    _detenerStream() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }

    cerrar(conservarFoto = false) {
        this._detenerStream();
        if (!conservarFoto) this.fotoCapturada = null;
        this.onClosed?.();
    }

    async capturarFoto() {
        const video = document.getElementById('camera-video');
        const canvas = document.getElementById('camera-canvas');

        if (!video) return;

        await this._esperarVideoListo(video);

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        this.fotoCapturada = canvas.toDataURL('image/jpeg', 0.85);

        if (!this.fotoCapturada || this.fotoCapturada.length < 200) {
            this.onError?.('La foto capturada está vacía');
            return;
        }

        this.onFotoCapturada?.(this.fotoCapturada);
    }

    async _esperarVideoListo(video) {
        if (video.readyState < 2) {
            await new Promise(resolve => {
                video.addEventListener('loadeddata', resolve, { once: true });
                video.addEventListener('loadedmetadata', resolve, { once: true });
                setTimeout(resolve, CONSTANTS.CAMERA_TIMEOUT_MS);
            });
        }

        for (let i = 0; i < CONSTANTS.VIDEO_FRAME_WAIT_ATTEMPTS; i++) {
            if (video.videoWidth > 0 && video.videoHeight > 0) break;
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }
}

// ============================================================================
// BARCODE SCANNER - Escaneo de códigos de barras
// ============================================================================

class BarcodeScanner {
    /**
     * Escanea códigos de barras con la cámara.
     * Usa la API nativa BarcodeDetector (Chrome/Android) y cae a ZXing
     * (cargado desde CDN) en navegadores sin soporte, como iOS Safari.
     */

    static ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    static FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

    constructor() {
        this.stream = null;
        this.activo = false;
        this.onDetectado = null;
        this._reader = null;
        this._detector = null;
    }

    async abrir(onDetectado) {
        if (!navigator.mediaDevices?.getUserMedia) {
            UIManager.mostrarToast('Tu navegador no permite usar la cámara aquí', 'error');
            return;
        }
        if (!window.isSecureContext) {
            UIManager.mostrarToast('El escáner requiere HTTPS', 'error');
            return;
        }

        this.onDetectado = onDetectado;
        this.activo = true;
        document.getElementById('scanner-overlay')?.classList.add('active');

        try {
            if ('BarcodeDetector' in window) {
                await this._iniciarNativo();
            } else {
                await this._iniciarZXing();
            }
        } catch (error) {
            console.error('Error iniciando escáner:', error);
            UIManager.mostrarToast('No se pudo iniciar el escáner', 'error');
            this.cerrar();
        }
    }

    async _iniciarNativo() {
        const soportados = await window.BarcodeDetector.getSupportedFormats();
        const formatos = BarcodeScanner.FORMATOS.filter(f => soportados.includes(f));
        if (formatos.length === 0) {
            await this._iniciarZXing();
            return;
        }

        this._detector = new window.BarcodeDetector({ formats: formatos });
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        });

        const video = document.getElementById('scanner-video');
        video.srcObject = this.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => {});
        this._escanearFrame(video);
    }

    async _escanearFrame(video) {
        if (!this.activo) return;
        try {
            if (video.readyState >= 2) {
                const codigos = await this._detector.detect(video);
                if (codigos.length > 0) {
                    this._detectado(codigos[0].rawValue);
                    return;
                }
            }
        } catch (e) {
            // Frame aún no disponible; se reintenta
        }
        setTimeout(() => this._escanearFrame(video), 250);
    }

    async _iniciarZXing() {
        await this._cargarZXing();
        this._reader = new window.ZXing.BrowserMultiFormatReader();
        await this._reader.decodeFromVideoDevice(null, 'scanner-video', (resultado) => {
            if (resultado && this.activo) {
                this._detectado(resultado.getText());
            }
        });
    }

    _cargarZXing() {
        if (window.ZXing) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = BarcodeScanner.ZXING_CDN;
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar la librería de escaneo (¿sin conexión?)'));
            document.head.appendChild(script);
        });
    }

    _detectado(codigo) {
        if (!this.activo) return;
        this.activo = false;
        if (navigator.vibrate) navigator.vibrate(80);
        this.cerrar();
        this.onDetectado?.(codigo);
    }

    cerrar() {
        this.activo = false;
        if (this._reader) {
            try { this._reader.reset(); } catch (e) { /* ignorar */ }
            this._reader = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        const video = document.getElementById('scanner-video');
        if (video) video.srcObject = null;
        document.getElementById('scanner-overlay')?.classList.remove('active');
    }
}

// ============================================================================
// UI MANAGER - Renderización y gestión de UI
// ============================================================================

class UIManager {
    /**
     * Gestiona toda la renderización y manipulación del DOM.
     */

    static mostrarToast(mensaje, tipo = 'info') {
        const iconos = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: '💡',
        };

        const toast = document.getElementById('toast');
        document.getElementById('toast-icon').textContent = iconos[tipo] || '💡';
        document.getElementById('toast-message').textContent = mensaje;

        toast.classList.remove('-translate-y-20', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');

        setTimeout(() => {
            toast.classList.add('-translate-y-20', 'opacity-0');
            toast.classList.remove('translate-y-0', 'opacity-100');
        }, CONSTANTS.TOAST_DURATION_MS);
    }

    static actualizarBadgePendientes(count) {
        const badge = document.getElementById('pending-count');
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    static actualizarBadgeOffline(estaOffline) {
        const badge = document.getElementById('offline-badge');
        if (estaOffline) {
            badge.classList.add('show');
        } else {
            badge.classList.remove('show');
        }
    }

    static abrirModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }

    static cerrarModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }

    static cambiarVista(vista) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.view === vista;
            btn.classList.toggle('text-blue-500', isActive);
            btn.classList.toggle('text-slate-400', !isActive);
        });
    }

    static renderizarProductoCard(producto, monedaSimbolo = 'S/') {
        const imagenHtml = producto.foto_thumbnail || producto.foto_url
            ? `<img src="${producto.foto_thumbnail || producto.foto_url}" alt="" class="w-full h-full object-cover" loading="lazy">`
            : `<div class="w-full h-full flex items-center justify-center text-2xl">${producto.tipo_icono || CONSTANTS.THUMBNAIL_PLACEHOLDER}</div>`;

        return `
            <div class="product-card bg-white rounded-2xl shadow-sm overflow-hidden" onclick="app.verProducto('${producto.id}')">
                <div class="flex">
                    <div class="w-24 h-24 flex-shrink-0 bg-slate-100">
                        ${imagenHtml}
                    </div>
                    <div class="flex-1 p-3">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-medium text-slate-900 text-sm line-clamp-1">${producto.nombre}</h3>
                                <p class="text-xs text-slate-500 mt-0.5">${producto.tipo_nombre || 'Sin tipo'}</p>
                            </div>
                            <span class="text-xs font-semibold" style="color:${producto.tipo_color || '#64748b'}">${producto.cantidad} u.</span>
                        </div>
                        <div class="flex justify-between items-end mt-2">
                            <span class="text-sm font-bold text-slate-900">${monedaSimbolo}${producto.precio_unitario || 0}</span>
                            <button onclick="event.stopPropagation(); app.eliminarProducto('${producto.id}')" class="text-red-400 p-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// ============================================================================
// APLICACIÓN PRINCIPAL
// ============================================================================

class InventarioApp {
    /**
     * Orquestador principal de la aplicación.
     */

    constructor() {
        this.storage = new StorageService();
        this.sync = new SyncService(this.storage);
        this.camera = new CameraManager();
        this.barcodeScanner = new BarcodeScanner();

        this.productos = [];
        this.tipos = [];
        this.vistaActual = 'inicio';
        this.tipoSeleccionado = null;
        this.estaOnline = navigator.onLine;
        this.filtroActual = {};
        this.hayMasProductos = false;
        this._tipoEditando = null;
        this.iconoActual = '📦';
        this.monedaSimbolo = 'S/';
        this.ubicacionActual = null;

        this._setupCameraCallbacks();
        this._setupEventListeners();
    }

    async inicializar() {
        try {
            await this.storage.init();
            // Cargar configuración (moneda)
            try {
                const config = await ApiService.getConfig();
                this.monedaSimbolo = config.moneda_simbolo || 'S/';
            } catch (error) {
                console.warn('No se pudo cargar configuración, usando valor por defecto:', error);
                this.monedaSimbolo = 'S/';
            }
            await this._cargarDatos();
            this._actualizarEstadoUI();
            this._renderizarVista('inicio');
        } catch (error) {
            console.error('Error inicializando:', error);
            UIManager.mostrarToast('Error al inicializar la aplicación', 'error');
        }
    }

    async _cargarDatos() {
        try {
            const [productos, tipos] = await Promise.all([
                ApiService.getProductos({ ...this.filtroActual, limit: CONSTANTS.PAGE_SIZE }),
                ApiService.getTipos(),
            ]);

            this.productos = productos;
            this.tipos = tipos;
            this.hayMasProductos = productos.length === CONSTANTS.PAGE_SIZE;
        } catch (error) {
            console.error('Error cargando datos:', error);
        }
    }

    async cargarMasProductos() {
        try {
            const siguientes = await ApiService.getProductos({
                ...this.filtroActual,
                limit: CONSTANTS.PAGE_SIZE,
                offset: this.productos.length,
            });
            this.productos = this.productos.concat(siguientes);
            this.hayMasProductos = siguientes.length === CONSTANTS.PAGE_SIZE;
            this._renderizarVista(this.vistaActual);
        } catch (error) {
            console.error('Error cargando más productos:', error);
            UIManager.mostrarToast('Error cargando más productos', 'error');
        }
    }

    async _actualizarEstadoUI() {
        UIManager.actualizarBadgeOffline(!this.estaOnline);

        try {
            const countPendientes = await this.sync.obtenerCountPendientes();
            UIManager.actualizarBadgePendientes(countPendientes);
        } catch (error) {
            console.error('Error actualizando pendientes:', error);
        }
    }

    _setupCameraCallbacks() {
        // Tras capturar: vista previa en overlay si la cámara está abierta; si no, ir al formulario (galería)
        this.camera.onFotoCapturada = (foto) => {
            const overlay = document.getElementById('camera-overlay');
            const preview = document.getElementById('capture-preview');
            const previewImg = document.getElementById('preview-img');
            const controls = document.getElementById('camera-controls');
            if (overlay && overlay.classList.contains('active')) {
                if (previewImg) previewImg.src = foto;
                if (preview) preview.classList.remove('hidden');
                if (controls) controls.classList.add('hidden');
            } else {
                this._capturarUbicacion();
                this._mostrarFormularioProducto(foto);
            }
        };

        this.camera.onError = (error) => {
            UIManager.mostrarToast(error, 'error');
        };

        this.camera.onStreamStarted = () => {
            const overlay = document.getElementById('camera-overlay');
            const preview = document.getElementById('capture-preview');
            const controls = document.getElementById('camera-controls');
            if (overlay) overlay.classList.add('active');
            if (preview) preview.classList.add('hidden');
            if (controls) controls.classList.remove('hidden');
        };

        this.camera.onClosed = () => {
            const overlay = document.getElementById('camera-overlay');
            const preview = document.getElementById('capture-preview');
            if (overlay) overlay.classList.remove('active');
            if (preview) preview.classList.add('hidden');
        };
    }

    _setupEventListeners() {
        window.addEventListener('online', () => {
            this.estaOnline = true;
            UIManager.actualizarBadgeOffline(false);
            UIManager.mostrarToast('Conexión restaurada', 'success');
            this._sincronizarAutomatico();
        });

        window.addEventListener('offline', () => {
            this.estaOnline = false;
            UIManager.actualizarBadgeOffline(true);
            UIManager.mostrarToast('Modo offline activado', 'warning');
        });
    }

    // ====================================================================
    // Navegación
    // ====================================================================

    cambiarVista(vista) {
        this.vistaActual = vista;
        UIManager.cambiarVista(vista);
        this._renderizarVista(vista);
    }

    _renderizarVista(vista) {
        const container = document.getElementById('main-content');

        if (vista === 'inicio') {
            this._renderizarInicio(container);
        } else if (vista === 'historial') {
            this._renderizarHistorial(container);
        }
    }

    async _renderizarInicio(container) {
        try {
            const stats = await ApiService.getEstadisticas();

            container.innerHTML = `
                <div class="fade-in">
                    <div class="grid grid-cols-2 gap-4 p-4">
                        <div class="bg-white rounded-2xl p-4 shadow-sm">
                            <div class="text-2xl font-bold text-slate-900">${stats?.total_productos || 0}</div>
                            <div class="text-xs text-slate-500 mt-1">Productos</div>
                        </div>
                        <div class="bg-white rounded-2xl p-4 shadow-sm">
                            <div class="text-2xl font-bold text-slate-900">${this.monedaSimbolo}${(stats?.valor_total || 0).toLocaleString()}</div>
                            <div class="text-xs text-slate-500 mt-1">Valor total</div>
                        </div>
                    </div>

                    <div class="px-4 mb-4">
                        <div class="flex justify-between items-center mb-3">
                            <h2 class="font-semibold text-slate-900">Categorías</h2>
                            <div class="flex items-center space-x-4">
                                <button onclick="app.gestionarTipos()" class="text-slate-500 text-sm font-medium">⚙️ Gestionar</button>
                                <button onclick="app.abrirModalTipo()" class="text-blue-500 text-sm font-medium">+ Nuevo</button>
                            </div>
                        </div>
                        <div class="flex space-x-3 overflow-x-auto hide-scrollbar pb-2">
                            ${this._renderizarFiltrosTipo()}
                        </div>
                    </div>

                    <div class="px-4">
                        <h2 class="font-semibold text-slate-900 mb-3">Productos recientes</h2>
                        <div class="space-y-3">
                            ${this.productos.slice(0, CONSTANTS.PRODUCTOS_POR_PAGINA)
                                .map(p => UIManager.renderizarProductoCard(p, this.monedaSimbolo))
                                .join('')}
                        </div>
                        ${this.productos.length === 0 ? `
                            <div class="text-center py-12">
                                <div class="text-4xl mb-3">📸</div>
                                <p class="text-slate-500">No hay productos aún</p>
                                <p class="text-sm text-slate-400 mt-1">Toca el botón de cámara para agregar uno</p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error renderizando inicio:', error);
            UIManager.mostrarToast('Error cargando datos', 'error');
        }
    }

    _renderizarFiltrosTipo() {
        const filtros = [
            `<button onclick="app.filtrarPorTipo(null)"
                class="tipo-chip flex-shrink-0 flex items-center space-x-2 px-4 py-2 rounded-full ${
                    !this.tipoSeleccionado ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm'
                }">
                <span>📋</span><span class="text-sm font-medium">Todos</span>
            </button>`,
        ];

        for (const tipo of this.tipos) {
            const esActivo = this.tipoSeleccionado === tipo.id;
            filtros.push(`
                <button onclick="app.filtrarPorTipo('${tipo.id}')"
                    class="tipo-chip flex-shrink-0 flex items-center space-x-2 px-4 py-2 rounded-full ${
                        esActivo ? 'ring-2 ring-offset-2' : 'bg-white shadow-sm'
                    }"
                    style="${esActivo ? `background:${tipo.color};color:white;--tw-ring-color:${tipo.color}` : `color:${tipo.color}`}">
                    <span>${tipo.icono}</span><span class="text-sm font-medium">${tipo.nombre}</span>
                </button>
            `);
        }

        return filtros.join('');
    }

    async _renderizarHistorial(container) {
        container.innerHTML = `
            <div class="fade-in p-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="font-semibold text-slate-900">Historial completo</h2>
                    <div class="flex space-x-2">
                        <a href="/api/export?formato=xlsx" download
                            class="flex items-center space-x-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-medium active:scale-95 transition">
                            <span>📊</span><span>Excel</span>
                        </a>
                        <a href="/api/export?formato=csv" download
                            class="flex items-center space-x-1 px-3 py-2 rounded-lg bg-slate-600 text-white text-xs font-medium active:scale-95 transition">
                            <span>📄</span><span>CSV</span>
                        </a>
                    </div>
                </div>
                <div class="space-y-3">
                    ${this.productos
                        .map(p => UIManager.renderizarProductoCard(p, this.monedaSimbolo))
                        .join('')}
                </div>
                ${this.hayMasProductos ? `
                    <button onclick="app.cargarMasProductos()"
                        class="w-full mt-4 py-3 rounded-xl bg-white shadow-sm text-blue-500 font-medium active:scale-95 transition">
                        Cargar más productos
                    </button>
                ` : ''}
            </div>
        `;
    }

    // ====================================================================
    // Filtros
    // ====================================================================

    async filtrarPorTipo(tipoId) {
        this.tipoSeleccionado = tipoId;
        this.filtroActual = tipoId ? { tipo_id: tipoId } : {};
        try {
            this.productos = await ApiService.getProductos({
                ...this.filtroActual,
                limit: CONSTANTS.PAGE_SIZE,
            });
            this.hayMasProductos = this.productos.length === CONSTANTS.PAGE_SIZE;
            this._renderizarVista('inicio');
        } catch (error) {
            console.error('Error filtrando:', error);
            UIManager.mostrarToast('Error filtrando productos', 'error');
        }
    }

    async buscar(query) {
        if (!query) {
            this.filtroActual = {};
            await this._cargarDatos();
            this._renderizarVista(this.vistaActual);
            return;
        }

        this.filtroActual = { q: query };
        try {
            this.productos = await ApiService.getProductos({ q: query, limit: CONSTANTS.PAGE_SIZE });
            this.hayMasProductos = this.productos.length === CONSTANTS.PAGE_SIZE;
            this._renderizarVista('inicio');
        } catch (error) {
            console.error('Error buscando:', error);
            UIManager.mostrarToast('Error buscando productos', 'error');
        }
    }

    buscarToggle() {
        const bar = document.getElementById('search-bar');
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
            document.getElementById('search-input').focus();
        }
    }

    // ====================================================================
    // Cámara y Fotos
    // ====================================================================

    abrirCamara() {
        this.camera.abrirCamara();
    }

    cerrarCamara(guardarFoto = false) {
        this.camera.cerrar(guardarFoto);
    }

    capturarFoto() {
        this.camera.capturarFoto();
    }

    repetirFoto() {
        this.camera.fotoCapturada = null;
        document.getElementById('capture-preview').classList.add('hidden');
        document.getElementById('camera-controls').classList.remove('hidden');
    }

    confirmarFoto() {
        const foto = this.camera.fotoCapturada;
        if (!foto) {
            UIManager.mostrarToast('Primero captura una foto', 'warning');
            return;
        }
        this._capturarUbicacion();
        this.cerrarCamara(true);
        this._mostrarFormularioProducto(foto);
    }

    _capturarUbicacion() {
        this.ubicacionActual = null;
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.ubicacionActual = {
                    latitud: pos.coords.latitude,
                    longitud: pos.coords.longitude,
                };
                const indicador = document.getElementById('ubicacion-indicador');
                if (indicador) {
                    indicador.textContent = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
                    indicador.closest('.ubicacion-row')?.classList.remove('hidden');
                }
            },
            () => { },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    }

    // ====================================================================
    // Escáner de código de barras
    // ====================================================================

    escanearCodigo() {
        this.barcodeScanner.abrir((codigo) => {
            const input = document.getElementById('form-codigo');
            if (input) input.value = codigo;
            UIManager.mostrarToast(`Código detectado: ${codigo}`, 'success');
        });
    }

    cerrarScanner() {
        this.barcodeScanner.cerrar();
    }

    // ====================================================================
    // Formulario de Producto
    // ====================================================================

    _mostrarFormularioProducto(fotoBase64) {
        const container = document.getElementById('main-content');

        this._clasificarConIA(fotoBase64);

        container.innerHTML = `
            <div class="fade-in p-4 pb-24">
                <div class="flex items-center space-x-3 mb-4">
                    <button onclick="app.cambiarVista('inicio')" class="p-2 -ml-2">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                        </svg>
                    </button>
                    <h2 class="font-bold text-lg">Nuevo producto</h2>
                </div>

                <div class="bg-white rounded-2xl overflow-hidden mb-4 shadow-sm">
                    <img src="${fotoBase64}" class="w-full h-48 object-cover">
                    <div id="ia-badge" class="hidden px-4 py-2 bg-purple-50 border-t border-purple-100 flex items-center space-x-2">
                        <span class="text-purple-500 text-sm">🤖</span>
                        <span id="ia-mensaje" class="text-xs text-purple-700"></span>
                    </div>
                </div>

                <form id="product-form" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                        <input type="text" id="form-nombre" placeholder="Ej: Laptop Dell Latitude"
                            class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Cantidad</label>
                            <input type="number" id="form-cantidad" value="1" min="1"
                                class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Precio</label>
                            <input type="number" id="form-precio" placeholder="0.00" step="0.01"
                                class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Código de barras</label>
                        <div class="flex space-x-2">
                            <input type="text" id="form-codigo" placeholder="Escanea o escribe"
                                class="flex-1 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <button type="button" onclick="app.escanearCodigo()" title="Escanear código"
                                class="px-4 rounded-xl bg-slate-900 text-white flex items-center justify-center active:scale-95 transition">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14"/></svg>
                            </button>
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Tipo *</label>
                        <div class="flex flex-wrap gap-2">
                            ${this.tipos.map(tipo => `
                                <button type="button" onclick="app.seleccionarTipoForm('${tipo.id}')"
                                    id="tipo-form-${tipo.id}"
                                    class="tipo-form-btn flex items-center space-x-1 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition">
                                    <span>${tipo.icono}</span><span>${tipo.nombre}</span>
                                </button>
                            `).join('')}
                            <button type="button" onclick="app.abrirModalTipo()"
                                class="flex items-center space-x-1 px-3 py-2 rounded-lg border-2 border-dashed border-blue-300 text-blue-500 text-sm hover:bg-blue-50 transition">
                                <span>+</span><span>Nuevo tipo</span>
                            </button>
                        </div>
                        <input type="hidden" id="form-tipo-id">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                        <textarea id="form-descripcion" rows="2" placeholder="Opcional"
                            class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
                    </div>

                    <div class="ubicacion-row ${this.ubicacionActual ? '' : 'hidden'} flex items-center space-x-2 p-3 bg-green-50 rounded-xl border border-green-200">
                        <span class="text-green-600">📍</span>
                        <span id="ubicacion-indicador" class="text-xs text-green-700 font-mono">${
                            this.ubicacionActual
                                ? this.ubicacionActual.latitud.toFixed(5) + ', ' + this.ubicacionActual.longitud.toFixed(5)
                                : ''
                        }</span>
                    </div>
                </form>

                <button onclick="app.guardarProducto('${fotoBase64}')"
                    class="w-full mt-6 bg-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition">
                    Guardar Producto
                </button>
            </div>
        `;
    }

    async _clasificarConIA(fotoBase64) {
        if (!this.estaOnline) return;

        try {
            const resultado = await ApiService.clasificarFoto(fotoBase64);

            if (resultado.tipo_id) {
                this.seleccionarTipoForm(resultado.tipo_id);
            }

            if (resultado.nombre_sugerido) {
                const inputNombre = document.getElementById('form-nombre');
                if (inputNombre && !inputNombre.value) {
                    inputNombre.value = resultado.nombre_sugerido;
                }
            }

            const badge = document.getElementById('ia-badge');
            const mensaje = document.getElementById('ia-mensaje');
            if (badge && mensaje) {
                const partes = [];
                if (resultado.tipo_nombre) partes.push(resultado.tipo_nombre);
                if (resultado.nombre_sugerido) partes.push(`"${resultado.nombre_sugerido}"`);
                mensaje.textContent = `Sugerencia: ${partes.join(' · ')}`;
                badge.classList.remove('hidden');
            }
        } catch (error) {
            console.log('Clasificación IA no disponible');
        }
    }

    seleccionarTipoForm(tipoId) {
        document.querySelectorAll('.tipo-form-btn').forEach(btn => {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-slate-100', 'text-slate-600');
        });

        const selected = document.getElementById(`tipo-form-${tipoId}`);
        if (selected) {
            selected.classList.remove('bg-slate-100', 'text-slate-600');
            selected.classList.add('bg-blue-500', 'text-white');
        }

        document.getElementById('form-tipo-id').value = tipoId;
    }

    async guardarProducto(fotoBase64) {
        const nombre = document.getElementById('form-nombre').value.trim();
        const cantidad = parseInt(document.getElementById('form-cantidad').value) || 1;
        const precio = parseFloat(document.getElementById('form-precio').value) || null;
        const codigo = document.getElementById('form-codigo').value;
        const tipoId = document.getElementById('form-tipo-id').value;
        const descripcion = document.getElementById('form-descripcion').value;

        if (!nombre) {
            UIManager.mostrarToast('El nombre es obligatorio', 'warning');
            return;
        }

        if (!tipoId) {
            UIManager.mostrarToast('Selecciona un tipo', 'warning');
            return;
        }

        const producto = {
            nombre,
            cantidad,
            precio_unitario: precio,
            codigo_barras: codigo,
            descripcion,
            tipo_producto_id: tipoId,
            foto_base64: fotoBase64,
            latitud: this.ubicacionActual?.latitud || null,
            longitud: this.ubicacionActual?.longitud || null,
        };

        if (this.estaOnline) {
            await this._guardarEnServidor(producto);
        } else {
            await this._guardarOffline(producto);
        }
    }

    async _guardarEnServidor(producto) {
        try {
            const formData = new FormData();
            Object.entries(producto).forEach(([clave, valor]) => {
                if (valor !== null) formData.append(clave, valor);
            });

            const respuesta = await ApiService.crearProducto(formData);
            this.productos.unshift(respuesta);
            UIManager.mostrarToast('Producto guardado', 'success');
            this.camera.fotoCapturada = null;
            this.ubicacionActual = null;
            this.cambiarVista('inicio');
        } catch (error) {
            console.error('Error guardando en servidor:', error);
            await this._guardarOffline(producto);
        }
    }

    async _guardarOffline(producto) {
        try {
            await this.storage.guardarPendiente(producto);
            await this._actualizarEstadoUI();
            UIManager.mostrarToast('Guardado offline - se sincronizará luego', 'info');
            this.camera.fotoCapturada = null;
            this.ubicacionActual = null;
            this.cambiarVista('inicio');
        } catch (error) {
            console.error('Error guardando offline:', error);
            UIManager.mostrarToast('Error guardando producto', 'error');
        }
    }

    // ====================================================================
    // Tipos de Productos
    // ====================================================================

    abrirModalTipo() {
        this._tipoEditando = null;
        this.iconoActual = '📦';
        UIManager.abrirModal('modal-tipo');
        document.getElementById('nuevo-tipo-nombre').value = '';
        const titulo = document.getElementById('modal-tipo-titulo');
        if (titulo) titulo.textContent = 'Crear nuevo tipo';
        const guardar = document.getElementById('modal-tipo-guardar');
        if (guardar) guardar.textContent = 'Crear';
    }

    async gestionarTipos() {
        try {
            this.tipos = await ApiService.getTipos();
        } catch (error) {
            console.error('Error cargando tipos:', error);
        }

        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="fade-in p-4">
                <div class="flex items-center space-x-3 mb-4">
                    <button onclick="app.cambiarVista('inicio')" class="p-2 -ml-2">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                        </svg>
                    </button>
                    <h2 class="font-bold text-lg">Gestionar tipos</h2>
                </div>
                <div class="space-y-2">
                    ${this.tipos.map(tipo => `
                        <div class="bg-white rounded-xl p-3 shadow-sm flex items-center space-x-3">
                            <div class="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                                style="background:${tipo.color}20">${tipo.icono}</div>
                            <div class="flex-1 min-w-0">
                                <div class="font-medium text-slate-900 text-sm truncate" id="tipo-nombre-${tipo.id}"></div>
                                <div class="text-xs text-slate-500">${tipo.num_productos ?? 0} producto(s)</div>
                            </div>
                            <button onclick="app.editarTipo('${tipo.id}')" class="p-2 text-blue-500" title="Editar">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button onclick="app.eliminarTipo('${tipo.id}')" class="p-2 text-red-400" title="Eliminar">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Nombres vía JS para no romper el HTML con comillas
        this.tipos.forEach(tipo => {
            const el = document.getElementById(`tipo-nombre-${tipo.id}`);
            if (el) el.textContent = tipo.nombre;
        });
    }

    editarTipo(tipoId) {
        const tipo = this.tipos.find(t => t.id === tipoId);
        if (!tipo) return;

        this._tipoEditando = tipoId;
        this.iconoActual = tipo.icono || '📦';
        UIManager.abrirModal('modal-tipo');
        document.getElementById('nuevo-tipo-nombre').value = tipo.nombre;
        const titulo = document.getElementById('modal-tipo-titulo');
        if (titulo) titulo.textContent = 'Editar tipo';
        const guardar = document.getElementById('modal-tipo-guardar');
        if (guardar) guardar.textContent = 'Guardar';
    }

    async eliminarTipo(tipoId) {
        const tipo = this.tipos.find(t => t.id === tipoId);
        if (!tipo) return;
        if (!confirm(`¿Eliminar el tipo "${tipo.nombre}"?`)) return;

        try {
            let resultado = await ApiService.eliminarTipo(tipoId);

            if (resultado.status === 409) {
                const destino = this.tipos.find(t => t.nombre === 'Sin clasificar' && t.id !== tipoId)
                    || this.tipos.find(t => t.id !== tipoId);
                if (!destino) {
                    UIManager.mostrarToast('No hay otro tipo para mover los productos', 'error');
                    return;
                }
                const n = resultado.body.productos;
                if (!confirm(`Tiene ${n} producto(s). ¿Moverlos a "${destino.nombre}" y eliminar el tipo?`)) return;
                resultado = await ApiService.eliminarTipo(tipoId, destino.id);
            }

            if (!resultado.ok) {
                UIManager.mostrarToast(resultado.body.error || 'Error eliminando tipo', 'error');
                return;
            }

            UIManager.mostrarToast('Tipo eliminado', 'success');
            this.filtroActual = {};
            this.tipoSeleccionado = null;
            await this._cargarDatos();
            this.gestionarTipos();
        } catch (error) {
            console.error('Error eliminando tipo:', error);
            UIManager.mostrarToast('Error eliminando tipo', 'error');
        }
    }

    cerrarModalTipo() {
        UIManager.cerrarModal('modal-tipo');
    }

    seleccionarIcono(boton, icono) {
        document.querySelectorAll('.icon-btn').forEach(btn => {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-slate-100');
        });

        boton.classList.remove('bg-slate-100');
        boton.classList.add('bg-blue-500', 'text-white');

        this.iconoActual = icono;
    }

    async guardarNuevoTipo() {
        const nombre = document.getElementById('nuevo-tipo-nombre').value.trim();
        if (!nombre) {
            UIManager.mostrarToast('Escribe un nombre', 'warning');
            return;
        }

        // Modo edición
        if (this._tipoEditando) {
            try {
                const actualizado = await ApiService.actualizarTipo(this._tipoEditando, {
                    nombre,
                    icono: this.iconoActual,
                });
                const idx = this.tipos.findIndex(t => t.id === this._tipoEditando);
                if (idx !== -1) this.tipos[idx] = { ...this.tipos[idx], ...actualizado };
                this._tipoEditando = null;
                this.cerrarModalTipo();
                UIManager.mostrarToast('Tipo actualizado', 'success');
                await this._cargarDatos();
                this.gestionarTipos();
            } catch (error) {
                console.error('Error actualizando tipo:', error);
                UIManager.mostrarToast(error.message || 'Error actualizando tipo', 'error');
            }
            return;
        }

        try {
            const nuevoTipo = await ApiService.crearTipo(nombre, 'Creado desde app', this.iconoActual || '📦');
            this.tipos.push(nuevoTipo);
            this.cerrarModalTipo();
            UIManager.mostrarToast('Tipo creado', 'success');
            this._renderizarVista(this.vistaActual);
        } catch (error) {
            console.error('Error creando tipo:', error);
            UIManager.mostrarToast('Error creando tipo', 'error');
        }
    }

    // ====================================================================
    // Vista de Producto
    // ====================================================================

    async verProducto(productoId) {
        try {
            const producto = await ApiService.getProducto(productoId);
            const container = document.getElementById('main-content');
            const urlFoto = producto.foto_url || producto.foto_thumbnail;

            container.innerHTML = `
                <div class="fade-in">
                    <div class="relative">
                        ${urlFoto
                            ? `<img src="${urlFoto}" alt="" class="w-full h-64 object-cover">`
                            : `<div class="w-full h-64 bg-slate-100 flex items-center justify-center text-6xl">${producto.tipo_icono || CONSTANTS.THUMBNAIL_PLACEHOLDER}</div>`
                        }
                        <button onclick="app.cambiarVista('inicio')" class="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                            </svg>
                        </button>
                    </div>

                    <div class="p-4">
                        <div class="flex items-center space-x-2 mb-2">
                            <span class="px-3 py-1 rounded-full text-xs font-medium" style="background:${producto.tipo_color}20;color:${producto.tipo_color}">
                                ${producto.tipo_icono} ${producto.tipo_nombre}
                            </span>
                        </div>

                        <h1 class="text-2xl font-bold text-slate-900">${producto.nombre}</h1>
                        <p class="text-slate-500 mt-1">${producto.descripcion || 'Sin descripción'}</p>

                        <div class="grid grid-cols-3 gap-4 mt-6">
                            <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                                <div class="text-xl font-bold text-slate-900">${producto.cantidad}</div>
                                <div class="text-xs text-slate-500">Unidades</div>
                            </div>
                            <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                                <div class="text-xl font-bold text-slate-900">${this.monedaSimbolo}${producto.precio_unitario || 0}</div>
                                <div class="text-xs text-slate-500">Precio</div>
                            </div>
                            <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                                <div class="text-xl font-bold text-slate-900">${this.monedaSimbolo}${(producto.cantidad * (producto.precio_unitario || 0)).toFixed(2)}</div>
                                <div class="text-xs text-slate-500">Total</div>
                            </div>
                        </div>

                        ${producto.codigo_barras ? `
                            <div class="mt-4 p-3 bg-slate-100 rounded-xl">
                                <div class="text-xs text-slate-500 mb-1">Código de barras</div>
                                <div class="font-mono text-sm">${producto.codigo_barras}</div>
                            </div>
                        ` : ''}

                        ${producto.latitud && producto.longitud ? `
                            <div class="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                                <div class="text-xs text-blue-500 mb-1">Ubicación de captura</div>
                                <a href="https://www.google.com/maps?q=${producto.latitud},${producto.longitud}" target="_blank" rel="noopener"
                                    class="flex items-center space-x-2 text-blue-700">
                                    <span>📍</span>
                                    <span class="font-mono text-sm">${producto.latitud.toFixed(5)}, ${producto.longitud.toFixed(5)}</span>
                                    <svg class="w-4 h-4 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </a>
                            </div>
                        ` : ''}

                        <button onclick="app.editarProducto('${producto.id}')"
                            class="w-full mt-6 bg-blue-500 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-500/30">
                            ✏️ Editar Producto
                        </button>

                        <button onclick="app.eliminarProducto('${producto.id}')"
                            class="w-full mt-3 bg-red-50 text-red-500 font-semibold py-3 rounded-xl border border-red-200">
                            Eliminar Producto
                        </button>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error obteniendo producto:', error);
            UIManager.mostrarToast('Error cargando producto', 'error');
        }
    }

    // ====================================================================
    // Editar Producto
    // ====================================================================

    async editarProducto(productoId) {
        try {
            const producto = await ApiService.getProducto(productoId);
            const container = document.getElementById('main-content');
            const urlFoto = producto.foto_thumbnail || producto.foto_url;

            container.innerHTML = `
                <div class="fade-in p-4 pb-24">
                    <div class="flex items-center space-x-3 mb-4">
                        <button onclick="app.verProducto('${producto.id}')" class="p-2 -ml-2">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                            </svg>
                        </button>
                        <h2 class="font-bold text-lg">Editar producto</h2>
                    </div>

                    ${urlFoto ? `
                        <div class="bg-white rounded-2xl overflow-hidden mb-4 shadow-sm">
                            <img src="${urlFoto}" class="w-full h-48 object-cover">
                        </div>
                    ` : ''}

                    <form id="product-form" class="space-y-4" onsubmit="return false">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                            <input type="text" id="form-nombre"
                                class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Cantidad</label>
                                <input type="number" id="form-cantidad" min="0"
                                    class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Precio</label>
                                <input type="number" id="form-precio" placeholder="0.00" step="0.01"
                                    class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Código de barras</label>
                            <div class="flex space-x-2">
                                <input type="text" id="form-codigo"
                                    class="flex-1 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <button type="button" onclick="app.escanearCodigo()" title="Escanear código"
                                    class="px-4 rounded-xl bg-slate-900 text-white flex items-center justify-center active:scale-95 transition">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14"/></svg>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Tipo *</label>
                            <div class="flex flex-wrap gap-2">
                                ${this.tipos.map(tipo => `
                                    <button type="button" onclick="app.seleccionarTipoForm('${tipo.id}')"
                                        id="tipo-form-${tipo.id}"
                                        class="tipo-form-btn flex items-center space-x-1 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition">
                                        <span>${tipo.icono}</span><span>${tipo.nombre}</span>
                                    </button>
                                `).join('')}
                            </div>
                            <input type="hidden" id="form-tipo-id">
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                            <textarea id="form-descripcion" rows="2" placeholder="Opcional"
                                class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
                        </div>
                    </form>

                    <button onclick="app.guardarEdicion('${producto.id}')"
                        class="w-full mt-6 bg-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition">
                        Guardar Cambios
                    </button>
                </div>
            `;

            // Precargar valores vía JS (evita romper el HTML con comillas)
            document.getElementById('form-nombre').value = producto.nombre || '';
            document.getElementById('form-cantidad').value = producto.cantidad ?? 1;
            document.getElementById('form-precio').value = producto.precio_unitario ?? '';
            document.getElementById('form-codigo').value = producto.codigo_barras || '';
            document.getElementById('form-descripcion').value = producto.descripcion || '';
            this.seleccionarTipoForm(producto.tipo_producto_id);
        } catch (error) {
            console.error('Error cargando producto para editar:', error);
            UIManager.mostrarToast('Error cargando producto', 'error');
        }
    }

    async guardarEdicion(productoId) {
        const nombre = document.getElementById('form-nombre').value.trim();
        const tipoId = document.getElementById('form-tipo-id').value;

        if (!nombre) {
            UIManager.mostrarToast('El nombre es obligatorio', 'warning');
            return;
        }
        if (!tipoId) {
            UIManager.mostrarToast('Selecciona un tipo', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('nombre', nombre);
        formData.append('cantidad', document.getElementById('form-cantidad').value || '1');
        formData.append('precio_unitario', document.getElementById('form-precio').value);
        formData.append('codigo_barras', document.getElementById('form-codigo').value);
        formData.append('descripcion', document.getElementById('form-descripcion').value);
        formData.append('tipo_producto_id', tipoId);

        try {
            const actualizado = await ApiService.actualizarProducto(productoId, formData);
            const idx = this.productos.findIndex(p => p.id === productoId);
            if (idx !== -1) this.productos[idx] = actualizado;
            UIManager.mostrarToast('Producto actualizado', 'success');
            this.verProducto(productoId);
        } catch (error) {
            console.error('Error actualizando:', error);
            UIManager.mostrarToast('Error actualizando producto', 'error');
        }
    }

    // ====================================================================
    // Eliminar Producto
    // ====================================================================

    async eliminarProducto(productoId) {
        if (!confirm('¿Eliminar este producto?')) return;

        try {
            await ApiService.eliminarProducto(productoId);
            this.productos = this.productos.filter(p => p.id !== productoId);
            UIManager.mostrarToast('Producto eliminado', 'info');

            if (this.vistaActual === 'inicio') {
                this._renderizarVista('inicio');
            } else {
                this._renderizarVista('historial');
            }
        } catch (error) {
            console.error('Error eliminando:', error);
            UIManager.mostrarToast('Error eliminando producto', 'error');
        }
    }

    // ====================================================================
    // Sincronización
    // ====================================================================

    async sincronizarManual() {
        if (!this.estaOnline) {
            UIManager.mostrarToast('Sin conexión', 'warning');
            return;
        }

        await this._sincronizarAutomatico();
    }

    async _sincronizarAutomatico() {
        try {
            const pendientes = await this.sync.obtenerPendientes();
            if (pendientes.length === 0) return;

            UIManager.mostrarToast(`Sincronizando ${pendientes.length} productos...`, 'info');

            const resultado = await this.sync.sincronizar();
            await this._cargarDatos();
            await this._actualizarEstadoUI();

            UIManager.mostrarToast('Sincronización completa', 'success');

            if (this.vistaActual === 'inicio') {
                this._renderizarVista('inicio');
            }
        } catch (error) {
            console.error('Error sincronizando:', error);
            UIManager.mostrarToast('Error en sincronización', 'error');
        }
    }

    // --- Compatibilidad con index.html (onclick en español / nombres antiguos) ---
    nav(vista) {
        this.cambiarVista(vista);
    }

    openCamera() {
        this.abrirCamara();
    }

    closeCamera() {
        this.cerrarCamara(false);
    }

    takePhoto() {
        this.capturarFoto();
    }

    retakePhoto() {
        this.repetirFoto();
    }

    confirmPhoto() {
        this.confirmarFoto();
    }

    syncManual() {
        this.sincronizarManual();
    }

    selectIcon(btn, icono) {
        this.seleccionarIcono(btn, icono);
    }
}

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

const app = new InventarioApp();

document.addEventListener('DOMContentLoaded', () => {
    app.inicializar();

    // Event listeners para iOS compatibility
    setupiOSCompatibility();
});

// Registrar Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('Service Worker no registrado:', error);
    });
}

/**
 * Configura event listeners para mejor compatibilidad en iOS
 */
function setupiOSCompatibility() {
    window.app = app;
    document.addEventListener('touchstart', () => {}, { passive: true, capture: true });
}
