// Programación de mantenimientos preventivos por kilometraje y control del
// odómetro vigente de cada vehículo.
const supabase = require('./supabase.js');
const { traerTodo } = require('./database-supabase.js');

// Mientras no se ejecute supabase-preventivos.sql faltan la columna
// odometro_base y la tabla plan_preventivo. Las pantallas siguen siendo
// utilizables con lo que ya hay, y avisan arriba con modulo_listo.
function faltaEnEsquema(error) {
    const texto = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
    return texto.includes('does not exist') ||
           texto.includes('schema cache') ||
           texto.includes('42p01') ||
           texto.includes('42703');
}

// ============================================================
// ODÓMETRO VIGENTE
// ============================================================

// El odómetro de un vehículo es el mayor entre su carga inicial y el último
// valor registrado en una inspección: así la primera carga no pisa el
// historial ni el historial invalida una corrección manual.
async function obtenerOdometros() {
    let moduloListo = true;

    try {
        // Sin la columna de carga inicial, el odómetro sale solo de inspecciones
        let vehiculos;
        try {
            vehiculos = await traerTodo(() => supabase
                .from('vehiculos')
                .select('id, placa, tipo, marca, modelo, odometro_base, odometro_base_fecha')
                .order('placa', { ascending: true }));
        } catch (error) {
            if (!faltaEnEsquema(error)) throw error;
            moduloListo = false;
            vehiculos = await traerTodo(() => supabase
                .from('vehiculos')
                .select('id, placa, tipo, marca, modelo')
                .order('placa', { ascending: true }));
        }

        const inspecciones = await traerTodo(() => supabase
            .from('inspecciones')
            .select('vehiculo_id, odometro, fecha')
            .not('odometro', 'is', null)
            .order('id', { ascending: false }));

        // Mayor odómetro por vehículo y cuándo se registró
        const porVehiculo = {};
        inspecciones.forEach(i => {
            const km = Number(i.odometro);
            if (!Number.isFinite(km)) return;

            const actual = porVehiculo[i.vehiculo_id];
            if (!actual || km > actual.km) {
                porVehiculo[i.vehiculo_id] = { km, fecha: i.fecha };
            }
        });

        // Las placas de visita no son de la flota: no se les lleva odómetro
        // ni rutinas preventivas. Se filtran por tipo y no por es_visita para
        // no depender de una columna que quizá aún no exista.
        const listado = vehiculos
            .filter(v => v.tipo !== 'visita')
            .map(v => {
                const deInspeccion = porVehiculo[v.id];
                const base = Number.isFinite(Number(v.odometro_base)) && v.odometro_base !== null
                    ? Number(v.odometro_base) : null;
                const inspeccionKm = deInspeccion ? deInspeccion.km : null;

                let odometro = null;
                let origen = 'sin_dato';
                let fecha = null;

                if (base !== null && (inspeccionKm === null || base >= inspeccionKm)) {
                    odometro = base;
                    origen = 'carga_inicial';
                    fecha = v.odometro_base_fecha;
                } else if (inspeccionKm !== null) {
                    odometro = inspeccionKm;
                    origen = 'inspeccion';
                    fecha = deInspeccion.fecha;
                }

                return {
                    id: v.id,
                    placa: v.placa,
                    tipo: v.tipo,
                    marca: v.marca,
                    modelo: v.modelo,
                    odometro_base: base,
                    odometro_inspeccion: inspeccionKm,
                    odometro_actual: odometro,
                    origen,
                    fecha_referencia: fecha
                };
            });

        return { odometros: listado, modulo_listo: moduloListo };

    } catch (error) {
        console.error('Error al obtener odómetros:', error);
        throw error;
    }
}

// Carga inicial: recibe [{ vehiculo_id, odometro }] y guarda solo los que
// traen un valor válido.
async function guardarOdometrosBase(registros) {
    try {
        if (!Array.isArray(registros)) {
            throw new Error('Se esperaba una lista de odómetros');
        }

        const ahora = new Date().toISOString();
        const validos = registros
            .map(r => ({
                id: parseInt(r.vehiculo_id, 10),
                odometro: r.odometro === '' || r.odometro === null || r.odometro === undefined
                    ? null : parseInt(r.odometro, 10)
            }))
            .filter(r => !isNaN(r.id) && (r.odometro === null || Number.isFinite(r.odometro)));

        if (validos.length === 0) {
            return { actualizados: 0, errores: [] };
        }

        const errores = [];
        let actualizados = 0;

        // Se actualiza uno a uno: un upsert masivo sobre vehiculos exigiría
        // enviar el resto de columnas y podría sobrescribir datos del vehículo.
        for (const registro of validos) {
            const { error } = await supabase
                .from('vehiculos')
                .update({
                    odometro_base: registro.odometro,
                    odometro_base_fecha: registro.odometro === null ? null : ahora
                })
                .eq('id', registro.id);

            if (error) {
                errores.push(`Vehículo ${registro.id}: ${error.message}`);
            } else {
                actualizados++;
            }
        }

        return { actualizados, errores };

    } catch (error) {
        console.error('Error al guardar odómetros:', error);
        throw error;
    }
}

