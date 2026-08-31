-- ============================================================
-- Usuarios y roles de acceso al sistema de flota.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- 1. Tabla de usuarios --------------------------------------------------------
-- Dos roles: 'usuario' (inspecciones e histórico) y 'admin' (todo, incluida
-- la gestión de usuarios). La clave nunca se guarda en claro: se almacena el
-- resultado de scrypt con sal propia (ver database-usuarios.js).
CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'usuario',
    clave_hash TEXT NOT NULL,
    debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false,
    activo BOOLEAN NOT NULL DEFAULT true,
    ultimo_ingreso TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo se aceptan los dos roles previstos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_valido'
    ) THEN
        ALTER TABLE usuarios
            ADD CONSTRAINT usuarios_rol_valido CHECK (rol IN ('usuario', 'admin'));
    END IF;
END $$;

-- El nombre de usuario se compara siempre en minúsculas desde la aplicación
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_unico ON usuarios (lower(usuario));

-- 2. Administrador inicial ----------------------------------------------------
-- No se siembra desde aquí porque la clave debe pasar por scrypt: la primera
-- vez que alguien abre el login, si la tabla está vacía la aplicación crea el
-- usuario 'admin' con la clave temporal 'admin123' y lo obliga a cambiarla.
-- La clave temporal se puede fijar con la variable de entorno ADMIN_CLAVE_INICIAL.

-- 3. Consultas de apoyo -------------------------------------------------------
--   SELECT usuario, nombre, rol, activo, ultimo_ingreso FROM usuarios ORDER BY usuario;
--
-- Para volver a dejar el sistema sin usuarios (se recrea el admin inicial):
--   DELETE FROM usuarios;
