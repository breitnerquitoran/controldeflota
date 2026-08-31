// Pruebas de la separación entre información técnica y financiera.
//
// Cubren lo que no se ve a simple vista y cuesta caro si se rompe:
//   - que un técnico no pueda escribir costos, presupuesto ni validación;
//   - que reeditar una orden desde el taller no borre los importes que ya
//     había cargado administración.
//
// No tocan Supabase: la tabla de insumos se sustituye por un doble en memoria.
// Ejecutar con:  npm test
const path = require('path');
const RAIZ = path.join(__dirname, '..');

// ------------------------------------------------------------------
// Doble de la tabla mantenimiento_insumos
// ------------------------------------------------------------------
let tabla = [];
let siguienteId = 100;

function consulta(nombre) {
    if (nombre !== 'mantenimiento_insumos') throw new Error('tabla inesperada: ' + nombre);

    return {
        select: () => ({
            eq: (campo, valor) => Promise.resolve({
                data: tabla
                    .filter(f => f.mantenimiento_id === valor)
                    .map(f => ({ id: f.id, costo_unitario: f.costo_unitario })),
                error: null
            })
        }),
        upsert(filas) {
            filas.forEach(nueva => {
                const i = tabla.findIndex(f => f.id === nueva.id);
                if (i >= 0) tabla[i] = Object.assign({}, tabla[i], nueva);
            });
            return Promise.resolve({ error: null });
        },
        insert(filas) {
            const creadas = filas.map(f => Object.assign({}, f, { id: siguienteId++ }));
            tabla.push.apply(tabla, creadas);
            return {
                select: () => Promise.resolve({
                    data: creadas.map(c => ({ id: c.id })), error: null
                })
            };
        },
        delete() {
            const filtro = { mantenimiento: null, excluidos: [] };
            const api = {
                eq(campo, valor) { filtro.mantenimiento = valor; return api; },
                not(campo, operador, lista) {
                    filtro.excluidos = String(lista).replace(/[()]/g, '').split(',').map(Number);
                    return api;
                },
                then(resolver) {
                    tabla = tabla.filter(f =>
                        f.mantenimiento_id !== filtro.mantenimiento ||
                        filtro.excluidos.indexOf(f.id) !== -1);
                    return Promise.resolve({ error: null }).then(resolver);
                }
            };
            return api;
        }
    };
}

require.cache[require.resolve(path.join(RAIZ, 'supabase.js'))] = {
    id: 'supabase-doble',
    filename: 'supabase-doble',
    loaded: true,
    exports: { from: consulta }
};

const modulo = require(path.join(RAIZ, 'database-mantenimientos.js'));
const guardarInsumos = modulo.__pruebas.guardarInsumos;
const limpiarCampos = modulo.__pruebas.limpiarCampos;
const exigirObjetoDeTrabajo = modulo.__pruebas.exigirObjetoDeTrabajo;

let fallos = 0;

function revisar(condicion, mensaje) {
    console.log((condicion ? '  ok   ' : ' FALLA ') + mensaje);
    if (!condicion) fallos++;
}