// ============================================================
// RUTINAS PREVENTIVAS
// ============================================================

// Estado de una rutina frente al odómetro vigente del vehículo
function evaluarPlan(plan, odometroActual) {
    const intervalo = Number(plan.intervalo_km) || 0;
    const aviso = Number(plan.aviso_km) || 0;

    // Sin servicio previo, el ciclo se cuenta desde el odómetro actual
    const ultimo = plan.ultimo_servicio_km === null || plan.ultimo_servicio_km === undefined
        ? null : Number(plan.ultimo_servicio_km);

    if (odometroActual === null) {
        return {
            proximo_km: ultimo !== null ? ultimo + intervalo : null,
            restante_km: null,
            situacion: 'sin_odometro'
        };
    }

    const base = ultimo !== null ? ultimo : odometroActual;
    const proximo = base + intervalo;
    const restante = proximo - odometroActual;

    let situacion;
    if (restante <= 0) situacion = 'vencido';
    else if (restante <= aviso) situacion = 'por_vencer';
    else situacion = 'al_dia';

    return { proximo_km: proximo, restante_km: restante, situacion };
}

async function obtenerPlanes() {
    try {
        const estadoOdometros = await obtenerOdometros();
        let moduloListo = estadoOdometros.modulo_listo;
        let planes = [];

        try {
            planes = await traerTodo(() => supabase
                .from('plan_preventivo')
                .select(`
                    *,
                    vehiculos:vehiculo_id ( id, placa, tipo, marca, modelo )
                `)
                .order('id', { ascending: true }));
        } catch (error) {
            if (!faltaEnEsquema(error)) throw error;
            moduloListo = false;
        }

        const porVehiculo = new Map(estadoOdometros.odometros.map(o => [o.id, o]));

        const evaluados = planes.map(p => {
            const vehiculo = porVehiculo.get(p.vehiculo_id);
            const odometroActual = vehiculo ? vehiculo.odometro_actual : null;

            return {
                ...p,
                vehiculo_placa: p.vehiculos?.placa || 'Desconocido',
                vehiculo_tipo: p.vehiculos?.tipo || '',
                vehiculo_marca: p.vehiculos?.marca || '',
                vehiculo_modelo: p.vehiculos?.modelo || '',
                odometro_actual: odometroActual,
                ...evaluarPlan(p, odometroActual)
            };
        });

        const activos = evaluados.filter(p => p.activo);

        return {
            planes: evaluados,
            modulo_listo: moduloListo,
            resumen: {
                total: evaluados.length,
                activos: activos.length,
                vencidos: activos.filter(p => p.situacion === 'vencido').length,
                por_vencer: activos.filter(p => p.situacion === 'por_vencer').length,
                al_dia: activos.filter(p => p.situacion === 'al_dia').length,
                sin_odometro: activos.filter(p => p.situacion === 'sin_odometro').length
            }
        };

    } catch (error) {
        console.error('Error al obtener las rutinas preventivas:', error);
        throw error;
    }
}

function limpiarPlan(datos) {
    const fila = {};

    if (datos.vehiculo_id !== undefined) fila.vehiculo_id = parseInt(datos.vehiculo_id, 10);
    if (datos.nombre !== undefined) fila.nombre = String(datos.nombre).trim();
    if (datos.intervalo_km !== undefined) fila.intervalo_km = parseInt(datos.intervalo_km, 10);
    if (datos.aviso_km !== undefined) fila.aviso_km = parseInt(datos.aviso_km, 10) || 0;
    if (datos.activo !== undefined) fila.activo = Boolean(datos.activo);
    if (datos.observaciones !== undefined) fila.observaciones = datos.observaciones || null;

    if (datos.ultimo_servicio_km !== undefined) {
        fila.ultimo_servicio_km = datos.ultimo_servicio_km === '' || datos.ultimo_servicio_km === null
            ? null : parseInt(datos.ultimo_servicio_km, 10);
    }
    if (datos.ultimo_servicio_fecha !== undefined) {
        fila.ultimo_servicio_fecha = datos.ultimo_servicio_fecha || null;
    }

    return fila;
}

