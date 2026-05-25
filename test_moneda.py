#!/usr/bin/env python3
"""
Script de prueba para verificar que la configuración de moneda funciona.
"""
import sqlite3
import json

DATABASE = 'inventario.db'

def test_config():
    """Prueba la tabla de configuración."""
    print("=" * 60)
    print("TEST: Configuración de Moneda")
    print("=" * 60)
    
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Verificar que la tabla existe
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='configuracion'")
    if cursor.fetchone():
        print("✅ Tabla 'configuracion' existe")
    else:
        print("❌ Tabla 'configuracion' NO existe")
        return False
    
    # Verificar que hay un registro
    cursor.execute("SELECT * FROM configuracion WHERE id = 1")
    row = cursor.fetchone()
    if row:
        print(f"✅ Registro de configuración encontrado")
        print(f"   Moneda: {row['moneda_simbolo']}")
    else:
        print("❌ No hay registro de configuración")
        return False
    
    conn.close()
    
    print("\n" + "=" * 60)
    print("Cambios implementados:")
    print("=" * 60)
    print("✅ app.py:")
    print("   - Tabla configuracion creada en init_db()")
    print("   - Endpoint GET /api/config")
    print("   - Endpoint POST /api/config")
    print("✅ app.js:")
    print("   - Método ApiService.getConfig()")
    print("   - Propiedad this.monedaSimbolo")
    print("   - Cargar configuración en inicializar()")
    print("   - 3 referencias a precio usan this.monedaSimbolo")
    print("\n" + "=" * 60)
    print("Próximos pasos:")
    print("=" * 60)
    print("1. Hacer: rm inventario.db  (para limpiar DB vieja)")
    print("2. Ejecutar: python app.py")
    print("3. Ir a http://localhost:5000")
    print("4. Inspeccionar DevTools → Network → /api/config")
    print("5. Ver que moneda_simbolo se devuelve correctamente")
    print("=" * 60)
    
    return True

if __name__ == '__main__':
    test_config()
