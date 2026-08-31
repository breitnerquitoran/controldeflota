// Módulo de mantenimientos (maestranza): bandeja de daños, órdenes de
// mantenimiento con insumos, e historial por vehículo.
const supabase = require('./supabase.js');
const { traerTodo, tieneColumnasVisitante } = require('./database-supabase.js');

// Un detalle de inspección cuenta como daño cuando su estado no es
// "Buen estado" ni el marcador vacío que usa el formulario.
const ESTADOS_SIN_DANO = ['buen estado', 'sin estado', ''];

function esDano(estado) {
    return !ESTADOS_SIN_DANO.includes(String(estado || '').trim().toLowerCase());
}

// Mientras no se haya ejecutado supabase-mantenimientos.sql, las tablas del
// módulo no existen. En lectura eso no debe tumbar la pantalla: los daños y
// el historial de inspecciones son útiles por sí solos, así que se devuelve
// el valor por defecto y se avisa arriba con esquemaIncompleto.
function faltaLaTabla(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('does not exist') ||
           texto.includes('schema cache') ||
           texto.includes('42p01');
}

// Columnas que añade supabase-costos-roles.sql. Mientras no se haya ejecutado,
// guardar una orden con ellas devolvería 42703 y la pantalla quedaría inservible:
// se reintenta sin ellas, igual que hace database-supabase.js con los documentos.
const CAMPOS_NUEVOS = [
    'fecha_ejecucion', 'tiempo_trabajo', 'activo_descripcion',
    'presupuesto', 'validado_por', 'validado_en'
];

function faltaLaColumna(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('42703') ||
           (texto.includes('column') && texto.includes('does not exist')) ||
           texto.includes('schema cache');
}

async function conDegradacion(operacion, fila) {
    try {
        return await operacion(fila);
    } catch (error) {
        if (!faltaLaColumna(error)) throw error;

        const filaBasica = { ...fila };
        CAMPOS_NUEVOS.forEach(columna => delete filaBasica[columna]);

        console.warn('Faltan columnas de supabase-costos-roles.sql: se guarda sin ellas');
        return await operacion(filaBasica);
    }
}

// ctx es un marcador por petición: un flag global se quedaría en "incompleto"
// hasta reiniciar el servidor aunque ya se hubiera ejecutado el SQL.
async function opcional(consulta, valorPorDefecto, ctx) {
    try {
        return await consulta();
    } catch (error) {
        if (faltaLaTabla(error)) {
            if (ctx) ctx.incompleto = true;
            return valorPorDefecto;
        }
        throw error;
    }
}

// ============================================================
// BANDEJA DE DAÑOS
// ============================================================

// Devuelve todos los daños levantados en inspecciones, con el vehículo, la
// inspección de origen y su situación en maestranza.
// Nunca pide la columna foto: son data URLs de cientos de KB por fila.
async function obtenerDanos() {
    const ctx = { incompleto: false };

    try {
        const [detalles, inspecciones, conFoto, situaciones] = await Promise.all([
            traerTodo(() => supabase
                .from('detalle_inspeccion')
                .select('id, inspeccion_id, pieza, estado, observaciones')
                .order('id', { ascending: false })),
            traerTodo(() => supabase
                .from('inspecciones')
                .select(`
                    id, fecha, tipo_entrada, odometro, vehiculo_id,
                    vehiculos:vehiculo_id ( id, placa, tipo, marca, modelo ),
                    asesores:asesor_id ( id, nombre )
                `)
                .order('id', { ascending: false })),
            traerTodo(() => supabase
                .from('detalle_inspeccion')
                .select('id')
                .not('foto', 'is', null)
                .order('id')),
            opcional(() => traerTodo(() => supabase
                .from('dano_estado')
                .select('detalle_id, situacion, mantenimiento_id, nota')
                .order('id')), [], ctx)
        ]);

        const porInspeccion = new Map(inspecciones.map(i => [i.id, i]));
        const idsConFoto = new Set(conFoto.map(f => f.id));
        const porDetalle = new Map(situaciones.map(s => [s.detalle_id, s]));

        const danos = detalles
            .filter(d => esDano(d.estado))
            .map(d => {
                const inspeccion = porInspeccion.get(d.inspeccion_id) || {};
                const seguimiento = porDetalle.get(d.id);

                return {
                    detalle_id: d.id,
                    inspeccion_id: d.inspeccion_id,
                    pieza: d.pieza,
                    estado: d.estado,
                    observaciones: d.observaciones,
                    tiene_foto: idsConFoto.has(d.id),
                    fecha: inspeccion.fecha || null,
                    tipo_entrada: inspeccion.tipo_entrada || null,
                    odometro: inspeccion.odometro || null,
                    vehiculo_id: inspeccion.vehiculo_id || null,
                    vehiculo_placa: inspeccion.vehiculos?.placa || 'Desconocido',
                    vehiculo_tipo: inspeccion.vehiculos?.tipo || '',
                    vehiculo_marca: inspeccion.vehiculos?.marca || '',
                    vehiculo_modelo: inspeccion.vehiculos?.modelo || '',
                    asesor_nombre: inspeccion.asesores?.nombre || 'Desconocido',
                    situacion: seguimiento?.situacion || 'pendiente',
                    mantenimiento_id: seguimiento?.mantenimiento_id || null,
                    nota: seguimiento?.nota || ''
                };
            })
            .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

        return { danos, modulo_listo: !ctx.incompleto };

    } catch (error) {
        console.error('Error al obtener daños:', error);
        throw error;
    }
}

