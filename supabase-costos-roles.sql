-- ============================================================
-- Separación entre información técnica y financiera (Maestranza).
--
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de:
--   supabase-mantenimientos.sql, supabase-preventivos.sql y supabase-usuarios.sql
--
-- Es idempotente: se puede volver a ejecutar sin romper nada.
--
-- Qué trae:
--   1. Rol 'maestranza' para el personal técnico del taller.
--   2. Tres tipos de atención nuevos (siniestro, herramientas, terceros).
--   3. Tiempo de trabajo y fecha de ejecución en vez de inicio/fin.
--   4. Trabajos sin vehículo (herramientas propias y servicios a terceros).
--   5. Presupuesto y validación administrativa de cada servicio.
--   6. Catálogo de plantillas de servicio.
-- ============================================================

-- 0. Comprobación previa ------------------------------------------------------
-- Este guion amplía tablas que deben existir de antes. Si falta alguna, conviene
-- decirlo con claridad en vez de fallar a mitad con un "relation does not exist".
DO $$
BEGIN
    IF to_regclass('public.usuarios') IS NULL THEN
        RAISE EXCEPTION 'Falta la tabla usuarios: ejecuta primero supabase-usuarios.sql';
    END IF;

    IF to_regclass('public.mantenimientos') IS NULL THEN
        RAISE EXCEPTION 'Falta la tabla mantenimientos: ejecuta primero supabase-mantenimientos.sql';
    END IF;
END $$;

-- 1. Rol de maestranza --------------------------------------------------------
-- El técnico registra el trabajo pero no ve ni toca los costos. El filtro real
-- vive en server.js; aquí solo se amplía qué valores acepta la tabla.
DO $$
DECLARE
    nombre_restriccion TEXT;
BEGIN
    FOR nombre_restriccion IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'usuarios'
          AND con.contype = 'c'
          -- PostgreSQL reescribe IN (...) como = ANY (ARRAY[...]), así que se
          -- busca solo el nombre de la columna, como en supabase-documentos.sql
          AND pg_get_constraintdef(con.oid) ILIKE '%rol%'
    LOOP
        EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', nombre_restriccion);
    END LOOP;
END $$;

ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_valido
    CHECK (rol IN ('usuario', 'maestranza', 'admin'));

-- 2. Tipos de atención --------------------------------------------------------
-- A los cuatro originales se suman siniestros, reparación de herramientas y
-- servicios a terceros. Lavado y pintado se conservan: hay órdenes con ese tipo.
DO $$
DECLARE
    nombre_restriccion TEXT;
BEGIN
    FOR nombre_restriccion IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'mantenimientos'
          AND con.contype = 'c'
          -- Entre los CHECK de esta tabla (tipo, estado, prioridad) solo el de
          -- tipo menciona 'preventivo': sirve para reconocerlo sin ambigüedad
          AND pg_get_constraintdef(con.oid) ILIKE '%preventivo%'
    LOOP
        EXECUTE format('ALTER TABLE mantenimientos DROP CONSTRAINT %I', nombre_restriccion);
    END LOOP;
END $$;

ALTER TABLE mantenimientos ADD CONSTRAINT mantenimientos_tipo_check
    CHECK (tipo IN ('preventivo', 'correctivo', 'lavado', 'pintado',
                    'siniestro', 'reparacion_herramienta', 'servicio_terceros'));

-- 3. Columnas nuevas ----------------------------------------------------------
-- tiempo_trabajo reemplaza en el formulario a fecha_inicio/fecha_fin: al técnico
-- le resulta más simple anotar cuántas horas tomó el trabajo que dos marcas de
-- fecha y hora. Las dos columnas viejas se conservan para no perder historia.
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS fecha_ejecucion DATE;
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS tiempo_trabajo NUMERIC(6, 2);

-- Herramientas del taller y trabajos a terceros no tienen placa
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS activo_descripcion TEXT;

-- Solo administración escribe estas tres
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS presupuesto NUMERIC(12, 2);
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS validado_por TEXT;
ALTER TABLE mantenimientos ADD COLUMN IF NOT EXISTS validado_en TIMESTAMP WITH TIME ZONE;