async function main() {
    console.log('\nCampos que solo puede escribir administración');

    const delTecnico = limpiarCampos({
        vehiculo_id: '5',
        tipo: 'preventivo',
        tiempo_trabajo: '2.5',
        fecha_ejecucion: '2026-08-30',
        descripcion: 'Cambio de aceite',
        costo_mano_obra: '0',
        presupuesto: '0',
        validado_por: 'Yo mismo',
        validado_en: '2026-08-30T10:00:00Z'
    }, { sinFinanzas: true });

    revisar(!('costo_mano_obra' in delTecnico), 'el técnico no escribe la mano de obra');
    revisar(!('presupuesto' in delTecnico), 'el técnico no escribe el presupuesto');
    revisar(!('validado_por' in delTecnico), 'el técnico no firma la validación');
    revisar(!('validado_en' in delTecnico), 'el técnico no fecha la validación');
    revisar(delTecnico.tiempo_trabajo === 2.5, 'el tiempo de trabajo sí se guarda');
    revisar(delTecnico.fecha_ejecucion === '2026-08-30', 'la fecha de ejecución sí se guarda');

    const deAdmin = limpiarCampos({ costo_mano_obra: '120.50', presupuesto: '400' }, {});
    revisar(deAdmin.costo_mano_obra === 120.5, 'administración sí escribe la mano de obra');
    revisar(deAdmin.presupuesto === 400, 'administración sí escribe el presupuesto');

    // costo_mano_obra es NOT NULL en la base
    revisar(limpiarCampos({ costo_mano_obra: '' }, {}).costo_mano_obra === 0,
        'una mano de obra vacía vale cero, no nulo');

    console.log('\nObjeto de trabajo: vehículo de la flota o activo del taller');

    revisar(exigirObjetoDeTrabajo({ vehiculo_id: 3 }) === true, 'con vehículo es válida');
    revisar(exigirObjetoDeTrabajo({ activo_descripcion: 'Compresor' }) === false,
        'solo con activo es válida');

    try {
        exigirObjetoDeTrabajo({ vehiculo_id: '', activo_descripcion: '  ' });
        revisar(false, 'sin vehículo ni activo se rechaza');
    } catch (error) {
        revisar(true, 'sin vehículo ni activo se rechaza');
    }

    console.log('\nReedición de una orden ya valorizada');

    tabla = [
        { id: 1, mantenimiento_id: 7, descripcion: 'Aceite 15W40', cantidad: 4, unidad: 'lt', costo_unitario: 45 },
        { id: 2, mantenimiento_id: 7, descripcion: 'Filtro de aceite', cantidad: 1, unidad: 'und', costo_unitario: 30 }
    ];

    // El técnico corrige una cantidad, añade un repuesto y quita otro
    await guardarInsumos(7, [
        { id: 1, descripcion: 'Aceite 15W40', cantidad: 5, unidad: 'lt' },
        { descripcion: 'Empaquetadura', cantidad: 2, unidad: 'und' }
    ], { sinFinanzas: true });

    const aceite = tabla.find(f => f.id === 1);
    const nuevo = tabla.find(f => f.descripcion === 'Empaquetadura');

    revisar(!!aceite && aceite.costo_unitario === 45, 'el costo del aceite se conserva');
    revisar(!!aceite && Number(aceite.cantidad) === 5, 'la cantidad corregida se guarda');
    revisar(!tabla.find(f => f.id === 2), 'el repuesto quitado desaparece');
    revisar(!!nuevo && nuevo.costo_unitario === 0, 'el repuesto nuevo nace sin valorizar');

    // Administración valoriza
    await guardarInsumos(7, [
        { id: 1, descripcion: 'Aceite 15W40', cantidad: 5, unidad: 'lt', costo_unitario: 48 },
        { id: nuevo.id, descripcion: 'Empaquetadura', cantidad: 2, unidad: 'und', costo_unitario: 12 }
    ], { sinFinanzas: false });

    revisar(tabla.find(f => f.id === 1).costo_unitario === 48, 'administración sí cambia el costo');
    revisar(tabla.find(f => f.id === nuevo.id).costo_unitario === 12,
        'administración valoriza el repuesto nuevo');

    // Un id de otra orden no debe poder arrastrarse
    tabla.push({ id: 55, mantenimiento_id: 99, descripcion: 'Ajeno', cantidad: 1, unidad: 'und', costo_unitario: 500 });

    await guardarInsumos(7, [
        { id: 1, descripcion: 'Aceite 15W40', cantidad: 5, unidad: 'lt' },
        { id: 55, descripcion: 'Intento de robo', cantidad: 1, unidad: 'und' }
    ], { sinFinanzas: true });

    const ajeno = tabla.find(f => f.id === 55);
    revisar(!!ajeno && ajeno.mantenimiento_id === 99 && ajeno.descripcion === 'Ajeno',
        'un insumo de otra orden no se pisa pasando su id');

    console.log(fallos === 0
        ? '\nTodas las comprobaciones pasaron\n'
        : '\n' + fallos + ' comprobaciones fallidas\n');

    process.exit(fallos === 0 ? 0 : 1);
}

main().catch(error => {
    console.error('Error inesperado en las pruebas:', error);
    process.exit(1);
});