async function crearPlan(datos) {
    try {
        const fila = limpiarPlan(datos);

        if (!fila.vehiculo_id || isNaN(fila.vehiculo_id)) throw new Error('Debe indicar el vehículo');
        if (!fila.nombre) throw new Error('Debe indicar el nombre de la rutina');
        if (!fila.intervalo_km || fila.intervalo_km <= 0) throw new Error('El intervalo debe ser mayor que cero');

        const { data, error } = await supabase
            .from('plan_preventivo')
            .insert([fila])
            .select()
            .single();

        if (error) {
            if (String(error.message).includes('idx_plan_vehiculo_nombre')) {
                throw new Error(`Ese vehículo ya tiene una rutina llamada "${fila.nombre}"`);
            }
            throw error;
        }

        return data;

    } catch (error) {
        console.error('Error al crear la rutina preventiva:', error);
        throw error;
    }
}

async function actualizarPlan(id, datos) {
    try {
        const fila = limpiarPlan(datos);
        fila.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('plan_preventivo')
            .update(fila)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('Error al actualizar la rutina preventiva:', error);
        throw error;
    }
}

async function eliminarPlan(id) {
    try {
        const { error } = await supabase
            .from('plan_preventivo')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return { deletedId: id, changes: 1 };

    } catch (error) {
        console.error('Error al eliminar la rutina preventiva:', error);
        throw error;
    }
}

// Aplica una misma rutina a un conjunto de vehículos. Si el vehículo ya la
// tiene, se actualizan sus intervalos en lugar de duplicarla.
async function aplicarPlanEnLote(datos) {
    try {
        const nombre = String(datos.nombre || '').trim();
        const intervalo = parseInt(datos.intervalo_km, 10);
        const aviso = parseInt(datos.aviso_km, 10) || 0;

        if (!nombre) throw new Error('Debe indicar el nombre de la rutina');
        if (!intervalo || intervalo <= 0) throw new Error('El intervalo debe ser mayor que cero');

        // Alcance: todos, por tipo de vehículo o una selección explícita
        const vehiculos = await traerTodo(() => supabase
            .from('vehiculos')
            .select('id, tipo')
            .order('id'));

        let objetivo = vehiculos;

        if (datos.alcance === 'tipo' && datos.tipo) {
            objetivo = vehiculos.filter(v => v.tipo === datos.tipo);
        } else if (datos.alcance === 'seleccion') {
            const ids = (datos.vehiculo_ids || []).map(id => parseInt(id, 10));
            objetivo = vehiculos.filter(v => ids.includes(v.id));
        }

        if (objetivo.length === 0) {
            return { creados: 0, actualizados: 0, errores: ['No hay vehículos en el alcance elegido'] };
        }

        const yaExisten = await traerTodo(() => supabase
            .from('plan_preventivo')
            .select('id, vehiculo_id')
            .eq('nombre', nombre)
            .order('id'));

        const conRutina = new Set(yaExisten.map(p => p.vehiculo_id));

        const nuevos = objetivo
            .filter(v => !conRutina.has(v.id))
            .map(v => ({
                vehiculo_id: v.id,
                nombre,
                intervalo_km: intervalo,
                aviso_km: aviso,
                ultimo_servicio_km: null,
                activo: true
            }));

        let creados = 0;
        if (nuevos.length > 0) {
            const { error } = await supabase.from('plan_preventivo').insert(nuevos);
            if (error) throw error;
            creados = nuevos.length;
        }

        // Los que ya la tenían quedan alineados al nuevo intervalo
        const aActualizar = objetivo.filter(v => conRutina.has(v.id)).map(v => v.id);
        let actualizados = 0;

        if (aActualizar.length > 0) {
            const { error } = await supabase
                .from('plan_preventivo')
                .update({ intervalo_km: intervalo, aviso_km: aviso, updated_at: new Date().toISOString() })
                .eq('nombre', nombre)
                .in('vehiculo_id', aActualizar);

            if (error) throw error;
            actualizados = aActualizar.length;
        }

        return { creados, actualizados, errores: [] };

    } catch (error) {
        console.error('Error al aplicar la rutina en lote:', error);
        throw error;
    }
}

// Registra que la rutina se cumplió a cierto kilometraje: el ciclo avanza
// desde ahí.
async function registrarServicio(planId, datos) {
    try {
        const km = parseInt(datos.odometro, 10);
        if (isNaN(km)) throw new Error('Debe indicar el odómetro del servicio');

        const { data, error } = await supabase
            .from('plan_preventivo')
            .update({
                ultimo_servicio_km: km,
                ultimo_servicio_fecha: datos.fecha || new Date().toISOString().slice(0, 10),
                updated_at: new Date().toISOString()
            })
            .eq('id', planId)
            .select()
            .single();

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('Error al registrar el servicio:', error);
        throw error;
    }
}

module.exports = {
    obtenerOdometros,
    guardarOdometrosBase,
    obtenerPlanes,
    crearPlan,
    actualizarPlan,
    eliminarPlan,
    aplicarPlanEnLote,
    registrarServicio
};
