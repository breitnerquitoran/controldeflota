// Usuarios, claves y sesiones del sistema de flota.
// La tabla la crea supabase-usuarios.sql.
const crypto = require('crypto');
const supabase = require('./supabase.js');

// 'usuario' inspecciona, 'maestranza' atiende el taller sin ver costos y
// 'admin' llega a todo, incluida la información económica.
const ROLES = ['usuario', 'maestranza', 'admin'];
const HORAS_DE_SESION = 12;
const CLAVE_MINIMA = 6;

// Campos que sí pueden viajar al navegador (nunca clave_hash)
const CAMPOS_PUBLICOS = 'id, usuario, nombre, rol, debe_cambiar_clave, activo, ultimo_ingreso, creado_en';

// ============================================================
// Claves: scrypt con sal propia por usuario
// ============================================================

function cifrarClave(clave) {
    const sal = crypto.randomBytes(16);
    const derivada = crypto.scryptSync(String(clave), sal, 64);
    return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

function claveCoincide(clave, guardada) {
    const partes = String(guardada || '').split('$');
    if (partes.length !== 3 || partes[0] !== 'scrypt') return false;

    const sal = Buffer.from(partes[1], 'hex');
    const esperada = Buffer.from(partes[2], 'hex');
    const derivada = crypto.scryptSync(String(clave), sal, esperada.length);

    return crypto.timingSafeEqual(derivada, esperada);
}

function validarClave(clave) {
    if (!clave || String(clave).length < CLAVE_MINIMA) {
        throw new Error(`La clave debe tener al menos ${CLAVE_MINIMA} caracteres`);
    }
    return String(clave);
}

// ============================================================
// Token de sesión: JSON firmado con HMAC, sin dependencias
// ============================================================

// En Vercel conviene definir AUTH_SECRET para que la firma no cambie entre
// despliegues. Si no está, se deriva de la credencial de Supabase.
const SECRETO = process.env.AUTH_SECRET ||
    crypto.createHash('sha256')
        .update(`flota:${process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sin-clave'}`)
        .digest('hex');

function base64url(texto) {
    return Buffer.from(texto, 'utf8').toString('base64url');
}

function firmar(cuerpo) {
    return crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
}

function crearToken(usuario) {
    const datos = {
        id: usuario.id,
        usuario: usuario.usuario,
        nombre: usuario.nombre,
        rol: usuario.rol,
        exp: Date.now() + HORAS_DE_SESION * 60 * 60 * 1000
    };

    const cuerpo = base64url(JSON.stringify(datos));
    return `${cuerpo}.${firmar(cuerpo)}`;
}

// Devuelve los datos del token o null si la firma no cuadra o ya caducó
function verificarToken(token) {
    const [cuerpo, firma] = String(token || '').split('.');
    if (!cuerpo || !firma) return null;

    const esperada = Buffer.from(firmar(cuerpo));
    const recibida = Buffer.from(firma);

    if (esperada.length !== recibida.length) return null;
    if (!crypto.timingSafeEqual(esperada, recibida)) return null;

    try {
        const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
        if (!datos.exp || datos.exp < Date.now()) return null;
        return datos;
    } catch (e) {
        return null;
    }
}

// ============================================================
// Acceso a la tabla
// ============================================================

// Mientras no se ejecute supabase-usuarios.sql la tabla no existe: conviene
// decirlo con todas sus letras en vez de devolver un error de PostgREST.
function faltaLaTabla(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('does not exist') ||
           texto.includes('schema cache') ||
           texto.includes('42p01');
}

function revisar(error) {
    if (!error) return;
    if (faltaLaTabla(error)) {
        throw new Error('Falta la tabla de usuarios: ejecuta supabase-usuarios.sql en el SQL Editor de Supabase');
    }
    throw error;
}

function normalizarUsuario(nombreUsuario) {
    return String(nombreUsuario || '').trim().toLowerCase();
}

async function buscarPorUsuario(nombreUsuario) {
    const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('usuario', normalizarUsuario(nombreUsuario))
        .maybeSingle();

    revisar(error);
    return data || null;
}

async function buscarPorId(id) {
    const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    revisar(error);
    return data || null;
}

// Sistema recién instalado: se crea el administrador de arranque con una clave
// temporal que la aplicación obliga a cambiar en el primer ingreso.
async function asegurarAdminInicial() {
    // Un select normal (no head) es el que devuelve el error cuando la tabla
    // todavía no existe; con head: true PostgREST responde 204 sin detalle.
    const { data: existentes, error } = await supabase
        .from('usuarios')
        .select('id')
        .limit(1);

    revisar(error);
    if (existentes && existentes.length > 0) return null;

    const claveTemporal = process.env.ADMIN_CLAVE_INICIAL || 'admin123';

    const { data, error: errorAlta } = await supabase
        .from('usuarios')
        .insert([{
            usuario: 'admin',
            nombre: 'Administrador',
            rol: 'admin',
            clave_hash: cifrarClave(claveTemporal),
            debe_cambiar_clave: true,
            activo: true
        }])
        .select(CAMPOS_PUBLICOS)
        .single();

    revisar(errorAlta);
    console.log('Usuarios: no había ninguno, se creó el administrador inicial "admin"');
    return data;
}

// ============================================================
// Operaciones
// ============================================================

async function autenticar({ usuario, clave }) {
    await asegurarAdminInicial();

    const fila = await buscarPorUsuario(usuario);

    // Mismo mensaje para usuario inexistente y clave errada: no conviene
    // revelar qué nombres de usuario existen.
    if (!fila || !claveCoincide(clave || '', fila.clave_hash)) {
        const error = new Error('Usuario o clave incorrectos');
        error.estado = 401;
        throw error;
    }

    if (!fila.activo) {
        const error = new Error('Este usuario está desactivado. Contacta al administrador.');
        error.estado = 403;
        throw error;
    }

    await supabase
        .from('usuarios')
        .update({ ultimo_ingreso: new Date().toISOString() })
        .eq('id', fila.id);

    return {
        token: crearToken(fila),
        usuario: {
            id: fila.id,
            usuario: fila.usuario,
            nombre: fila.nombre,
            rol: fila.rol,
            debe_cambiar_clave: fila.debe_cambiar_clave
        }
    };
}

async function obtenerUsuarios() {
    const { data, error } = await supabase
        .from('usuarios')
        .select(CAMPOS_PUBLICOS)
        .order('usuario', { ascending: true });

    revisar(error);
    return data || [];
}

async function crearUsuario({ usuario, nombre, rol, clave }) {
    const nombreUsuario = normalizarUsuario(usuario);

    if (!/^[a-z0-9._-]{3,}$/.test(nombreUsuario)) {
        throw new Error('El usuario debe tener al menos 3 caracteres y solo letras, números, punto, guion o guion bajo');
    }

    if (!String(nombre || '').trim()) {
        throw new Error('El nombre es obligatorio');
    }

    const rolFinal = ROLES.includes(rol) ? rol : 'usuario';
    validarClave(clave);

    if (await buscarPorUsuario(nombreUsuario)) {
        throw new Error(`El usuario "${nombreUsuario}" ya existe`);
    }

    const { data, error } = await supabase
        .from('usuarios')
        .insert([{
            usuario: nombreUsuario,
            nombre: String(nombre).trim(),
            rol: rolFinal,
            clave_hash: cifrarClave(clave),
            debe_cambiar_clave: true,
            activo: true
        }])
        .select(CAMPOS_PUBLICOS)
        .single();

    revisar(error);
    return data;
}

// Datos que el administrador puede tocar de otro usuario
async function actualizarUsuario(id, { nombre, rol, activo }, solicitante) {
    const fila = await buscarPorId(id);
    if (!fila) throw new Error('Usuario no encontrado');

    const cambios = {};

    if (nombre !== undefined) {
        if (!String(nombre).trim()) throw new Error('El nombre es obligatorio');
        cambios.nombre = String(nombre).trim();
    }

    if (rol !== undefined) {
        if (!ROLES.includes(rol)) throw new Error('Rol no válido');
        cambios.rol = rol;
    }

    if (activo !== undefined) {
        cambios.activo = Boolean(activo);
    }

    // Nadie puede quitarse a sí mismo el acceso y dejar el sistema sin dueño
    const seQuitaPermisos = (cambios.rol !== undefined && cambios.rol !== 'admin') ||
                            (cambios.activo === false);

    if (seQuitaPermisos && solicitante && Number(solicitante.id) === Number(fila.id)) {
        throw new Error('No puedes quitarte a ti mismo el rol de administrador ni desactivarte');
    }

    if (seQuitaPermisos && fila.rol === 'admin') {
        await exigirOtroAdmin(fila.id);
    }

    const { data, error } = await supabase
        .from('usuarios')
        .update(cambios)
        .eq('id', id)
        .select(CAMPOS_PUBLICOS)
        .single();

    revisar(error);
    return data;
}

// Evita quedarse sin ningún administrador activo
async function exigirOtroAdmin(idExcluido) {
    const { data, error } = await supabase
        .from('usuarios')
        .select('id')
        .eq('rol', 'admin')
        .eq('activo', true)
        .neq('id', idExcluido);

    revisar(error);

    if (!data || data.length === 0) {
        throw new Error('Debe quedar al menos un administrador activo');
    }
}

async function eliminarUsuario(id, solicitante) {
    const fila = await buscarPorId(id);
    if (!fila) throw new Error('Usuario no encontrado');

    if (solicitante && Number(solicitante.id) === Number(fila.id)) {
        throw new Error('No puedes eliminar tu propio usuario');
    }

    if (fila.rol === 'admin' && fila.activo) {
        await exigirOtroAdmin(fila.id);
    }

    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    revisar(error);

    return { eliminado: true, id: Number(id) };
}

// El administrador asigna una clave nueva; el usuario deberá cambiarla al entrar
async function reiniciarClave(id, clave) {
    validarClave(clave);

    const { data, error } = await supabase
        .from('usuarios')
        .update({ clave_hash: cifrarClave(clave), debe_cambiar_clave: true })
        .eq('id', id)
        .select(CAMPOS_PUBLICOS)
        .single();

    revisar(error);
    return data;
}

// Cambio de clave del propio usuario, con verificación de la clave actual
async function cambiarClavePropia(id, { clave_actual, clave_nueva }) {
    const fila = await buscarPorId(id);
    if (!fila) throw new Error('Usuario no encontrado');

    if (!claveCoincide(clave_actual || '', fila.clave_hash)) {
        const error = new Error('La clave actual no es correcta');
        error.estado = 400;
        throw error;
    }

    validarClave(clave_nueva);

    if (claveCoincide(clave_nueva, fila.clave_hash)) {
        throw new Error('La clave nueva debe ser distinta de la actual');
    }

    const { error } = await supabase
        .from('usuarios')
        .update({ clave_hash: cifrarClave(clave_nueva), debe_cambiar_clave: false })
        .eq('id', id);

    revisar(error);
    return { actualizado: true };
}

module.exports = {
    ROLES,
    crearToken,
    verificarToken,
    asegurarAdminInicial,
    autenticar,
    obtenerUsuarios,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
    reiniciarClave,
    cambiarClavePropia,
    buscarPorId
};