-- 4. Trabajos sin vehículo ----------------------------------------------------
-- vehiculo_id deja de ser obligatorio, pero toda orden debe apuntar a algo:
-- o a un vehículo de la flota, o a un activo/cliente descrito a mano.
ALTER TABLE mantenimientos ALTER COLUMN vehiculo_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mantenimientos_objeto_check'
    ) THEN
        ALTER TABLE mantenimientos
            ADD CONSTRAINT mantenimientos_objeto_check
            CHECK (vehiculo_id IS NOT NULL
                   OR NULLIF(btrim(activo_descripcion), '') IS NOT NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_fecha_ejecucion
    ON mantenimientos(fecha_ejecucion);

-- 5. Traspaso de los datos ya cargados ----------------------------------------
-- Las órdenes existentes conservan su cronología: la fecha de ejecución sale de
-- lo que ya estaba registrado y las horas se calculan del inicio y el fin.
UPDATE mantenimientos
SET fecha_ejecucion = COALESCE(fecha_inicio::date, fecha_programada)
WHERE fecha_ejecucion IS NULL
  AND (fecha_inicio IS NOT NULL OR fecha_programada IS NOT NULL);

UPDATE mantenimientos
SET tiempo_trabajo = ROUND((EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)) / 3600)::numeric, 2)
WHERE tiempo_trabajo IS NULL
  AND fecha_inicio IS NOT NULL
  AND fecha_fin IS NOT NULL
  AND fecha_fin > fecha_inicio;

-- 6. Plantillas de servicio ---------------------------------------------------
-- Catálogo de las actividades frecuentes. El técnico elige una y el formulario
-- se completa solo; administración lo mantiene desde la pantalla de admin.
-- insumos_sugeridos guarda una lista de {descripcion, cantidad, unidad}: nunca
-- costos, porque el catálogo lo consulta también el perfil de maestranza.
CREATE TABLE IF NOT EXISTS catalogo_servicios (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT,
    descripcion_sugerida TEXT,
    insumos_sugeridos JSONB NOT NULL DEFAULT '[]'::jsonb,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_servicios_nombre_unico
    ON catalogo_servicios (lower(nombre));

-- Las plantillas que pidió administración. Se siembran una sola vez.
INSERT INTO catalogo_servicios (nombre, tipo, descripcion_sugerida, insumos_sugeridos)
VALUES
    ('Mantenimiento preventivo', 'preventivo',
     'Rutina preventiva según kilometraje: revisión general de niveles, frenos y luces.',
     '[]'::jsonb),
    ('Mantenimiento correctivo', 'correctivo',
     'Reparación de la falla reportada.',
     '[]'::jsonb),
    ('Cambio de aceite', 'preventivo',
     'Cambio de aceite de motor y filtro de aceite.',
     '[{"descripcion": "Aceite de motor", "cantidad": 4, "unidad": "lt"},
        {"descripcion": "Filtro de aceite", "cantidad": 1, "unidad": "und"}]'::jsonb),
    ('Cambio de filtros', 'preventivo',
     'Reemplazo de filtros de aire, combustible y habitáculo.',
     '[{"descripcion": "Filtro de aire", "cantidad": 1, "unidad": "und"},
        {"descripcion": "Filtro de combustible", "cantidad": 1, "unidad": "und"}]'::jsonb),
    ('Lubricación', 'preventivo',
     'Engrase de puntos de articulación y revisión de grasa en rodamientos.',
     '[{"descripcion": "Grasa multipropósito", "cantidad": 1, "unidad": "kg"}]'::jsonb),
    ('Ajustes mecánicos', 'correctivo',
     'Ajuste de frenos, embrague, suspensión y elementos de sujeción.',
     '[]'::jsonb),
    ('Otras actividades frecuentes', NULL,
     'Describir el trabajo realizado.',
     '[]'::jsonb)
ON CONFLICT (lower(nombre)) DO NOTHING;

-- 7. Row Level Security -------------------------------------------------------
-- La aplicación entra con la anon key, igual que en las tablas existentes.
-- Si tus tablas actuales tienen RLS activo con políticas abiertas, replica ese
-- criterio aquí descomentando el bloque siguiente.
--
-- ALTER TABLE catalogo_servicios ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "acceso anon catalogo" ON catalogo_servicios
--     FOR ALL TO anon USING (true) WITH CHECK (true);

-- 8. Consultas de apoyo -------------------------------------------------------
--   SELECT usuario, nombre, rol FROM usuarios ORDER BY rol, usuario;
--   SELECT tipo, COUNT(*) FROM mantenimientos GROUP BY tipo ORDER BY 2 DESC;
--   SELECT nombre, tipo, activo FROM catalogo_servicios ORDER BY nombre;
