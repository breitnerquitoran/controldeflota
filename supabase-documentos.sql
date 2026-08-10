-- ============================================================
-- Documentos del vehículo, licencias de los asesores y
-- movimientos de mantenimiento / visita.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- 1. Documentos del vehículo ----------------------------------------------
-- Las tres primeras fechas caducan y alimentan el semáforo de vencimientos
-- de administración. La tarjeta de propiedad no caduca: se guarda su número
-- y la fecha en que se emitió.
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS poliza_aseguradora TEXT;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS poliza_numero TEXT;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS poliza_renovacion DATE;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS soat_vencimiento DATE;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS revision_tecnica_vencimiento DATE;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS tarjeta_propiedad_numero TEXT;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS tarjeta_propiedad_emision DATE;

-- 2. Licencias de conducir del asesor --------------------------------------
-- Se guardan por separado porque un asesor puede estar habilitado para auto,
-- para moto o para ambos, y cada licencia vence en su propia fecha.
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_auto_numero TEXT;
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_auto_categoria TEXT;
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_auto_vencimiento DATE;
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_moto_numero TEXT;
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_moto_categoria TEXT;
ALTER TABLE asesores ADD COLUMN IF NOT EXISTS licencia_moto_vencimiento DATE;

-- 3. Tipos de vehículo ------------------------------------------------------
-- El esquema original solo admitía 'auto' y 'moto'. Administración ya ofrece
-- camión y otro, y los movimientos de visita dan de alta placas ajenas a la
-- flota con tipo 'visita'. Se reemplaza el CHECK sin conocer su nombre.
DO $$
DECLARE
    nombre_restriccion TEXT;
BEGIN
    FOR nombre_restriccion IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'vehiculos'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%tipo%'
    LOOP
        EXECUTE format('ALTER TABLE vehiculos DROP CONSTRAINT %I', nombre_restriccion);
    END LOOP;
END $$;

ALTER TABLE vehiculos ADD CONSTRAINT vehiculos_tipo_check
    CHECK (tipo IN ('auto', 'moto', 'camion', 'otro', 'visita'));

-- 4. Marca de vehículo ajeno a la flota ------------------------------------
-- Las placas creadas desde un movimiento de visita quedan marcadas para poder
-- excluirlas de odómetros, rutinas preventivas y reportes de flota propia.
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS es_visita BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vehiculos_es_visita ON vehiculos(es_visita);

-- 5. Tipos de movimiento ----------------------------------------------------
-- inspecciones.tipo_entrada pasa de 'entrada'/'salida' a seis valores. No
-- lleva CHECK en el esquema original y se deja así para no romper datos
-- históricos; los valores válidos que escribe la aplicación son:
--   entrada, salida,
--   entrada_mantenimiento, salida_mantenimiento,
--   entrada_visita, salida_visita
-- Los cuatro últimos se registran desde la pantalla inicial y no pasan por
-- el formulario de inspección: no llevan detalle de daños ni EPP.
