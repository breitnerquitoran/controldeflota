// Script para configurar las tablas en Supabase
const supabase = require('./supabase.js');

async function crearTablas() {
    console.log('Iniciando configuración de tablas en Supabase...');
    
    try {
        // Crear tabla de vehículos
        console.log('Creando tabla vehiculos...');
        const { error: vehiculosError } = await supabase.rpc('create_vehiculos_table');
        
        // Crear tabla de asesores
        console.log('Creando tabla asesores...');
        const { error: asesoresError } = await supabase.rpc('create_asesores_table');
        
        // Crear tabla de inspecciones
        console.log('Creando tabla inspecciones...');
        const { error: inspeccionesError } = await supabase.rpc('create_inspecciones_table');
        
        // Crear tabla de detalle_inspeccion
        console.log('Creando tabla detalle_inspeccion...');
        const { error: detalleError } = await supabase.rpc('create_detalle_inspeccion_table');
        
        console.log('Tablas creadas. Insertando datos de ejemplo...');
        
        // Insertar datos de ejemplo en vehículos
        const vehiculosEjemplo = [
            { placa: 'ABC123', tipo: 'auto', marca: 'Toyota', modelo: 'Corolla' },
            { placa: 'XYZ789', tipo: 'auto', marca: 'Honda', modelo: 'Civic' },
            { placa: 'DEF456', tipo: 'moto', marca: 'Yamaha', modelo: 'YZF R1' },
            { placa: 'GHI789', tipo: 'auto', marca: 'Nissan', modelo: 'Sentra' },
            { placa: 'JKL012', tipo: 'moto', marca: 'Honda', modelo: 'CBR 600RR' }
        ];
        
        const { error: insertVehiculosError } = await supabase
            .from('vehiculos')
            .insert(vehiculosEjemplo);
        
        if (insertVehiculosError) {
            console.log('Los vehículos de ejemplo ya existen o hubo un error:', insertVehiculosError.message);
        } else {
            console.log('Vehículos de ejemplo insertados correctamente');
        }
        
        // Insertar datos de ejemplo en asesores
        const asesoresEjemplo = [
            { nombre: 'Carlos Rodríguez', email: 'carlos@ejemplo.com' },
            { nombre: 'María González', email: 'maria@ejemplo.com' },
            { nombre: 'Juan Pérez', email: 'juan@ejemplo.com' },
            { nombre: 'Ana López', email: 'ana@ejemplo.com' }
        ];
        
        const { error: insertAsesoresError } = await supabase
            .from('asesores')
            .insert(asesoresEjemplo);
        
        if (insertAsesoresError) {
            console.log('Los asesores de ejemplo ya existen o hubo un error:', insertAsesoresError.message);
        } else {
            console.log('Asesores de ejemplo insertados correctamente');
        }
        
        console.log('✅ Configuración completada exitosamente!');
        console.log('Tu aplicación ahora está usando Supabase con el campo "tipo" para vehículos.');
        
    } catch (error) {
        console.error('❌ Error durante la configuración:', error);
        console.log('\n📋 Instrucciones manuales:');
        console.log('Ve a tu panel de Supabase y ejecuta las siguientes consultas SQL:');
        console.log('\n1. Crear tabla vehiculos:');
        console.log(`
CREATE TABLE IF NOT EXISTS vehiculos (
    id BIGSERIAL PRIMARY KEY,
    placa TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK (tipo IN ('auto', 'moto')),
    marca TEXT NOT NULL,
    modelo TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
        `);
        
        console.log('\n2. Crear tabla asesores:');
        console.log(`
CREATE TABLE IF NOT EXISTS asesores (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
        `);
        
        console.log('\n3. Crear tabla inspecciones:');
        console.log(`
CREATE TABLE IF NOT EXISTS inspecciones (
    id BIGSERIAL PRIMARY KEY,
    fecha TEXT NOT NULL,
    vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    asesor_id BIGINT NOT NULL REFERENCES asesores(id) ON DELETE CASCADE,
    tipo_entrada TEXT NOT NULL,
    odometro INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
        `);
        
        console.log('\n4. Crear tabla detalle_inspeccion:');
        console.log(`
CREATE TABLE IF NOT EXISTS detalle_inspeccion (
    id BIGSERIAL PRIMARY KEY,
    inspeccion_id BIGINT NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
    pieza TEXT NOT NULL,
    estado TEXT NOT NULL,
    observaciones TEXT,
    foto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
        `);
        
        console.log('\n5. Insertar datos de ejemplo:');
        console.log(`
-- Vehículos de ejemplo
INSERT INTO vehiculos (placa, tipo, marca, modelo) VALUES
('ABC123', 'auto', 'Toyota', 'Corolla'),
('XYZ789', 'auto', 'Honda', 'Civic'),
('DEF456', 'moto', 'Yamaha', 'YZF R1'),
('GHI789', 'auto', 'Nissan', 'Sentra'),
('JKL012', 'moto', 'Honda', 'CBR 600RR')
ON CONFLICT (placa) DO NOTHING;

-- Asesores de ejemplo
INSERT INTO asesores (nombre, email) VALUES
('Carlos Rodríguez', 'carlos@ejemplo.com'),
('María González', 'maria@ejemplo.com'),
('Juan Pérez', 'juan@ejemplo.com'),
('Ana López', 'ana@ejemplo.com')
ON CONFLICT (nombre) DO NOTHING;
        `);
    }
}

// Ejecutar la configuración
crearTablas();