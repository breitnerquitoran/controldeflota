-- ============================================================
-- Datos del visitante en los movimientos de visita.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- 1. Nombre y documento del visitante ---------------------------------------
-- En una visita no hay asesor de la flota: responde la persona que llega, y
-- se anota con su documento de identidad (DNI, carné de extranjería o
-- pasaporte). Solo se llenan en los movimientos entrada_visita / salida_visita.
ALTER TABLE inspecciones ADD COLUMN IF NOT EXISTS visitante_nombre TEXT;
ALTER TABLE inspecciones ADD COLUMN IF NOT EXISTS visitante_dni TEXT;

-- 2. El asesor deja de ser obligatorio ---------------------------------------
-- Los movimientos de visita se guardan sin asesor_id. El resto de movimientos
-- lo sigue exigiendo desde la aplicación.
ALTER TABLE inspecciones ALTER COLUMN asesor_id DROP NOT NULL;

-- 3. Consulta de apoyo --------------------------------------------------------
-- Movimientos de visita registrados, con quién los hizo:
--   SELECT i.fecha, v.placa, i.tipo_entrada, i.visitante_nombre, i.visitante_dni
--   FROM inspecciones i
--   JOIN vehiculos v ON v.id = i.vehiculo_id
--   WHERE i.tipo_entrada IN ('entrada_visita', 'salida_visita')
--   ORDER BY i.fecha DESC;
