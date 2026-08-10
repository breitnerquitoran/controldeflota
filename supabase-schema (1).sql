-- Script SQL para crear las tablas en Supabase
-- Ejecuta este script en el SQL Editor de tu panel de Supabase

-- 1. Crear tabla vehiculos con campo tipo
CREATE TABLE IF NOT EXISTS vehiculos (
    id BIGSERIAL PRIMARY KEY,
    placa TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL CHECK (tipo IN ('auto', 'moto')),
    marca TEXT NOT NULL,
    modelo TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Crear tabla asesores
CREATE TABLE IF NOT EXISTS asesores (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Crear tabla inspecciones
CREATE TABLE IF NOT EXISTS inspecciones (
    id BIGSERIAL PRIMARY KEY,
    fecha TEXT NOT NULL,
    vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    asesor_id BIGINT NOT NULL REFERENCES asesores(id) ON DELETE CASCADE,
    tipo_entrada TEXT NOT NULL,
    odometro INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Crear tabla detalle_inspeccion
CREATE TABLE IF NOT EXISTS detalle_inspeccion (
    id BIGSERIAL PRIMARY KEY,
    inspeccion_id BIGINT NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
    pieza TEXT NOT NULL,
    estado TEXT NOT NULL,
    observaciones TEXT,
    foto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Insertar datos de ejemplo en vehiculos (incluyendo autos y motos)
INSERT INTO vehiculos (placa, tipo, marca, modelo) VALUES
('ABC123', 'auto', 'Toyota', 'Corolla'),
('XYZ789', 'auto', 'Honda', 'Civic'),
('DEF456', 'moto', 'Yamaha', 'YZF R1'),
('GHI789', 'auto', 'Nissan', 'Sentra'),
('JKL012', 'moto', 'Honda', 'CBR 600RR'),
('MNO345', 'auto', 'Chevrolet', 'Spark'),
('PQR678', 'moto', 'Kawasaki', 'Ninja 300')
ON CONFLICT (placa) DO NOTHING;

-- 6. Insertar datos de ejemplo en asesores
INSERT INTO asesores (nombre, email) VALUES
('Carlos Rodríguez', 'carlos@ejemplo.com'),
('María González', 'maria@ejemplo.com'),
('Juan Pérez', 'juan@ejemplo.com'),
('Ana López', 'ana@ejemplo.com')
ON CONFLICT (nombre) DO NOTHING;

-- 7. Habilitar Row Level Security (RLS) - Opcional pero recomendado
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE asesores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_inspeccion ENABLE ROW LEVEL SECURITY;

-- 8. Crear políticas básicas para permitir todas las operaciones (ajusta según tus necesidades)
CREATE POLICY "Allow all operations on vehiculos" ON vehiculos FOR ALL USING (true);
CREATE POLICY "Allow all operations on asesores" ON asesores FOR ALL USING (true);
CREATE POLICY "Allow all operations on inspecciones" ON inspecciones FOR ALL USING (true);
CREATE POLICY "Allow all operations on detalle_inspeccion" ON detalle_inspeccion FOR ALL USING (true);