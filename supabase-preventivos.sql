-- ============================================================
-- Programación de mantenimientos preventivos por kilometraje
-- Ejecutar en el SQL Editor de Supabase, después de
-- supabase-mantenimientos.sql. Es idempotente.
-- ============================================================

-- 1. Odómetro base del vehículo ------------------------------------------
-- Carga inicial: el kilometraje real con el que arranca cada vehículo en el
-- sistema. El odómetro vigente es el mayor entre este valor y el último
-- registrado en una inspección, así la primera carga nunca pisa el historial.
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS odometro_base INTEGER;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS odometro_base_fecha TIMESTAMP WITH TIME ZONE;

-- 2. Rutinas preventivas --------------------------------------------------
-- Un vehículo puede tener varias: aceite cada 5.000, frenos cada 20.000, etc.
CREATE TABLE IF NOT EXISTS plan_preventivo (
    id BIGSERIAL PRIMARY KEY,
    vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,

    nombre TEXT NOT NULL,                    -- "Cambio de aceite"
    intervalo_km INTEGER NOT NULL CHECK (intervalo_km > 0),
    aviso_km INTEGER NOT NULL DEFAULT 500 CHECK (aviso_km >= 0),

    -- Kilometraje y fecha del último servicio hecho de esta rutina
    ultimo_servicio_km INTEGER,
    ultimo_servicio_fecha DATE,

    activo BOOLEAN NOT NULL DEFAULT TRUE,
    observaciones TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Una rutina con el mismo nombre no se duplica en el mismo vehículo:
-- aplicar en lote dos veces actualiza en lugar de crear copias.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_vehiculo_nombre
    ON plan_preventivo(vehiculo_id, nombre);

CREATE INDEX IF NOT EXISTS idx_plan_vehiculo ON plan_preventivo(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_plan_activo ON plan_preventivo(activo);

-- 3. Vínculo entre la orden y la rutina que la origina ---------------------
-- Al finalizar un mantenimiento con plan_id y odómetro, la rutina avanza
-- sola a su siguiente ciclo.
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS plan_id BIGINT
    REFERENCES plan_preventivo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_plan ON mantenimientos(plan_id);
