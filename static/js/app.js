/**
 * InventarioFoto - Aplicacion PWA completa
 */

const API_BASE = '';

class InventarioApp {
    constructor() {
        this.currentView = 'inicio';
        this.productos = [];
        this.tipos = [];
        this.tipoSeleccionado = null;
        this.fotoCapturada = null;
        this.stream = null;
        this.iconoSeleccionado = '📦';
        this.db = null;
        this.pendientes = [];
        this.isOnline = navigator.onLine;
        this.init();
    }

    async init() {
        await this.initIndexedDB();
        this.setupEventListeners();
        this.checkOnlineStatus();
        await this.cargarDatos();
        this.renderInicio();
        this.updatePendingCount();
    }

    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('InventarioDB', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { this.db = request.result; resolve(); };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
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
        const tempId = 'temp-' + Date.now();
        producto.temp_id = tempId;
        producto.fecha_creacion = new Date().toISOString();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readwrite');
            const store = tx.objectStore('productos');
            const request = store.put(producto);
            request.onsuccess = () => {
                this.pendientes.push(producto);
                this.updatePendingCount();
                resolve(tempId);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getPendientes() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readonly');
            const store = tx.objectStore('productos');
            const request = store.getAll();
            request.onsuccess = () => {
                this.pendientes = request.result;
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async limpiarPendientes() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('productos', 'readwrite');
            const store = tx.objectStore('productos');
            const request = store.clear();
            request.onsuccess = () => {
                this.pendientes = [];
                this.updatePendingCount();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            document.getElementById('offline-badge').classList.remove('show');
            this.showToast('Conexion restaurada', 'success');
            this.syncAutomatico();
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
            document.getElementById('offline-badge').classList.add('show');
            this.showToast('Modo offline activado', 'warning');
        });
    }

    checkOnlineStatus() {
        if (!this.isOnline) document.getElementById('offline-badge').classList.add('show');
    }

    nav(view) {
        this.currentView = view;
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.view === view;
            btn.classList.toggle('text-blue-500', isActive);
            btn.classList.toggle('text-slate-400', !isActive);
        });
        if (view === 'inicio') this.renderInicio();
        else if (view === 'historial') this.renderHistorial();
    }

    async renderInicio() {
        const stats = await this.fetchData('/api/estadisticas');
        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="fade-in">
                <div class="grid grid-cols-2 gap-4 p-4">
                    <div class="bg-white rounded-2xl p-4 shadow-sm">
                        <div class="text-2xl font-bold text-slate-900">${stats?.total_productos || 0}</div>
                        <div class="text-xs text-slate-500 mt-1">Productos</div>
                    </div>
                    <div class="bg-white rounded-2xl p-4 shadow-sm">
                        <div class="text-2xl font-bold text-slate-900">$${(stats?.valor_total || 0).toLocaleString()}</div>
                        <div class="text-xs text-slate-500 mt-1">Valor total</div>
                    </div>
                </div>
                <div class="px-4 mb-4">
                    <div class="flex justify-between items-center mb-3">
                        <h2 class="font-semibold text-slate-900">Categorias</h2>
                        <button onclick="app.abrirModalTipo()" class="text-blue-500 text-sm font-medium">+ Nuevo</button>
                    </div>
                    <div class="flex space-x-3 overflow-x-auto hide-scrollbar pb-2">
                        <button onclick="app.filtrarTipo(null)" 
                            class="tipo-chip flex-shrink-0 flex items-center space-x-2 px-4 py-2 rounded-full ${!this.tipoSeleccionado ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm'}">
                            <span>📋</span><span class="text-sm font-medium">Todos</span>
                        </button>
                        ${this.tipos.map(t => `
                            <button onclick="app.filtrarTipo('${t.id}')" 
                                class="tipo-chip flex-shrink-0 flex items-center space-x-2 px-4 py-2 rounded-full ${this.tipoSeleccionado === t.id ? 'ring-2 ring-offset-2' : 'bg-white shadow-sm'}"
                                style="${this.tipoSeleccionado === t.id ? `background:${t.color};color:white;--tw-ring-color:${t.color}` : `color:${t.color}`}">
                                <span>${t.icono}</span><span class="text-sm font-medium">${t.nombre}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="px-4">
                    <h2 class="font-semibold text-slate-900 mb-3">Productos recientes</h2>
                    <div class="space-y-3">
                        ${this.productos.slice(0, 10).map(p => this.renderProductCard(p)).join('')}
                    </div>
                    ${this.productos.length === 0 ? `
                        <div class="text-center py-12">
                            <div class="text-4xl mb-3">📸</div>
                            <p class="text-slate-500">No hay productos aun</p>
                            <p class="text-sm text-slate-400 mt-1">Toca el boton de camara para agregar uno</p>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderProductCard(p) {
        return `
            <div class="product-card bg-white rounded-2xl shadow-sm overflow-hidden" onclick="app.verProducto('${p.id}')">
                <div class="flex">
                    <div class="w-24 h-24 flex-shrink-0 bg-slate-100">
                        ${p.foto_thumbnail ? `<img src="${p.foto_thumbnail}" class="w-full h-full object-cover">` :
                            `<div class="w-full h-full flex items-center justify-center text-2xl">${p.tipo_icono || '📦'}</div>`}
                    </div>
                    <div class="flex-1 p-3">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="font-medium text-slate-900 text-sm line-clamp-1">${p.nombre}</h3>
                                <p class="text-xs text-slate-500 mt-0.5">${p.tipo_nombre || 'Sin tipo'}</p>
                            </div>
                            <span class="text-xs font-semibold" style="color:${p.tipo_color || '#64748b'}">${p.cantidad} u.</span>
                        </div>
                        <div class="flex justify-between items-end mt-2">
                            <span class="text-sm font-bold text-slate-900">$${p.precio_unitario || 0}</span>
                            <button onclick="event.stopPropagation(); app.eliminarProducto('${p.id}')" class="text-red-400 p-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderHistorial() {
        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="fade-in p-4">
                <h2 class="font-semibold text-slate-900 mb-4">Historial completo</h2>
                <div class="space-y-3">${this.productos.map(p => this.renderProductCard(p)).join('')}</div>
            </div>
        `;
    }

    async openCamera() {
        const overlay = document.getElementById('camera-overlay');
        const video = document.getElementById('camera-video');
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
            video.srcObject = this.stream;
            overlay.classList.add('active');
            document.getElementById('capture-preview').classList.add('hidden');
            document.getElementById('camera-controls').classList.remove('hidden');
            this.fotoCapturada = null;
        } catch (err) {
            this.showToast('Error accediendo a la camara', 'error');
            console.error(err);
        }
    }

    closeCamera() {
        const overlay = document.getElementById('camera-overlay');
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        overlay.classList.remove('active');
        this.fotoCapturada = null;
    }

    takePhoto() {
        const video = document.getElementById('camera-video');
        const canvas = document.getElementById('camera-canvas');
        const preview = document.getElementById('capture-preview');
        const previewImg = document.getElementById('preview-img');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        this.fotoCapturada = canvas.toDataURL('image/jpeg', 0.85);
        previewImg.src = this.fotoCapturada;
        preview.classList.remove('hidden');
        document.getElementById('camera-controls').classList.add('hidden');
    }

    retakePhoto() {
        document.getElementById('capture-preview').classList.add('hidden');
        document.getElementById('camera-controls').classList.remove('hidden');
        this.fotoCapturada = null;
    }

    confirmPhoto() {
        this.closeCamera();
        this.renderFormularioProducto();
    }

    renderFormularioProducto() {
        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="fade-in p-4 pb-24">
                <div class="flex items-center space-x-3 mb-4">
                    <button onclick="app.nav('inicio')" class="p-2 -ml-2">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                    </button>
                    <h2 class="font-bold text-lg">Nuevo producto</h2>
                </div>
                <div class="bg-white rounded-2xl overflow-hidden mb-4 shadow-sm">
                    <img src="${this.fotoCapturada}" class="w-full h-48 object-cover">
                </div>
                <div class="space-y-4">
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
                        <label class="block text-sm font-medium text-slate-700 mb-1">Codigo de barras</label>
                        <input type="text" id="form-codigo" placeholder="Escanea o escribe"
                            class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Tipo *</label>
                        <div class="flex flex-wrap gap-2">
                            ${this.tipos.map(t => `
                                <button onclick="app.seleccionarTipoForm('${t.id}')" 
                                    id="tipo-form-${t.id}"
                                    class="tipo-form-btn flex items-center space-x-1 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition">
                                    <span>${t.icono}</span><span>${t.nombre}</span>
                                </button>
                            `).join('')}
                            <button onclick="app.abrirModalTipoDesdeForm()" 
                                class="flex items-center space-x-1 px-3 py-2 rounded-lg border-2 border-dashed border-blue-300 text-blue-500 text-sm hover:bg-blue-50 transition">
                                <span>+</span><span>Nuevo tipo</span>
                            </button>
                        </div>
                        <input type="hidden" id="form-tipo-id">
                        <input type="hidden" id="form-nuevo-tipo">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Descripcion</label>
                        <textarea id="form-descripcion" rows="2" placeholder="Opcional"
                            class="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
                    </div>
                </div>
                <button onclick="app.guardarProducto()" 
                    class="w-full mt-6 bg-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-blue-500/30 active:scale-95 transition">
                    Guardar Producto
                </button>
            </div>
        `;
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
        document.getElementById('form-nuevo-tipo').value = '';
    }

    abrirModalTipoDesdeForm() {
        this.abrirModalTipo();
        this.tipoSeleccionadoCallback = (tipo) => {
            this.tipos.push(tipo);
            this.renderFormularioProducto();
            setTimeout(() => this.seleccionarTipoForm(tipo.id), 100);
        };
    }

    async guardarProducto() {
        const nombre = document.getElementById('form-nombre').value.trim();
        const cantidad = parseInt(document.getElementById('form-cantidad').value) || 1;
        const precio = parseFloat(document.getElementById('form-precio').value) || null;
        const codigo = document.getElementById('form-codigo').value;
        const tipoId = document.getElementById('form-tipo-id').value;
        const nuevoTipo = document.getElementById('form-nuevo-tipo').value;
        const descripcion = document.getElementById('form-descripcion').value;

        if (!nombre) { this.showToast('El nombre es obligatorio', 'warning'); return; }
        if (!tipoId && !nuevoTipo) { this.showToast('Selecciona o crea un tipo', 'warning'); return; }

        const producto = {
            nombre, cantidad, precio_unitario: precio,
            codigo_barras: codigo, descripcion,
            tipo_producto_id: tipoId || null,
            nuevo_tipo_nombre: nuevoTipo || null,
            foto_base64: this.fotoCapturada,
            texto_ocr: ''
        };

        if (this.isOnline) {
            try {
                const formData = new FormData();
                Object.keys(producto).forEach(k => { if (producto[k] !== null) formData.append(k, producto[k]); });
                const response = await fetch(`${API_BASE}/api/productos`, { method: 'POST', body: formData });
                if (response.ok) {
                    const data = await response.json();
                    this.productos.unshift(data);
                    this.showToast('Producto guardado', 'success');
                    this.fotoCapturada = null;
                    this.nav('inicio');
                } else { throw new Error('Error servidor'); }
            } catch (e) { await this.guardarOffline(producto); }
        } else { await this.guardarOffline(producto); }
    }

    async guardarOffline(producto) {
        await this.guardarPendiente(producto);
        this.showToast('Guardado offline - se sincronizara luego', 'info');
        this.fotoCapturada = null;
        this.nav('inicio');
    }

    async syncManual() {
        if (!this.isOnline) { this.showToast('Sin conexion', 'warning'); return; }
        await this.syncAutomatico();
    }

    async syncAutomatico() {
        const pendientes = await this.getPendientes();
        if (pendientes.length === 0) return;
        this.showToast(`Sincronizando ${pendientes.length} productos...`, 'info');
        try {
            const response = await fetch(`${API_BASE}/api/sync`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productos: pendientes })
            });
            if (response.ok) {
                await this.limpiarPendientes();
                await this.cargarDatos();
                this.showToast('Sincronizacion completa', 'success');
                if (this.currentView === 'inicio') this.renderInicio();
            }
        } catch (e) { this.showToast('Error en sincronizacion', 'error'); }
    }

    updatePendingCount() {
        const badge = document.getElementById('pending-count');
        if (this.pendientes.length > 0) {
            badge.textContent = this.pendientes.length;
            badge.classList.remove('hidden');
        } else { badge.classList.add('hidden'); }
    }

    abrirModalTipo() {
        document.getElementById('modal-tipo').classList.remove('hidden');
        document.getElementById('nuevo-tipo-nombre').value = '';
        this.iconoSeleccionado = '📦';
        document.querySelectorAll('.icon-btn').forEach(btn => {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-slate-100');
        });
    }

    cerrarModalTipo() { document.getElementById('modal-tipo').classList.add('hidden'); }

    selectIcon(btn, icon) {
        this.iconoSeleccionado = icon;
        document.querySelectorAll('.icon-btn').forEach(b => {
            b.classList.remove('bg-blue-500', 'text-white');
            b.classList.add('bg-slate-100');
        });
        btn.classList.remove('bg-slate-100');
        btn.classList.add('bg-blue-500', 'text-white');
    }

    async guardarNuevoTipo() {
        const nombre = document.getElementById('nuevo-tipo-nombre').value.trim();
        if (!nombre) { this.showToast('Escribe un nombre', 'warning'); return; }
        const tipo = { nombre, descripcion: 'Creado desde app', icono: this.iconoSeleccionado, color: '#3b82f6' };
        try {
            const response = await fetch(`${API_BASE}/api/tipos-producto`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tipo)
            });
            if (response.ok) {
                const nuevoTipo = await response.json();
                this.tipos.push(nuevoTipo);
                this.cerrarModalTipo();
                this.showToast('Tipo creado', 'success');
                if (this.tipoSeleccionadoCallback) {
                    this.tipoSeleccionadoCallback(nuevoTipo);
                    this.tipoSeleccionadoCallback = null;
                } else { this.renderInicio(); }
            }
        } catch (e) { this.showToast('Error creando tipo', 'error'); }
    }

    filtrarTipo(tipoId) {
        this.tipoSeleccionado = tipoId;
        this.cargarProductos();
        this.renderInicio();
    }

    async eliminarProducto(id) {
        if (!confirm('Eliminar este producto?')) return;
        try {
            await fetch(`${API_BASE}/api/productos/${id}`, { method: 'DELETE' });
            this.productos = this.productos.filter(p => p.id !== id);
            this.showToast('Producto eliminado', 'info');
            if (this.currentView === 'inicio') this.renderInicio();
            else this.renderHistorial();
        } catch (e) { this.showToast('Error eliminando', 'error'); }
    }

    verProducto(id) {
        const p = this.productos.find(x => x.id === id);
        if (!p) return;
        const container = document.getElementById('main-content');
        container.innerHTML = `
            <div class="fade-in">
                <div class="relative">
                    ${p.foto_url ? `<img src="${p.foto_url}" class="w-full h-64 object-cover">` :
                        `<div class="w-full h-64 bg-slate-100 flex items-center justify-center text-6xl">${p.tipo_icono || '📦'}</div>`}
                    <button onclick="app.nav('inicio')" class="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                    </button>
                </div>
                <div class="p-4">
                    <div class="flex items-center space-x-2 mb-2">
                        <span class="px-3 py-1 rounded-full text-xs font-medium" style="background:${p.tipo_color}20;color:${p.tipo_color}">
                            ${p.tipo_icono} ${p.tipo_nombre}
                        </span>
                    </div>
                    <h1 class="text-2xl font-bold text-slate-900">${p.nombre}</h1>
                    <p class="text-slate-500 mt-1">${p.descripcion || 'Sin descripcion'}</p>
                    <div class="grid grid-cols-3 gap-4 mt-6">
                        <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                            <div class="text-xl font-bold text-slate-900">${p.cantidad}</div>
                            <div class="text-xs text-slate-500">Unidades</div>
                        </div>
                        <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                            <div class="text-xl font-bold text-slate-900">$${p.precio_unitario || 0}</div>
                            <div class="text-xs text-slate-500">Precio</div>
                        </div>
                        <div class="bg-white rounded-xl p-3 text-center shadow-sm">
                            <div class="text-xl font-bold text-slate-900">$${(p.cantidad * (p.precio_unitario || 0)).toFixed(2)}</div>
                            <div class="text-xs text-slate-500">Total</div>
                        </div>
                    </div>
                    ${p.codigo_barras ? `
                        <div class="mt-4 p-3 bg-slate-100 rounded-xl">
                            <div class="text-xs text-slate-500 mb-1">Codigo de barras</div>
                            <div class="font-mono text-sm">${p.codigo_barras}</div>
                        </div>
                    ` : ''}
                    <button onclick="app.eliminarProducto('${p.id}')" 
                        class="w-full mt-6 bg-red-50 text-red-500 font-semibold py-3 rounded-xl border border-red-200">
                        Eliminar Producto
                    </button>
                </div>
            </div>
        `;
    }

    buscarToggle() {
        const bar = document.getElementById('search-bar');
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) document.getElementById('search-input').focus();
    }

    async buscar(query) {
        if (!query) { await this.cargarProductos(); this.renderInicio(); return; }
        try {
            const response = await fetch(`${API_BASE}/api/productos?q=${encodeURIComponent(query)}`);
            this.productos = await response.json();
            this.renderInicio();
        } catch (e) { console.error(e); }
    }

    async fetchData(endpoint) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`);
            if (response.ok) return await response.json();
        } catch (e) { console.error(`Error fetching ${endpoint}:`, e); }
        return null;
    }

    async cargarDatos() {
        await Promise.all([this.cargarProductos(), this.cargarTipos()]);
    }

    async cargarProductos() {
        const url = this.tipoSeleccionado ? `/api/productos?tipo_id=${this.tipoSeleccionado}` : '/api/productos';
        const data = await this.fetchData(url);
        if (data) this.productos = data;
        return this.productos;
    }

    async cargarTipos() {
        const data = await this.fetchData('/api/tipos-producto');
        if (data) this.tipos = data;
        return this.tipos;
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const iconMap = { success: '✅', error: '❌', warning: '⚠️', info: '💡' };
        document.getElementById('toast-icon').textContent = iconMap[type] || '💡';
        document.getElementById('toast-message').textContent = message;
        toast.classList.remove('-translate-y-20', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
        setTimeout(() => {
            toast.classList.add('-translate-y-20', 'opacity-0');
            toast.classList.remove('translate-y-0', 'opacity-100');
        }, 3000);
    }
}

const app = new InventarioApp();
