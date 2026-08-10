// Configuración y gestión de la base de datos Supabase
const supabase = require('./supabase.js');

// Supabase (PostgREST) devuelve como máximo 1000 filas por petición.
// Este helper pagina la consulta hasta traer todas las filas.
const TAMANO_PAGINA = 1000;

async function traerTodo(construirConsulta) {
    const filas = [];
    let desde = 0;

    while (true) {
        const { data, error } = await construirConsulta()
            .range(desde, desde + TAMANO_PAGINA - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        filas.push(...data);
        if (data.length < TAMANO_PAGINA) break;
        desde += TAMANO_PAGINA;
    }

    return filas;
}

// Mientras no se ejecute supabase-documentos.sql faltan las columnas de
// documentos del vehículo y de licencias del asesor. El alta y la edición
// siguen funcionando con los campos de siempre en lugar de fallar.
function faltaEnEsquema(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('does not exist') ||
           texto.includes('schema cache') ||
           texto.includes('42703');
}

// Columnas opcionales: las añade supabase-documentos.sql
const DOCUMENTOS_VEHICULO = [
    'poliza_aseguradora', 'poliza_numero', 'poliza_renovacion',
    'soat_vencimiento', 'revision_tecnica_vencimiento',
    'tarjeta_propiedad_numero', 'tarjeta_propiedad_emision', 'es_visita'
];

const LICENCIAS_ASESOR = [
    'licencia_auto_numero', 'licencia_auto_categoria', 'licencia_auto_vencimiento',
    'licencia_moto_numero', 'licencia_moto_categoria', 'licencia_moto_vencimiento'
];

// PostgreSQL rechaza '' en columnas DATE: los vacíos viajan como null
function agregarOpcionales(fila, datos, columnas) {
    columnas.forEach(columna => {
        if (datos[columna] === undefined) return;
        const valor = datos[columna];
        fila[columna] = (valor === '' || valor === null) ? null : valor;
    });

    if (fila.es_visita !== undefined && fila.es_visita !== null) {
        fila.es_visita = Boolean(fila.es_visita);
    }

    return fila;
}

// Los movimientos de visita no llevan asesor de la flota: responde la persona
// que llega, con su nombre y su documento. Las columnas las añade
// supabase-visitas.sql; hasta entonces se trabaja sin ellas.
const TIPOS_DE_VISITA = ['entrada_visita', 'salida_visita'];

function esTipoDeVisita(tipo) {
    return TIPOS_DE_VISITA.includes(String(tipo || ''));
}

let soportaVisitante = null;

async function tieneColumnasVisitante() {
    if (soportaVisitante !== null) return soportaVisitante;

    const { error } = await supabase.from('inspecciones').select('visitante_nombre').limit(1);
    soportaVisitante = !(error && faltaEnEsquema(error));

    if (!soportaVisitante) {
        console.warn('Faltan las columnas de visitante: ejecute supabase-visitas.sql en Supabase');
    }

    return soportaVisitante;
}

// Columnas de la inspección junto con el vehículo y el asesor relacionados
function columnasInspeccion(conVisitante) {
    return `
        id,
        fecha,
        tipo_entrada,
        odometro,
        vehiculo_id,
        asesor_id,
        ${conVisitante ? 'visitante_nombre, visitante_dni,' : ''}
        vehiculos:vehiculo_id (
            id,
            placa,
            tipo,
            marca,
            modelo
        ),
        asesores:asesor_id (
            id,
            nombre
        )
    `;
}

// Ejecuta la operación con las columnas opcionales y, si la base todavía no
// las tiene, la repite solo con las de siempre.
async function conDegradacion(operacion, filaCompleta, columnasOpcionales) {
    try {
        return await operacion(filaCompleta);
    } catch (error) {
        if (!faltaEnEsquema(error)) throw error;

        const filaBasica = { ...filaCompleta };
        columnasOpcionales.forEach(columna => delete filaBasica[columna]);
        console.warn('Faltan columnas de supabase-documentos.sql: se guarda sin ellas');
        return await operacion(filaBasica);
    }
}

// Función para obtener todos los vehículos
async function obtenerVehiculos() {
    try {
        return await traerTodo(() =>
            supabase.from('vehiculos').select('*').order('id', { ascending: true })
        );
    } catch (error) {
        console.error('Error al obtener vehículos:', error);
        throw error;
    }
}

// Función para obtener todos los asesores
async function obtenerAsesores() {
    try {
        return await traerTodo(() =>
            supabase.from('asesores').select('*').order('id', { ascending: true })
        );
    } catch (error) {
        console.error('Error al obtener asesores:', error);
        throw error;
    }
}

// Función para agregar un nuevo vehículo
async function agregarVehiculo(vehiculo) {
    try {
        const fila = agregarOpcionales({
            placa: vehiculo.placa,
            tipo: vehiculo.tipo,
            marca: vehiculo.marca,
            modelo: vehiculo.modelo
        }, vehiculo, DOCUMENTOS_VEHICULO);

        return await conDegradacion(async (datos) => {
            const { data, error } = await supabase
                .from('vehiculos')
                .insert([datos])
                .select()
                .single();

            if (error) throw error;
            return data;
        }, fila, DOCUMENTOS_VEHICULO);
    } catch (error) {
        console.error('Error al agregar vehículo:', error);
        throw error;
    }
}

// Función para agregar un nuevo asesor
async function agregarAsesor(asesor) {
    try {
        const fila = agregarOpcionales({
            nombre: asesor.nombre,
            email: asesor.email
        }, asesor, LICENCIAS_ASESOR);

        return await conDegradacion(async (datos) => {
            const { data, error } = await supabase
                .from('asesores')
                .insert([datos])
                .select()
                .single();

            if (error) throw error;
            return data;
        }, fila, LICENCIAS_ASESOR);
    } catch (error) {
        console.error('Error al agregar asesor:', error);
        throw error;
    }
}

// Función para editar un vehículo existente
async function editarVehiculo(id, vehiculo) {
    try {
        const fila = agregarOpcionales({
            placa: vehiculo.placa,
            tipo: vehiculo.tipo,
            marca: vehiculo.marca,
            modelo: vehiculo.modelo
        }, vehiculo, DOCUMENTOS_VEHICULO);

        return await conDegradacion(async (datos) => {
            const { data, error } = await supabase
                .from('vehiculos')
                .update(datos)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return data;
        }, fila, DOCUMENTOS_VEHICULO);
    } catch (error) {
        console.error('Error al editar vehículo:', error);
        throw error;
    }
}

// Función para editar un asesor existente
async function editarAsesor(id, asesor) {
    try {
        const fila = agregarOpcionales({
            nombre: asesor.nombre,
            email: asesor.email
        }, asesor, LICENCIAS_ASESOR);

        return await conDegradacion(async (datos) => {
            const { data, error } = await supabase
                .from('asesores')
                .update(datos)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return data;
        }, fila, LICENCIAS_ASESOR);
    } catch (error) {
        console.error('Error al editar asesor:', error);
        throw error;
    }
}

// Los movimientos de visita traen placas ajenas a la flota. Se reutiliza la
// placa si ya pasó antes y, si no, se da de alta marcada como visita: así el
// movimiento se guarda como cualquier otro y la segunda visita ya la encuentra.
async function buscarOCrearVehiculoVisita(datos) {
    try {
        const placa = String(datos.placa || '').trim().toUpperCase();
        if (!placa) throw new Error('Debe indicar la placa de la visita');

        const { data: existente } = await supabase
            .from('vehiculos')
            .select('*')
            .ilike('placa', placa)
            .maybeSingle();

        if (existente) return existente;

        return await agregarVehiculo({
            placa,
            tipo: datos.tipo || 'visita',
            marca: String(datos.marca || '').trim() || 'Visita',
            modelo: String(datos.modelo || '').trim() || 'Sin especificar',
            es_visita: true
        });

    } catch (error) {
        console.error('Error al registrar el vehículo de visita:', error);
        throw error;
    }
}

// Función para eliminar un vehículo
async function eliminarVehiculo(id) {
    try {
        const { error } = await supabase
            .from('vehiculos')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return { deletedId: id, changes: 1 };
    } catch (error) {
        console.error('Error al eliminar vehículo:', error);
        throw error;
    }
}

// Función para eliminar un asesor
async function eliminarAsesor(id) {
    try {
        const { error } = await supabase
            .from('asesores')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return { deletedId: id, changes: 1 };
    } catch (error) {
        console.error('Error al eliminar asesor:', error);
        throw error;
    }
}

// Función para guardar una inspección completa
async function guardarInspeccion(inspeccion) {
    try {
        console.log('Iniciando guardarInspeccion con datos:', JSON.stringify(inspeccion));

        // Validar que la inspección tenga todos los campos requeridos
        if (!inspeccion) {
            throw new Error('No se proporcionaron datos de inspección');
        }

        if (!inspeccion.fecha) {
            throw new Error('Fecha no proporcionada');
        }

        if (!inspeccion.vehiculo_id && inspeccion.vehiculo_id !== 0) {
            throw new Error('ID de vehículo no proporcionado');
        }

        if (!inspeccion.tipo_entrada) {
            throw new Error('Tipo de entrada no proporcionado');
        }

        // En una visita el responsable es el visitante: se pide su nombre y su
        // documento en lugar del asesor.
        const esVisita = esTipoDeVisita(inspeccion.tipo_entrada);
        const visitanteNombre = String(inspeccion.visitante_nombre || '').trim();
        const visitanteDni = String(inspeccion.visitante_dni || '').trim().toUpperCase();

        if (esVisita) {
            if (!visitanteNombre) {
                throw new Error('Nombre del visitante no proporcionado');
            }

            if (!visitanteDni) {
                throw new Error('DNI del visitante no proporcionado');
            }
        } else if (!inspeccion.asesor_id && inspeccion.asesor_id !== 0) {
            throw new Error('ID de asesor no proporcionado');
        }

        // Verificar que los ID sean números
        const vehiculoId = parseInt(inspeccion.vehiculo_id, 10);
        const asesorId = (inspeccion.asesor_id === null || inspeccion.asesor_id === undefined || inspeccion.asesor_id === '')
            ? null
            : parseInt(inspeccion.asesor_id, 10);

        if (isNaN(vehiculoId)) {
            throw new Error(`ID de vehículo inválido: "${inspeccion.vehiculo_id}"`);
        }

        if (asesorId !== null && isNaN(asesorId)) {
            throw new Error(`ID de asesor inválido: "${inspeccion.asesor_id}"`);
        }

        if (asesorId === null && !esVisita) {
            throw new Error('ID de asesor no proporcionado');
        }

        // Validar que los detalles sean un array
        if (!Array.isArray(inspeccion.detalles)) {
            throw new Error('Los detalles de la inspección deben ser un array');
        }

        // Validar cada detalle
        for (const detalle of inspeccion.detalles) {
            if (!detalle.pieza) {
                throw new Error('Uno de los detalles no tiene pieza especificada');
            }

            if (!detalle.estado) {
                throw new Error('Uno de los detalles no tiene estado especificado');
            }
        }

        // Verificar que el vehículo existe
        const { data: vehiculo, error: vehiculoError } = await supabase
            .from('vehiculos')
            .select('id')
            .eq('id', vehiculoId)
            .single();

        if (vehiculoError || !vehiculo) {
            throw new Error(`El vehículo con ID ${vehiculoId} no existe`);
        }

        // Verificar que el asesor existe (las visitas no llevan asesor)
        if (asesorId !== null) {
            const { data: asesor, error: asesorError } = await supabase
                .from('asesores')
                .select('id')
                .eq('id', asesorId)
                .single();

            if (asesorError || !asesor) {
                throw new Error(`El asesor con ID ${asesorId} no existe`);
            }
        }

        const fila = {
            fecha: inspeccion.fecha,
            vehiculo_id: vehiculoId,
            asesor_id: asesorId,
            tipo_entrada: inspeccion.tipo_entrada,
            odometro: inspeccion.odometro || null
        };

        if (esVisita) {
            if (!await tieneColumnasVisitante()) {
                throw new Error('La base de datos todavía no admite movimientos de visita: ' +
                    'ejecute supabase-visitas.sql en el SQL Editor de Supabase');
            }

            fila.visitante_nombre = visitanteNombre;
            fila.visitante_dni = visitanteDni;
        }

        // Insertar la inspección principal
        const { data: nuevaInspeccion, error: inspeccionError } = await supabase
            .from('inspecciones')
            .insert([fila])
            .select()
            .single();

        if (inspeccionError) {
            throw new Error(`Error al insertar inspección: ${inspeccionError.message}`);
        }

        const inspeccionId = nuevaInspeccion.id;
        console.log('Inspección insertada con ID:', inspeccionId);

        // Insertar los detalles de la inspección
        if (inspeccion.detalles && inspeccion.detalles.length > 0) {
            const detallesParaInsertar = inspeccion.detalles.map(detalle => ({
                inspeccion_id: inspeccionId,
                pieza: detalle.pieza,
                estado: detalle.estado,
                observaciones: detalle.observaciones || '',
                foto: detalle.foto || null
            }));

            const { error: detallesError } = await supabase
                .from('detalle_inspeccion')
                .insert(detallesParaInsertar);

            if (detallesError) {
                throw new Error(`Error al insertar detalles: ${detallesError.message}`);
            }
        }

        console.log('Inspección guardada correctamente');
        return {
            id: inspeccionId,
            ...inspeccion,
            vehiculo_id: vehiculoId,
            asesor_id: asesorId
        };

    } catch (error) {
        console.error('Error en guardarInspeccion:', error);
        throw error;
    }
}

// Función para obtener todas las inspecciones con datos básicos
async function obtenerInspecciones() {
    try {
        console.log('Iniciando obtenerInspecciones');

        // Obtener inspecciones con datos de vehículos y asesores
        const conVisitante = await tieneColumnasVisitante();
        const inspecciones = await traerTodo(() =>
            supabase
                .from('inspecciones')
                .select(columnasInspeccion(conVisitante))
                .order('fecha', { ascending: false })
        );

        if (inspecciones.length === 0) {
            return [];
        }

        // Conteos de piezas y fotos en dos consultas (no una por inspección).
        // Solo se pide la columna inspeccion_id: las fotos son base64 y traerlas sería enorme.
        const [todasLasPiezas, piezasConFoto] = await Promise.all([
            traerTodo(() => supabase.from('detalle_inspeccion').select('inspeccion_id').order('id')),
            traerTodo(() => supabase.from('detalle_inspeccion').select('inspeccion_id').not('foto', 'is', null).order('id'))
        ]);

        const contarPorInspeccion = (filas) => filas.reduce((acc, fila) => {
            acc[fila.inspeccion_id] = (acc[fila.inspeccion_id] || 0) + 1;
            return acc;
        }, {});

        const conteoPiezas = contarPorInspeccion(todasLasPiezas);
        const conteoFotos = contarPorInspeccion(piezasConFoto);

        return inspecciones.map((inspeccion) => ({
            id: inspeccion.id,
            fecha: inspeccion.fecha,
            tipo_entrada: inspeccion.tipo_entrada,
            odometro: inspeccion.odometro,
            vehiculo_id: inspeccion.vehiculo_id,
            vehiculo_placa: inspeccion.vehiculos?.placa || 'Desconocido',
            vehiculo_tipo: inspeccion.vehiculos?.tipo || 'Desconocido',
            vehiculo_marca: inspeccion.vehiculos?.marca || 'Desconocido',
            vehiculo_modelo: inspeccion.vehiculos?.modelo || 'Desconocido',
            asesor_id: inspeccion.asesor_id,
            asesor_nombre: inspeccion.asesores?.nombre || 'Desconocido',
            visitante_nombre: inspeccion.visitante_nombre || null,
            visitante_dni: inspeccion.visitante_dni || null,
            total_piezas: conteoPiezas[inspeccion.id] || 0,
            total_fotos: conteoFotos[inspeccion.id] || 0
        }));

    } catch (error) {
        console.error('Error al obtener inspecciones:', error);
        throw error;
    }
}

// Función para obtener los detalles completos de una inspección
async function obtenerInspeccionDetallada(id) {
    try {
        // Obtener la inspección con datos de vehículo y asesor
        const conVisitante = await tieneColumnasVisitante();
        const { data: inspeccion, error: inspeccionError } = await supabase
            .from('inspecciones')
            .select(columnasInspeccion(conVisitante))
            .eq('id', id)
            .single();

        if (inspeccionError || !inspeccion) {
            return null;
        }

        // Obtener los detalles de la inspección
        const { data: detalles, error: detallesError } = await supabase
            .from('detalle_inspeccion')
            .select('id, pieza, estado, observaciones, foto')
            .eq('inspeccion_id', id);

        if (detallesError) {
            throw detallesError;
        }

        // Formatear la respuesta
        return {
            id: inspeccion.id,
            fecha: inspeccion.fecha,
            tipo_entrada: inspeccion.tipo_entrada,
            odometro: inspeccion.odometro,
            vehiculo_id: inspeccion.vehiculo_id,
            vehiculo_placa: inspeccion.vehiculos?.placa || 'Desconocido',
            vehiculo_tipo: inspeccion.vehiculos?.tipo || 'Desconocido',
            vehiculo_marca: inspeccion.vehiculos?.marca || 'Desconocido',
            vehiculo_modelo: inspeccion.vehiculos?.modelo || 'Desconocido',
            asesor_id: inspeccion.asesor_id,
            asesor_nombre: inspeccion.asesores?.nombre || 'Desconocido',
            visitante_nombre: inspeccion.visitante_nombre || null,
            visitante_dni: inspeccion.visitante_dni || null,
            detalles: detalles || []
        };

    } catch (error) {
        console.error('Error al obtener inspección detallada:', error);
        throw error;
    }
}

// Función para actualizar una inspección existente
async function actualizarInspeccion(id, datosActualizados) {
    try {
        console.log(`Actualizando inspección ${id} con datos:`, datosActualizados);

        // Actualizar solo los campos que llegan en la petición.
        // El formulario de edición del histórico envía únicamente odometro y tipo_entrada:
        // incluir los demás pisaría fecha, vehiculo_id y asesor_id con null.
        const campos = {};
        if (datosActualizados.fecha !== undefined) campos.fecha = datosActualizados.fecha;
        if (datosActualizados.vehiculo_id !== undefined) campos.vehiculo_id = datosActualizados.vehiculo_id;
        if (datosActualizados.asesor_id !== undefined) campos.asesor_id = datosActualizados.asesor_id;
        if (datosActualizados.tipo_entrada !== undefined) campos.tipo_entrada = datosActualizados.tipo_entrada;
        if (datosActualizados.odometro !== undefined) campos.odometro = datosActualizados.odometro || null;

        let inspeccionActualizada = null;

        if (Object.keys(campos).length > 0) {
            const { data, error: inspeccionError } = await supabase
                .from('inspecciones')
                .update(campos)
                .eq('id', id)
                .select()
                .single();

            if (inspeccionError) {
                throw new Error(`Error al actualizar inspección: ${inspeccionError.message}`);
            }

            inspeccionActualizada = data;
        }

        // Si hay detalles para actualizar
        if (datosActualizados.detalles && Array.isArray(datosActualizados.detalles)) {
            // Eliminar detalles existentes
            const { error: deleteError } = await supabase
                .from('detalle_inspeccion')
                .delete()
                .eq('inspeccion_id', id);

            if (deleteError) {
                throw new Error(`Error al eliminar detalles existentes: ${deleteError.message}`);
            }

            // Insertar nuevos detalles
            if (datosActualizados.detalles.length > 0) {
                const detallesParaInsertar = datosActualizados.detalles.map(detalle => ({
                    inspeccion_id: id,
                    pieza: detalle.pieza,
                    estado: detalle.estado,
                    observaciones: detalle.observaciones || '',
                    foto: detalle.foto || null
                }));

                const { error: insertError } = await supabase
                    .from('detalle_inspeccion')
                    .insert(detallesParaInsertar);

                if (insertError) {
                    throw new Error(`Error al insertar nuevos detalles: ${insertError.message}`);
                }
            }
        }

        return inspeccionActualizada || { id, mensaje: 'Inspección actualizada correctamente' };

    } catch (error) {
        console.error('Error al actualizar inspección:', error);
        throw error;
    }
}

// Función para eliminar múltiples inspecciones
async function eliminarInspeccionesMultiples(ids) {
    try {
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new Error('IDs debe ser un array no vacío');
        }

        const errores = [];
        const idsNumericos = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));

        // Comprobar cuáles existen realmente (una sola consulta)
        const { data: existentes, error: checkError } = await supabase
            .from('inspecciones')
            .select('id')
            .in('id', idsNumericos);

        if (checkError) {
            throw new Error(`Error al verificar inspecciones: ${checkError.message}`);
        }

        const idsExistentes = (existentes || []).map(fila => fila.id);
        idsNumericos
            .filter(id => !idsExistentes.includes(id))
            .forEach(id => errores.push(`Inspección con ID ${id} no encontrada`));

        if (idsExistentes.length === 0) {
            return { eliminados: 0, errores };
        }

        // Eliminar detalles y luego las inspecciones (dos consultas en total)
        const { error: deleteDetallesError } = await supabase
            .from('detalle_inspeccion')
            .delete()
            .in('inspeccion_id', idsExistentes);

        if (deleteDetallesError) {
            throw new Error(`Error al eliminar detalles: ${deleteDetallesError.message}`);
        }

        const { error: deleteInspeccionesError } = await supabase
            .from('inspecciones')
            .delete()
            .in('id', idsExistentes);

        if (deleteInspeccionesError) {
            throw new Error(`Error al eliminar inspecciones: ${deleteInspeccionesError.message}`);
        }

        console.log(`Inspecciones eliminadas correctamente: ${idsExistentes.join(', ')}`);

        return { eliminados: idsExistentes.length, errores };

    } catch (error) {
        console.error('Error al eliminar inspecciones múltiples:', error);
        throw error;
    }
}

module.exports = {
    traerTodo,
    tieneColumnasVisitante,
    obtenerVehiculos,
    obtenerAsesores,
    agregarVehiculo,
    agregarAsesor,
    buscarOCrearVehiculoVisita,
    editarVehiculo,
    editarAsesor,
    eliminarVehiculo,
    eliminarAsesor,
    guardarInspeccion,
    obtenerInspecciones,
    obtenerInspeccionDetallada,
    actualizarInspeccion,
    eliminarInspeccionesMultiples
};