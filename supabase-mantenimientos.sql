-- ============================================================
-- Módulo de Mantenimientos — Maestranza
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- ============================================================

-- 1. Mantenimientos -------------------------------------------------------
-- Preventivo, correctivo, lavado y pintado conviven en la misma tabla:
-- comparten campos y así el listado de maestranza es uno solo, filtrable.
CREATE TABLE IF NOT EXISTS mantenimientos (
    id BIGSERIAL PRIMARY KEY,
    vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,

    tipo TEXT NOT NULL CHECK (tipo IN ('preventivo', 'correctivo', 'lavado', 'pintado')),
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'en_proceso', 'finalizado', 'anulado')),
    prioridad TEXT NOT NULL DEFAULT 'media'
        CHECK (prioridad IN ('baja', 'media', 'alta')),

    -- Programación y ejecución
    fecha_programada DATE,
    fecha_inicio TIMESTAMP WITH TIME ZONE,
    fecha_fin TIMESTAMP WITH TIME ZONE,
    odometro INTEGER,

    -- Responsables
    responsable TEXT,           -- técnico de maestranza a cargo
    taller TEXT,                -- taller interno o proveedor externo

    -- Contenido del trabajo
    descripcion TEXT,           -- qué se va a hacer / motivo
    diagnostico TEXT,           -- hallazgos al revisar
    trabajos_realizados TEXT,   -- qué se hizo finalmente
    observaciones TEXT,

    -- Costos (los insumos se suman desde mantenimiento_insumos)
    costo_mano_obra NUMERIC(12, 2) NOT NULL DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mantenimientos_vehiculo ON mantenimientos(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_mantenimientos_estado ON mantenimientos(estado);
CREATE INDEX IF NOT EXISTS idx_mantenimientos_tipo ON mantenimientos(tipo);

-- 2. Insumos utilizados ---------------------------------------------------
CREATE TABLE IF NOT EXISTS mantenimiento_insumos (
    id BIGSERIAL PRIMARY KEY,
    mantenimiento_id BIGINT NOT NULL REFERENCES mantenimientos(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    cantidad NUMERIC(12, 2) NOT NULL DEFAULT 1,
    unidad TEXT NOT NULL DEFAULT 'und',
    costo_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insumos_mantenimiento ON mantenimiento_insumos(mantenimiento_id);

-- 3. Situación de cada daño detectado en inspección -----------------------
-- detalle_inspeccion no se modifica: el seguimiento vive aparte, así una
-- inspección editada no arrastra ni pierde el estado de maestranza.
CREATE TABLE IF NOT EXISTS dano_estado (
    id BIGSERIAL PRIMARY KEY,
    detalle_id BIGINT NOT NULL UNIQUE REFERENCES detalle_inspeccion(id) ON DELETE CASCADE,
    situacion TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (situacion IN ('pendiente', 'en_orden', 'atendido', 'descartado')),
    mantenimiento_id BIGINT REFERENCES mantenimientos(id) ON DELETE SET NULL,
    nota TEXT,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dano_estado_situacion ON dano_estado(situacion);

-- 4. Row Level Security ---------------------------------------------------
-- La aplicación entra con la anon key, igual que con las tablas existentes.
-- Si tus tablas actuales tienen RLS activo con políticas abiertas, replica
-- ese mismo criterio aquí descomentando el bloque siguiente.
--
-- ALTER TABLE mantenimientos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mantenimiento_insumos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE dano_estado ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "acceso anon mantenimientos" ON mantenimientos
--     FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "acceso anon insumos" ON mantenimiento_insumos
--     FOR ALL TO anon USING (true) WITH CHECK (true);
-- CREATE POLICY "acceso anon dano_estado" ON dano_estado
--     FOR ALL TO anon USING (true) WITH CHECK (true);