// Foto de un daño concreto (se pide solo al abrirla)
async function obtenerFotoDano(detalleId) {
    try {
        const { data, error } = await supabase
            .from('detalle_inspeccion')
            .select('id, pieza, estado, observaciones, foto')
            .eq('id', detalleId)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error al obtener foto del daño:', error);
        throw error;
    }
}

// Crea o actualiza el seguimiento de un daño (hay un registro por detalle)
async function actualizarSituacionDano(detalleId, datos) {
    try {
        const id = parseInt(detalleId, 10);
        if (isNaN(id)) throw new Error(`Identificador de daño inválido: "${detalleId}"`);

        const fila = {
            detalle_id: id,
            situacion: datos.situacion || 'pendiente',
            mantenimiento_id: datos.mantenimiento_id || null,
            nota: datos.nota || null,
            actualizado_en: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('dano_estado')
            .upsert(fila, { onConflict: 'detalle_id' })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error al actualizar situación del daño:', error);
        throw error;
    }
}

// ============================================================
// MANTENIMIENTOS
// ============================================================

const CAMPOS_MANTENIMIENTO = [
    'vehiculo_id', 'tipo', 'estado', 'prioridad', 'fecha_programada',
    'fecha_inicio', 'fecha_fin', 'fecha_ejecucion', 'tiempo_trabajo',
    'odometro', 'responsable', 'taller', 'activo_descripcion',
    'descripcion', 'diagnostico', 'trabajos_realizados', 'observaciones',
    'costo_mano_obra', 'presupuesto', 'validado_por', 'validado_en', 'plan_id'
];

// Cifras y validación: las escribe administración, nunca el taller. Cuando la
// orden llega desde maestranza estos campos se descartan del payload antes de
// tocar la base, así un cliente manipulado tampoco puede alterarlas.
const CAMPOS_SOLO_ADMIN = ['costo_mano_obra', 'presupuesto', 'validado_por', 'validado_en'];

// Deja solo los campos de la tabla y normaliza vacíos a null: PostgreSQL
// rechaza '' en columnas de fecha y numéricas.
function limpiarCampos(datos, { sinFinanzas = false } = {}) {
    const fila = {};

    const permitidos = sinFinanzas
        ? CAMPOS_MANTENIMIENTO.filter(campo => !CAMPOS_SOLO_ADMIN.includes(campo))
        : CAMPOS_MANTENIMIENTO;

    permitidos.forEach(campo => {
        if (datos[campo] === undefined) return;
        const valor = datos[campo];
        fila[campo] = (valor === '' || valor === null) ? null : valor;
    });

    if (fila.vehiculo_id != null) fila.vehiculo_id = parseInt(fila.vehiculo_id, 10);
    if (fila.odometro != null) fila.odometro = parseInt(fila.odometro, 10) || null;

    // costo_mano_obra es NOT NULL: un campo vacío vale cero, no nulo.
    // El presupuesto sí admite nulo, que es distinto de un presupuesto de cero.
    if ('costo_mano_obra' in fila) fila.costo_mano_obra = parseFloat(fila.costo_mano_obra) || 0;
    if (fila.presupuesto != null) fila.presupuesto = parseFloat(fila.presupuesto) || 0;
    if (fila.tiempo_trabajo != null) fila.tiempo_trabajo = parseFloat(fila.tiempo_trabajo) || null;
    if (fila.plan_id != null) fila.plan_id = parseInt(fila.plan_id, 10) || null;

    // Una orden apunta a un vehículo de la flota o a un activo descrito a mano
    if (fila.activo_descripcion != null) {
        fila.activo_descripcion = String(fila.activo_descripcion).trim() || null;
    }

    return fila;
}

// Toda orden necesita un objeto de trabajo: placa de la flota o, para las
// herramientas del taller y los servicios a terceros, una descripción libre.
function exigirObjetoDeTrabajo(datos) {
    const tieneVehiculo = datos.vehiculo_id !== undefined &&
        datos.vehiculo_id !== null && datos.vehiculo_id !== '';
    const tieneActivo = String(datos.activo_descripcion || '').trim() !== '';

    if (!tieneVehiculo && !tieneActivo) {
        throw new Error('Debe indicar el vehículo o describir el activo o cliente atendido');
    }

    return tieneVehiculo;
}

// Al cerrar una orden nacida de una rutina preventiva, esa rutina avanza a
// su siguiente ciclo desde el kilometraje en que se hizo el trabajo.
async function avanzarRutina(mantenimientoId) {
    try {
        const { data: orden } = await supabase
            .from('mantenimientos')
            .select('plan_id, odometro, fecha_ejecucion, fecha_fin')
            .eq('id', mantenimientoId)
            .single();

        if (!orden || !orden.plan_id || orden.odometro == null) return;

        // La rutina avanza desde el día en que se hizo el trabajo. Antes ese dato
        // era fecha_fin; ahora el formulario registra la fecha de ejecución, y
        // las órdenes antiguas siguen valiéndose de la que ya tenían.
        const diaDelServicio = orden.fecha_ejecucion || orden.fecha_fin || new Date().toISOString();

        await supabase
            .from('plan_preventivo')
            .update({
                ultimo_servicio_km: orden.odometro,
                ultimo_servicio_fecha: String(diaDelServicio).slice(0, 10),
                updated_at: new Date().toISOString()
            })
            .eq('id', orden.plan_id);

    } catch (error) {
        // La orden ya se guardó; que la rutina no avance no debe tumbar la operación
        console.error('No se pudo avanzar la rutina preventiva:', error.message);
    }
}

function normalizarInsumos(insumos, mantenimientoId) {
    if (!Array.isArray(insumos)) return [];

    return insumos
        .filter(i => i && String(i.descripcion || '').trim() !== '')
        .map(i => ({
            // El id viaja de ida y vuelta para poder casar cada línea con la
            // guardada y no perder su costo al reeditar la orden.
            id: parseInt(i.id, 10) || null,
            mantenimiento_id: mantenimientoId,
            descripcion: String(i.descripcion).trim(),
            cantidad: parseFloat(i.cantidad) || 0,
            unidad: String(i.unidad || 'und').trim(),
            costo_unitario: parseFloat(i.costo_unitario) || 0
        }));
}

// Guarda las líneas de insumo conservando lo que ya estaba valorizado.
//
// Antes se borraba todo y se volvía a insertar; con dos perfiles eso significa
// que cada vez que un técnico corrigiera una descripción se perderían los
// costos que administración había cargado. Ahora las líneas se casan por id:
// se actualizan las que siguen, se insertan las nuevas y se borran las que el
// usuario quitó. Con sinFinanzas el costo entrante se ignora y prevalece el
// guardado (0 en las líneas nuevas, a la espera de que administración valorice).
async function guardarInsumos(mantenimientoId, insumos, { sinFinanzas = false } = {}) {
    const id = parseInt(mantenimientoId, 10);
    const entrantes = normalizarInsumos(insumos, id);

    const { data: guardados, error: errorLectura } = await supabase
        .from('mantenimiento_insumos')
        .select('id, costo_unitario')
        .eq('mantenimiento_id', id);

    if (errorLectura) throw new Error(`Error al leer los insumos: ${errorLectura.message}`);

    const costoPorId = (guardados || []).reduce((acc, linea) => {
        acc[linea.id] = Number(linea.costo_unitario) || 0;
        return acc;
    }, {});

    // Un id que no pertenece a esta orden se trata como línea nueva: así nadie
    // puede arrastrar insumos de otra orden pasando su id en la petición.
    const existentes = [];
    const nuevos = [];

    entrantes.forEach(linea => {
        const esDeEstaOrden = linea.id != null && costoPorId[linea.id] !== undefined;

        if (esDeEstaOrden) {
            existentes.push({
                ...linea,
                costo_unitario: sinFinanzas ? costoPorId[linea.id] : linea.costo_unitario
            });
        } else {
            const { id: descartado, ...sinId } = linea;
            nuevos.push({ ...sinId, costo_unitario: sinFinanzas ? 0 : linea.costo_unitario });
        }
    });

    if (existentes.length > 0) {
        const { error } = await supabase.from('mantenimiento_insumos').upsert(existentes);
        if (error) throw new Error(`Error al actualizar los insumos: ${error.message}`);
    }

    const idsVigentes = existentes.map(linea => linea.id);

    if (nuevos.length > 0) {
        const { data, error } = await supabase
            .from('mantenimiento_insumos')
            .insert(nuevos)
            .select('id');

        if (error) throw new Error(`Error al guardar los insumos: ${error.message}`);
        (data || []).forEach(linea => idsVigentes.push(linea.id));
    }

    // Lo que el usuario quitó de la tabla desaparece
    let borrado = supabase.from('mantenimiento_insumos').delete().eq('mantenimiento_id', id);

    if (idsVigentes.length > 0) {
        borrado = borrado.not('id', 'in', `(${idsVigentes.join(',')})`);
    }

    const { error: errorBorrado } = await borrado;
    if (errorBorrado) throw new Error(`Error al quitar los insumos: ${errorBorrado.message}`);
}

function calcularTotales(mantenimiento, insumos) {
    const totalInsumos = (insumos || []).reduce(
        (suma, i) => suma + (Number(i.cantidad) || 0) * (Number(i.costo_unitario) || 0), 0
    );
    const manoObra = Number(mantenimiento.costo_mano_obra) || 0;

    return {
        total_insumos: Math.round(totalInsumos * 100) / 100,
        costo_mano_obra: manoObra,
        costo_total: Math.round((totalInsumos + manoObra) * 100) / 100
    };
}

async function obtenerMantenimientos() {
    const ctx = { incompleto: false };

    try {
        const [mantenimientos, insumos] = await Promise.all([
            opcional(() => traerTodo(() => supabase
                .from('mantenimientos')
                .select(`
                    *,
                    vehiculos:vehiculo_id ( id, placa, tipo, marca, modelo )
                `)
                .order('id', { ascending: false })), [], ctx),
            opcional(() => traerTodo(() => supabase
                .from('mantenimiento_insumos')
                .select('mantenimiento_id, cantidad, costo_unitario')
                .order('id')), [], ctx)
        ]);

        // Los totales se calculan aquí y no se guardan: así no pueden quedar
        // desfasados respecto a las líneas de insumos.
        const porMantenimiento = insumos.reduce((acc, i) => {
            (acc[i.mantenimiento_id] = acc[i.mantenimiento_id] || []).push(i);
            return acc;
        }, {});

        return {
            mantenimientos: mantenimientos.map(m => ({
                ...m,
                // Las herramientas del taller y los trabajos a terceros no
                // tienen placa: en su lugar se muestra el activo atendido.
                vehiculo_placa: m.vehiculos?.placa || m.activo_descripcion || 'Sin asignar',
                vehiculo_tipo: m.vehiculos?.tipo || '',
                vehiculo_marca: m.vehiculos?.marca || '',
                vehiculo_modelo: m.vehiculos?.modelo || '',
                total_items: (porMantenimiento[m.id] || []).length,
                ...calcularTotales(m, porMantenimiento[m.id])
            })),
            modulo_listo: !ctx.incompleto
        };

    } catch (error) {
        console.error('Error al obtener mantenimientos:', error);
        throw error;
    }
}

async function obtenerMantenimiento(id) {
    try {
        const { data: mantenimiento, error } = await supabase
            .from('mantenimientos')
            .select(`
                *,
                vehiculos:vehiculo_id ( id, placa, tipo, marca, modelo )
            `)
            .eq('id', id)
            .single();

        if (error || !mantenimiento) return null;

        const { data: insumos, error: errorInsumos } = await supabase
            .from('mantenimiento_insumos')
            .select('*')
            .eq('mantenimiento_id', id)
            .order('id');

        if (errorInsumos) throw errorInsumos;

        // Daños de inspección vinculados a esta orden
        const { data: danos } = await supabase
            .from('dano_estado')
            .select('detalle_id, situacion')
            .eq('mantenimiento_id', id);

        return {
            ...mantenimiento,
            vehiculo_placa: mantenimiento.vehiculos?.placa ||
                mantenimiento.activo_descripcion || 'Sin asignar',
            vehiculo_marca: mantenimiento.vehiculos?.marca || '',
            vehiculo_modelo: mantenimiento.vehiculos?.modelo || '',
            insumos: insumos || [],
            danos_vinculados: danos || [],
            ...calcularTotales(mantenimiento, insumos)
        };

    } catch (error) {
        console.error('Error al obtener el mantenimiento:', error);
        throw error;
    }
}

async function crearMantenimiento(datos, opciones = {}) {
    try {
        const conVehiculo = exigirObjetoDeTrabajo(datos);
        if (!datos.tipo) throw new Error('Debe indicar el tipo de mantenimiento');

        const fila = limpiarCampos(datos, opciones);

        if (conVehiculo && isNaN(fila.vehiculo_id)) {
            throw new Error(`Vehículo inválido: "${datos.vehiculo_id}"`);
        }

        const creado = await conDegradacion(async (filaAGuardar) => {
            const { data, error } = await supabase
                .from('mantenimientos')
                .insert([filaAGuardar])
                .select()
                .single();

            if (error) throw error;
            return data;
        }, fila);

        if (Array.isArray(datos.insumos) && datos.insumos.length > 0) {
            await guardarInsumos(creado.id, datos.insumos, opciones);
        }

        // Si la orden nace de un daño de inspección, queda vinculada
        if (datos.detalle_id) {
            await actualizarSituacionDano(datos.detalle_id, {
                situacion: 'en_orden',
                mantenimiento_id: creado.id
            });
        }

        return await obtenerMantenimiento(creado.id);

    } catch (error) {
        console.error('Error al crear mantenimiento:', error);
        throw error;
    }
}

async function actualizarMantenimiento(id, datos, opciones = {}) {
    try {
        // Solo se comprueba el objeto de trabajo si la petición lo toca: hay
        // ediciones parciales (cerrar la orden desde la bandeja de daños) que
        // no reenvían el vehículo.
        if (datos.vehiculo_id !== undefined || datos.activo_descripcion !== undefined) {
            exigirObjetoDeTrabajo(datos);
        }

        const fila = limpiarCampos(datos, opciones);
        fila.updated_at = new Date().toISOString();

        await conDegradacion(async (filaAGuardar) => {
            const { error } = await supabase
                .from('mantenimientos')
                .update(filaAGuardar)
                .eq('id', id);

            if (error) throw error;
        }, fila);

        // Las líneas se sincronizan conservando lo ya valorizado
        if (Array.isArray(datos.insumos)) {
            await guardarInsumos(id, datos.insumos, opciones);
        }

        // Al cerrar la orden, los daños que la originaron quedan atendidos
        // y la rutina preventiva que la generó avanza de ciclo.
        if (datos.estado === 'finalizado') {
            await supabase
                .from('dano_estado')
                .update({ situacion: 'atendido', actualizado_en: new Date().toISOString() })
                .eq('mantenimiento_id', id);

            await avanzarRutina(id);
        }

        return await obtenerMantenimiento(id);

    } catch (error) {
        console.error('Error al actualizar mantenimiento:', error);
        throw error;
    }
}

async function eliminarMantenimiento(id) {
    try {
        // Los daños vinculados vuelven a la bandeja como pendientes
        await supabase
            .from('dano_estado')
            .update({ situacion: 'pendiente', mantenimiento_id: null })
            .eq('mantenimiento_id', id);

        // Los insumos caen por ON DELETE CASCADE
        const { error } = await supabase
            .from('mantenimientos')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return { deletedId: id, changes: 1 };

    } catch (error) {
        console.error('Error al eliminar mantenimiento:', error);
        throw error;
    }
}

// ============================================================
// HISTORIAL POR VEHÍCULO
// ============================================================

// Ingresos, salidas y mantenimientos de un vehículo, para el botón
// "Historial" de administración.
async function obtenerHistorialVehiculo(vehiculoId) {
    const ctx = { incompleto: false };

    try {
        const id = parseInt(vehiculoId, 10);
        if (isNaN(id)) throw new Error(`Vehículo inválido: "${vehiculoId}"`);

        const { data: vehiculo, error: errorVehiculo } = await supabase
            .from('vehiculos')
            .select('*')
            .eq('id', id)
            .single();

        if (errorVehiculo || !vehiculo) return null;

        // En los movimientos de visita responde el visitante y no hay asesor
        const conVisitante = await tieneColumnasVisitante();

        const [inspecciones, mantenimientos, insumos] = await Promise.all([
            traerTodo(() => supabase
                .from('inspecciones')
                .select(`
                    id, fecha, tipo_entrada, odometro,
                    ${conVisitante ? 'visitante_nombre,' : ''}
                    asesores:asesor_id ( id, nombre )
                `)
                .eq('vehiculo_id', id)
                .order('fecha', { ascending: false })),
            opcional(() => traerTodo(() => supabase
                .from('mantenimientos')
                .select('*')
                .eq('vehiculo_id', id)
                .order('id', { ascending: false })), [], ctx),
            opcional(() => traerTodo(() => supabase
                .from('mantenimiento_insumos')
                .select('mantenimiento_id, cantidad, costo_unitario')
                .order('id')), [], ctx)
        ]);

        // Conteo de piezas por inspección, sin traer las fotos
        const idsInspeccion = inspecciones.map(i => i.id);
        let piezasPorInspeccion = {};

        if (idsInspeccion.length > 0) {
            const detalles = await traerTodo(() => supabase
                .from('detalle_inspeccion')
                .select('inspeccion_id, estado')
                .in('inspeccion_id', idsInspeccion)
                .order('id'));

            piezasPorInspeccion = detalles.reduce((acc, d) => {
                const registro = acc[d.inspeccion_id] || { total: 0, danos: 0 };
                registro.total++;
                if (esDano(d.estado)) registro.danos++;
                acc[d.inspeccion_id] = registro;
                return acc;
            }, {});
        }

        const insumosPorMantenimiento = insumos.reduce((acc, i) => {
            (acc[i.mantenimiento_id] = acc[i.mantenimiento_id] || []).push(i);
            return acc;
        }, {});

        return {
            vehiculo,
            modulo_listo: !ctx.incompleto,
            inspecciones: inspecciones.map(i => ({
                id: i.id,
                fecha: i.fecha,
                tipo_entrada: i.tipo_entrada,
                odometro: i.odometro,
                asesor_nombre: i.asesores?.nombre || i.visitante_nombre || 'Desconocido',
                total_piezas: piezasPorInspeccion[i.id]?.total || 0,
                total_danos: piezasPorInspeccion[i.id]?.danos || 0
            })),
            mantenimientos: mantenimientos.map(m => ({
                ...m,
                total_items: (insumosPorMantenimiento[m.id] || []).length,
                ...calcularTotales(m, insumosPorMantenimiento[m.id])
            }))
        };

    } catch (error) {
        console.error('Error al obtener el historial del vehículo:', error);
        throw error;
    }
}

module.exports = {
    obtenerDanos,
    obtenerFotoDano,
    actualizarSituacionDano,
    obtenerMantenimientos,
    obtenerMantenimiento,
    crearMantenimiento,
    actualizarMantenimiento,
    eliminarMantenimiento,
    obtenerHistorialVehiculo,

    // Se expone solo para las pruebas del guardado de repuestos
    __pruebas: { guardarInsumos, limpiarCampos, exigirObjetoDeTrabajo }
};
