// Catálogo de plantillas de servicio: las actividades frecuentes del taller
// (cambio de aceite, filtros, lubricación, ajustes…). El técnico elige una y el
// formulario de maestranza se completa solo. La tabla la crea
// supabase-costos-roles.sql; administración la mantiene desde admin.html.
const supabase = require('./supabase.js');

// Mientras no se haya ejecutado el SQL la tabla no existe. En lectura eso no
// debe tumbar la pantalla: se devuelve una lista vacía y se avisa arriba, igual
// que hace el módulo de mantenimientos con sus propias tablas.
function faltaLaTabla(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('does not exist') ||
           texto.includes('schema cache') ||
           texto.includes('42p01');
}

// Los insumos sugeridos son solo descripción, cantidad y unidad: el catálogo lo
// consulta también maestranza, así que nunca lleva costos.
function normalizarSugeridos(insumos) {
    if (!Array.isArray(insumos)) return [];

    return insumos
        .filter(i => i && String(i.descripcion || '').trim() !== '')
        .map(i => ({
            descripcion: String(i.descripcion).trim(),
            cantidad: parseFloat(i.cantidad) || 1,
            unidad: String(i.unidad || 'und').trim()
        }));
}

function limpiarPlantilla(datos) {
    const fila = {};

    if (datos.nombre !== undefined) {
        const nombre = String(datos.nombre).trim();
        if (!nombre) throw new Error('El nombre de la plantilla es obligatorio');
        fila.nombre = nombre;
    }

    if (datos.tipo !== undefined) {
        fila.tipo = String(datos.tipo).trim() || null;
    }

    if (datos.descripcion_sugerida !== undefined) {
        fila.descripcion_sugerida = String(datos.descripcion_sugerida).trim() || null;
    }

    if (datos.insumos_sugeridos !== undefined) {
        fila.insumos_sugeridos = normalizarSugeridos(datos.insumos_sugeridos);
    }

    if (datos.activo !== undefined) {
        fila.activo = Boolean(datos.activo);
    }

    return fila;
}

// soloActivas: lo que se ofrece en el formulario de maestranza. Administración
// ve también las plantillas dadas de baja para poder reactivarlas.
async function obtenerPlantillas({ soloActivas = false } = {}) {
    try {
        let consulta = supabase.from('catalogo_servicios').select('*').order('nombre');

        if (soloActivas) consulta = consulta.eq('activo', true);

        const { data, error } = await consulta;
        if (error) throw error;

        return { plantillas: data || [], modulo_listo: true };

    } catch (error) {
        if (faltaLaTabla(error)) return { plantillas: [], modulo_listo: false };

        console.error('Error al obtener las plantillas de servicio:', error);
        throw error;
    }
}

async function crearPlantilla(datos) {
    const fila = limpiarPlantilla(datos);

    if (!fila.nombre) throw new Error('El nombre de la plantilla es obligatorio');
    if (fila.insumos_sugeridos === undefined) fila.insumos_sugeridos = [];

    const { data, error } = await supabase
        .from('catalogo_servicios')
        .insert([fila])
        .select()
        .single();

    if (error) {
        if (String(error.message || '').includes('duplicate')) {
            throw new Error('Ya existe una plantilla con ese nombre');
        }
        throw new Error(`Error al crear la plantilla: ${error.message}`);
    }

    return data;
}

async function actualizarPlantilla(id, datos) {
    const fila = limpiarPlantilla(datos);

    if (Object.keys(fila).length === 0) {
        throw new Error('No hay cambios que guardar');
    }

    const { data, error } = await supabase
        .from('catalogo_servicios')
        .update(fila)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (String(error.message || '').includes('duplicate')) {
            throw new Error('Ya existe una plantilla con ese nombre');
        }
        throw new Error(`Error al actualizar la plantilla: ${error.message}`);
    }

    if (!data) throw new Error('Plantilla no encontrada');
    return data;
}

async function eliminarPlantilla(id) {
    const { error } = await supabase.from('catalogo_servicios').delete().eq('id', id);

    if (error) throw new Error(`Error al eliminar la plantilla: ${error.message}`);
    return { deletedId: id };
}

module.exports = {
    obtenerPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla
};
