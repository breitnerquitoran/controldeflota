// Servidor Express para la aplicación de inspección vehicular
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
// Base de datos en Supabase (PostgreSQL).
// Para volver a la base local SQLite, cambia esta línea por: require('./database.js')
const db = require('./database-supabase.js');
// Módulo de maestranza: bandeja de daños, mantenimientos e historial
const mant = require('./database-mantenimientos.js');
// Programación preventiva por kilometraje y odómetros por vehículo
const prev = require('./database-preventivos.js');
// Usuarios, claves y sesiones
const usuarios = require('./database-usuarios.js');
// Plantillas de servicio que ofrece el formulario de maestranza
const catalogo = require('./database-catalogo.js');

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsing de JSON y URL-encoded
app.use(bodyParser.json({ limit: '50mb' })); // Para permitir imágenes grandes
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================
// ACCESO — sesión y permisos por rol
// ============================================================

// Lo que puede hacer cada rol. El rol 'admin' pasa sin filtro.
// Las rutas van sin el prefijo /api porque el middleware se monta en '/api'.
const PERMISOS_USUARIO = [
    { metodo: 'GET', ruta: /^\/test$/ },
    { metodo: 'GET', ruta: /^\/vehiculos(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/asesores(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/inspecciones(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/odometros$/ },
    { metodo: 'POST', ruta: /^\/inspecciones$/ },
    { metodo: 'POST', ruta: /^\/vehiculos\/visita$/ }
];

// Maestranza atiende el taller: daños, órdenes de trabajo y rutinas
// preventivas, más el alta y la corrección de placas. No llega a la gestión de
// usuarios ni a los reportes económicos; lo que sí alcanza viaja además sin
// los importes (ver depurarFinanzas más abajo).
const PERMISOS_MAESTRANZA = [
    { metodo: 'GET', ruta: /^\/test$/ },
    { metodo: 'GET', ruta: /^\/vehiculos(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/vehiculos\/\d+\/historial$/ },
    { metodo: 'POST', ruta: /^\/vehiculos$/ },
    { metodo: 'PUT', ruta: /^\/vehiculos\/\d+$/ },
    { metodo: 'GET', ruta: /^\/asesores(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/inspecciones(\/\d+)?$/ },
    { metodo: 'GET', ruta: /^\/danos$/ },
    { metodo: 'GET', ruta: /^\/danos\/\d+\/foto$/ },
    { metodo: 'PUT', ruta: /^\/danos\/\d+$/ },
    { metodo: 'GET', ruta: /^\/mantenimientos(\/\d+)?$/ },
    { metodo: 'POST', ruta: /^\/mantenimientos$/ },
    { metodo: 'PUT', ruta: /^\/mantenimientos\/\d+$/ },
    { metodo: 'GET', ruta: /^\/catalogo-servicios$/ },
    { metodo: 'GET', ruta: /^\/odometros$/ },
    { metodo: 'PUT', ruta: /^\/odometros$/ },
    { metodo: 'GET', ruta: /^\/preventivos$/ },
    { metodo: 'POST', ruta: /^\/preventivos$/ },
    { metodo: 'PUT', ruta: /^\/preventivos\/\d+$/ },
    { metodo: 'POST', ruta: /^\/preventivos\/lote$/ },
    { metodo: 'POST', ruta: /^\/preventivos\/\d+\/servicio$/ }
];

const PERMISOS_POR_ROL = {
    usuario: PERMISOS_USUARIO,
    maestranza: PERMISOS_MAESTRANZA
};

function leerToken(req) {
    const cabecera = req.headers.authorization || '';
    if (cabecera.toLowerCase().startsWith('bearer ')) {
        return cabecera.slice(7).trim();
    }
    return req.query.token || '';
}

app.use('/api', (req, res, next) => {
    // El login es la única puerta abierta
    if (req.path === '/auth/login') return next();

    const sesion = usuarios.verificarToken(leerToken(req));

    if (!sesion) {
        return res.status(401).json({ error: 'Sesión no válida o expirada' });
    }

    req.sesion = sesion;

    // El administrador llega a todo; el resto solo a lo suyo y a su propia cuenta
    if (sesion.rol === 'admin' || req.path.startsWith('/auth/')) return next();

    const permisos = PERMISOS_POR_ROL[sesion.rol] || [];

    const permitido = permisos.some(
        regla => regla.metodo === req.method && regla.ruta.test(req.path)
    );

    if (!permitido) {
        return res.status(403).json({ error: 'No tienes permiso para esta operación' });
    }

    next();
});

// ============================================================
// Separación entre lo técnico y lo financiero
// ============================================================
// Los importes son responsabilidad de administración. Maestranza registra el
// trabajo, pero los costos no salen del servidor hacia su pantalla: esconderlos
// solo con CSS dejaría la cifra a un clic en las herramientas del navegador.

const CAMPOS_FINANCIEROS = ['costo_mano_obra', 'total_insumos', 'costo_total', 'presupuesto'];

function sinImportes(orden) {
    if (!orden || typeof orden !== 'object') return orden;

    const copia = { ...orden };
    CAMPOS_FINANCIEROS.forEach(campo => delete copia[campo]);

    if (Array.isArray(copia.insumos)) {
        copia.insumos = copia.insumos.map(insumo => {
            const { costo_unitario, ...resto } = insumo;
            return resto;
        });
    }

    return copia;
}

// Solo administración ve y escribe cifras; el resto trabaja sin ellas.
function esAdministracion(req) {
    return !!req.sesion && req.sesion.rol === 'admin';
}

// Traduce los errores de la capa de usuarios al código HTTP que les toca
function responderError(res, error, mensaje) {
    console.error(mensaje, error);
    res.status(error.estado || 400).json({ error: error.message || 'No se pudo completar la operación' });
}

// Iniciar sesión
app.post('/api/auth/login', async (req, res) => {
    try {
        const sesion = await usuarios.autenticar(req.body);
        res.json(sesion);
    } catch (error) {
        responderError(res, error, 'Error al iniciar sesión:');
    }
});

// Datos frescos del usuario de la sesión (el navegador los revalida al cargar)
app.get('/api/auth/me', async (req, res) => {
    try {
        const fila = await usuarios.buscarPorId(req.sesion.id);

        if (!fila || !fila.activo) {
            return res.status(401).json({ error: 'La sesión ya no es válida' });
        }

        // El rol viaja firmado dentro del token y este dura 12 horas: si
        // administración lo cambió, el permiso viejo seguiría valiendo hasta que
        // caduque. Se corta la sesión para que la persona vuelva a entrar y
        // reciba un token con su rol actual.
        if (fila.rol !== req.sesion.rol) {
            return res.status(401).json({ error: 'Tu rol cambió: vuelve a iniciar sesión' });
        }

        res.json({
            id: fila.id,
            usuario: fila.usuario,
            nombre: fila.nombre,
            rol: fila.rol,
            debe_cambiar_clave: fila.debe_cambiar_clave
        });
    } catch (error) {
        responderError(res, error, 'Error al leer la sesión:');
    }
});

// Cambio de clave del propio usuario
app.post('/api/auth/cambiar-clave', async (req, res) => {
    try {
        const resultado = await usuarios.cambiarClavePropia(req.sesion.id, req.body);
        res.json(resultado);
    } catch (error) {
        responderError(res, error, 'Error al cambiar la clave:');
    }
});

// ============================================================
// USUARIOS — solo administración
// ============================================================

app.get('/api/usuarios', async (req, res) => {
    try {
        res.json(await usuarios.obtenerUsuarios());
    } catch (error) {
        responderError(res, error, 'Error al obtener usuarios:');
    }
});

app.post('/api/usuarios', async (req, res) => {
    try {
        const creado = await usuarios.crearUsuario(req.body);
        res.status(201).json(creado);
    } catch (error) {
        responderError(res, error, 'Error al crear usuario:');
    }
});

app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const actualizado = await usuarios.actualizarUsuario(req.params.id, req.body, req.sesion);
        res.json(actualizado);
    } catch (error) {
        responderError(res, error, 'Error al actualizar usuario:');
    }
});

// El administrador asigna una clave nueva a otro usuario
app.put('/api/usuarios/:id/clave', async (req, res) => {
    try {
        const actualizado = await usuarios.reiniciarClave(req.params.id, req.body.clave);
        res.json(actualizado);
    } catch (error) {
        responderError(res, error, 'Error al reiniciar la clave:');
    }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        const resultado = await usuarios.eliminarUsuario(req.params.id, req.sesion);
        res.json(resultado);
    } catch (error) {
        responderError(res, error, 'Error al eliminar usuario:');
    }
});

// Rutas API - ESTAS DEBEN IR ANTES DEL MIDDLEWARE DE ARCHIVOS ESTÁTICOS

// Endpoint de prueba
app.get('/api/test', (req, res) => {
    res.json({
        message: 'Servidor funcionando correctamente',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Obtener todos los vehículos
app.get('/api/vehiculos', async (req, res) => {
    try {
        const vehiculos = await db.obtenerVehiculos();
        res.json(vehiculos);
    } catch (error) {
        console.error('Error al obtener vehículos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Alta o reutilización de una placa de visita (debe ir antes de /:id)
app.post('/api/vehiculos/visita', async (req, res) => {
    try {
        const vehiculo = await db.buscarOCrearVehiculoVisita(req.body);
        res.status(201).json(vehiculo);
    } catch (error) {
        console.error('Error al registrar el vehículo de visita:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener un vehículo específico por ID
app.get('/api/vehiculos/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const vehiculos = await db.obtenerVehiculos();
        const vehiculo = vehiculos.find(v => v.id == id);

        if (!vehiculo) {
            return res.status(404).json({ error: 'Vehículo no encontrado' });
        }

        res.json(vehiculo);
    } catch (error) {
        console.error(`Error al obtener vehículo con ID ${req.params.id}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Los documentos con vencimiento (SOAT, póliza, revisión técnica, tarjeta de
// propiedad) los lleva administración. Maestranza da de alta la placa y corrige
// marca, modelo y tipo, pero no toca esos campos aunque los mande en el body.
const DOCUMENTOS_SOLO_ADMIN = [
    'poliza_aseguradora', 'poliza_numero', 'poliza_renovacion',
    'soat_vencimiento', 'revision_tecnica_vencimiento',
    'tarjeta_propiedad_numero', 'tarjeta_propiedad_emision'
];

function datosDeVehiculo(req) {
    if (esAdministracion(req)) return req.body;

    const datos = { ...req.body };
    DOCUMENTOS_SOLO_ADMIN.forEach(campo => delete datos[campo]);
    return datos;
}

// Agregar un nuevo vehículo
app.post('/api/vehiculos', async (req, res) => {
    try {
        const nuevoVehiculo = await db.agregarVehiculo(datosDeVehiculo(req));
        res.status(201).json(nuevoVehiculo);
    } catch (error) {
        console.error('Error al agregar vehículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar un vehículo existente
app.put('/api/vehiculos/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const vehiculoActualizado = await db.editarVehiculo(id, datosDeVehiculo(req));
        res.json(vehiculoActualizado);
    } catch (error) {
        console.error('Error al actualizar vehículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar un vehículo
app.delete('/api/vehiculos/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const resultado = await db.eliminarVehiculo(id);
        res.json(resultado);
    } catch (error) {
        console.error('Error al eliminar vehículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener todos los asesores
app.get('/api/asesores', async (req, res) => {
    try {
        const asesores = await db.obtenerAsesores();
        res.json(asesores);
    } catch (error) {
        console.error('Error al obtener asesores:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener un asesor específico por ID
app.get('/api/asesores/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const asesores = await db.obtenerAsesores();
        const asesor = asesores.find(a => a.id == id);

        if (!asesor) {
            return res.status(404).json({ error: 'Asesor no encontrado' });
        }

        res.json(asesor);
    } catch (error) {
        console.error(`Error al obtener asesor con ID ${req.params.id}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Agregar un nuevo asesor
app.post('/api/asesores', async (req, res) => {
    try {
        const nuevoAsesor = await db.agregarAsesor(req.body);
        res.status(201).json(nuevoAsesor);
    } catch (error) {
        console.error('Error al agregar asesor:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar un asesor existente
app.put('/api/asesores/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const asesorActualizado = await db.editarAsesor(id, req.body);
        res.json(asesorActualizado);
    } catch (error) {
        console.error('Error al actualizar asesor:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar un asesor
app.delete('/api/asesores/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const resultado = await db.eliminarAsesor(id);
        res.json(resultado);
    } catch (error) {
        console.error('Error al eliminar asesor:', error);
        res.status(500).json({ error: error.message });
    }
});

// Guardar una inspección
app.post('/api/inspecciones', async (req, res) => {
    try {
        const nuevaInspeccion = await db.guardarInspeccion(req.body);
        res.status(201).json(nuevaInspeccion);
    } catch (error) {
        console.error('Error al guardar inspección:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener todas las inspecciones con información básica del vehículo y asesor
app.get('/api/inspecciones', async (req, res) => {
    try {
        console.log('Recibida solicitud para obtener inspecciones');
        const inspecciones = await db.obtenerInspecciones();
        console.log('Respuesta de obtenerInspecciones:', inspecciones);
        res.json(inspecciones);
    } catch (error) {
        console.error('Error al obtener inspecciones:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar múltiples inspecciones (DEBE estar antes del endpoint /:id)
app.delete('/api/inspecciones/eliminar-multiple', async (req, res) => {
    try {
        const { ids } = req.body;

        console.log('Recibida petición DELETE para eliminar-multiple con body:', req.body);

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            console.log('Error: IDs inválidos');
            return res.status(400).json({ error: 'Se requiere un array de IDs válido' });
        }

        console.log('Intentando eliminar inspecciones con IDs:', ids);

        const resultado = await db.eliminarInspeccionesMultiples(ids);

        console.log('Resultado de eliminación:', resultado);

        res.json({
            eliminados: resultado.eliminados,
            errores: resultado.errores || [],
            mensaje: `Se eliminaron ${resultado.eliminados} inspecciones correctamente`
        });
    } catch (error) {
        console.error('Error al eliminar inspecciones múltiples:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtener detalles de una inspección específica
app.get('/api/inspecciones/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const inspeccion = await db.obtenerInspeccionDetallada(id);

        if (!inspeccion) {
            return res.status(404).json({ error: 'Inspección no encontrada' });
        }

        res.json(inspeccion);
    } catch (error) {
        console.error('Error al obtener detalles de inspección:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar una inspección existente
app.put('/api/inspecciones/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const datosActualizados = req.body;

        console.log(`Recibida petición PUT para actualizar inspección ${id}:`, datosActualizados);

        const inspeccionActualizada = await db.actualizarInspeccion(id, datosActualizados);

        console.log('Inspección actualizada correctamente:', inspeccionActualizada);

        res.json({
            mensaje: 'Inspección actualizada correctamente',
            inspeccion: inspeccionActualizada
        });
    } catch (error) {
        console.error('Error al actualizar inspección:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// MAESTRANZA — bandeja de daños, mantenimientos e historial
// ============================================================

// Bandeja de daños detectados en las inspecciones
app.get('/api/danos', async (req, res) => {
    try {
        const danos = await mant.obtenerDanos();
        res.json(danos);
    } catch (error) {
        console.error('Error al obtener daños:', error);
        res.status(500).json({ error: error.message });
    }
});

// Foto de un daño concreto (no viaja en el listado por su peso)
app.get('/api/danos/:detalleId/foto', async (req, res) => {
    try {
        const detalle = await mant.obtenerFotoDano(req.params.detalleId);

        if (!detalle) {
            return res.status(404).json({ error: 'Daño no encontrado' });
        }

        res.json(detalle);
    } catch (error) {
        console.error('Error al obtener la foto del daño:', error);
        res.status(500).json({ error: error.message });
    }
});

// Cambiar la situación de un daño (pendiente / en_orden / atendido / descartado)
app.put('/api/danos/:detalleId', async (req, res) => {
    try {
        const resultado = await mant.actualizarSituacionDano(req.params.detalleId, req.body);
        res.json(resultado);
    } catch (error) {
        console.error('Error al actualizar el daño:', error);
        res.status(500).json({ error: error.message });
    }
});

// Listado de mantenimientos
app.get('/api/mantenimientos', async (req, res) => {
    try {
        const respuesta = await mant.obtenerMantenimientos();

        if (!esAdministracion(req)) {
            respuesta.mantenimientos = respuesta.mantenimientos.map(sinImportes);
        }

        res.json(respuesta);
    } catch (error) {
        console.error('Error al obtener mantenimientos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Detalle de un mantenimiento con sus insumos
app.get('/api/mantenimientos/:id', async (req, res) => {
    try {
        const mantenimiento = await mant.obtenerMantenimiento(req.params.id);

        if (!mantenimiento) {
            return res.status(404).json({ error: 'Mantenimiento no encontrado' });
        }

        res.json(esAdministracion(req) ? mantenimiento : sinImportes(mantenimiento));
    } catch (error) {
        console.error('Error al obtener el mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Crear mantenimiento
app.post('/api/mantenimientos', async (req, res) => {
    try {
        const creado = await mant.crearMantenimiento(req.body, {
            sinFinanzas: !esAdministracion(req)
        });

        res.status(201).json(esAdministracion(req) ? creado : sinImportes(creado));
    } catch (error) {
        console.error('Error al crear mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar mantenimiento
app.put('/api/mantenimientos/:id', async (req, res) => {
    try {
        const datos = { ...req.body };

        // La validación la firma el servidor con la sesión de quien la marca:
        // el cliente solo dice si la orden queda validada o no.
        if (esAdministracion(req) && datos.validado !== undefined) {
            const marca = datos.validado === true || datos.validado === 'true';
            datos.validado_por = marca ? (req.sesion.nombre || req.sesion.usuario) : null;
            datos.validado_en = marca ? new Date().toISOString() : null;
        }

        const actualizado = await mant.actualizarMantenimiento(req.params.id, datos, {
            sinFinanzas: !esAdministracion(req)
        });

        res.json(esAdministracion(req) ? actualizado : sinImportes(actualizado));
    } catch (error) {
        console.error('Error al actualizar mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar mantenimiento
app.delete('/api/mantenimientos/:id', async (req, res) => {
    try {
        const resultado = await mant.eliminarMantenimiento(req.params.id);
        res.json(resultado);
    } catch (error) {
        console.error('Error al eliminar mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Historial completo de un vehículo: ingresos, salidas y mantenimientos
app.get('/api/vehiculos/:id/historial', async (req, res) => {
    try {
        const historial = await mant.obtenerHistorialVehiculo(req.params.id);

        if (!historial) {
            return res.status(404).json({ error: 'Vehículo no encontrado' });
        }

        if (!esAdministracion(req)) {
            historial.mantenimientos = historial.mantenimientos.map(sinImportes);
        }

        res.json(historial);
    } catch (error) {
        console.error('Error al obtener el historial del vehículo:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// PLANTILLAS DE SERVICIO
// ============================================================

// El taller solo lee el catálogo; mantenerlo es cosa de administración.
app.get('/api/catalogo-servicios', async (req, res) => {
    try {
        const datos = await catalogo.obtenerPlantillas({
            soloActivas: !esAdministracion(req)
        });

        res.json(datos);
    } catch (error) {
        console.error('Error al obtener las plantillas de servicio:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/catalogo-servicios', async (req, res) => {
    try {
        const creada = await catalogo.crearPlantilla(req.body);
        res.status(201).json(creada);
    } catch (error) {
        responderError(res, error, 'Error al crear la plantilla de servicio:');
    }
});

app.put('/api/catalogo-servicios/:id', async (req, res) => {
    try {
        const actualizada = await catalogo.actualizarPlantilla(req.params.id, req.body);
        res.json(actualizada);
    } catch (error) {
        responderError(res, error, 'Error al actualizar la plantilla de servicio:');
    }
});

app.delete('/api/catalogo-servicios/:id', async (req, res) => {
    try {
        const resultado = await catalogo.eliminarPlantilla(req.params.id);
        res.json(resultado);
    } catch (error) {
        responderError(res, error, 'Error al eliminar la plantilla de servicio:');
    }
});

// ============================================================
// REPORTES ECONÓMICOS — exclusivos de administración
// ============================================================

// Inversión por vehículo, gasto por tipo de atención y evolución mensual.
// Se resuelve sobre las órdenes ya calculadas por el módulo de maestranza para
// no duplicar la lógica de totales.
app.get('/api/reportes/economico', async (req, res) => {
    try {
        const { desde, hasta, tipo, vehiculo_id } = req.query;
        const { mantenimientos, modulo_listo } = await mant.obtenerMantenimientos();

        // La fecha de referencia es cuándo se hizo el trabajo; si la orden aún
        // no la tiene, se usa la programada y, en último caso, la de creación.
        const fechaDe = orden =>
            orden.fecha_ejecucion || orden.fecha_programada ||
            (orden.created_at ? String(orden.created_at).slice(0, 10) : null);

        const filas = mantenimientos.filter(orden => {
            if (orden.estado === 'anulado') return false;
            if (tipo && orden.tipo !== tipo) return false;
            if (vehiculo_id && String(orden.vehiculo_id) !== String(vehiculo_id)) return false;

            const fecha = fechaDe(orden);
            if (desde && (!fecha || fecha < desde)) return false;
            if (hasta && (!fecha || fecha > hasta)) return false;

            return true;
        });

        const acumular = (mapa, clave, etiqueta, orden) => {
            const registro = mapa[clave] || {
                clave, etiqueta, ordenes: 0, insumos: 0, mano_obra: 0,
                total: 0, presupuesto: 0, horas: 0
            };

            registro.ordenes++;
            registro.insumos += Number(orden.total_insumos) || 0;
            registro.mano_obra += Number(orden.costo_mano_obra) || 0;
            registro.total += Number(orden.costo_total) || 0;
            registro.presupuesto += Number(orden.presupuesto) || 0;
            registro.horas += Number(orden.tiempo_trabajo) || 0;

            mapa[clave] = registro;
            return mapa;
        };

        const porVehiculo = {};
        const porTipo = {};
        const porMes = {};

        filas.forEach(orden => {
            const claveVehiculo = orden.vehiculo_id || `activo:${orden.activo_descripcion || 'sin-asignar'}`;
            acumular(porVehiculo, claveVehiculo, orden.vehiculo_placa, orden);
            acumular(porTipo, orden.tipo || 'sin_tipo', orden.tipo || 'Sin tipo', orden);

            const fecha = fechaDe(orden);
            const mes = fecha ? String(fecha).slice(0, 7) : 'sin-fecha';
            acumular(porMes, mes, mes, orden);
        });

        const redondear = registro => ({
            ...registro,
            insumos: Math.round(registro.insumos * 100) / 100,
            mano_obra: Math.round(registro.mano_obra * 100) / 100,
            total: Math.round(registro.total * 100) / 100,
            presupuesto: Math.round(registro.presupuesto * 100) / 100,
            horas: Math.round(registro.horas * 100) / 100
        });

        const ordenarPorTotal = mapa =>
            Object.values(mapa).map(redondear).sort((a, b) => b.total - a.total);

        const totales = filas.reduce((acc, orden) => {
            acc.ordenes++;
            acc.insumos += Number(orden.total_insumos) || 0;
            acc.mano_obra += Number(orden.costo_mano_obra) || 0;
            acc.total += Number(orden.costo_total) || 0;
            acc.presupuesto += Number(orden.presupuesto) || 0;
            acc.horas += Number(orden.tiempo_trabajo) || 0;
            if (orden.validado_en) acc.validadas++;
            return acc;
        }, {
            ordenes: 0, validadas: 0, insumos: 0, mano_obra: 0,
            total: 0, presupuesto: 0, horas: 0
        });

        res.json({
            modulo_listo,
            filtros: { desde: desde || null, hasta: hasta || null, tipo: tipo || null,
                       vehiculo_id: vehiculo_id || null },
            totales: redondear(totales),
            por_vehiculo: ordenarPorTotal(porVehiculo),
            por_tipo: ordenarPorTotal(porTipo),
            por_mes: Object.values(porMes).map(redondear).sort((a, b) => a.clave.localeCompare(b.clave)),
            ordenes: filas
        });

    } catch (error) {
        console.error('Error al generar el reporte económico:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// PREVENTIVOS — odómetro vigente y rutinas por kilometraje
// ============================================================

// Odómetro vigente de cada vehículo (carga inicial + inspecciones)
app.get('/api/odometros', async (req, res) => {
    try {
        const odometros = await prev.obtenerOdometros();
        res.json(odometros);
    } catch (error) {
        console.error('Error al obtener odómetros:', error);
        res.status(500).json({ error: error.message });
    }
});

// Carga inicial de odómetros
app.put('/api/odometros', async (req, res) => {
    try {
        const resultado = await prev.guardarOdometrosBase(req.body.odometros || req.body);
        res.json(resultado);
    } catch (error) {
        console.error('Error al guardar odómetros:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rutinas preventivas con su situación frente al odómetro
app.get('/api/preventivos', async (req, res) => {
    try {
        const resultado = await prev.obtenerPlanes();
        res.json(resultado);
    } catch (error) {
        console.error('Error al obtener rutinas preventivas:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/preventivos', async (req, res) => {
    try {
        const creado = await prev.crearPlan(req.body);
        res.status(201).json(creado);
    } catch (error) {
        console.error('Error al crear rutina preventiva:', error);
        res.status(500).json({ error: error.message });
    }
});

// Aplicar una rutina a todos los vehículos, a un tipo o a una selección
app.post('/api/preventivos/lote', async (req, res) => {
    try {
        const resultado = await prev.aplicarPlanEnLote(req.body);
        res.json(resultado);
    } catch (error) {
        console.error('Error al aplicar rutina en lote:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/preventivos/:id', async (req, res) => {
    try {
        const actualizado = await prev.actualizarPlan(req.params.id, req.body);
        res.json(actualizado);
    } catch (error) {
        console.error('Error al actualizar rutina preventiva:', error);
        res.status(500).json({ error: error.message });
    }
});

// Registrar que la rutina se cumplió a cierto kilometraje
app.post('/api/preventivos/:id/servicio', async (req, res) => {
    try {
        const actualizado = await prev.registrarServicio(req.params.id, req.body);
        res.json(actualizado);
    } catch (error) {
        console.error('Error al registrar el servicio:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/preventivos/:id', async (req, res) => {
    try {
        const resultado = await prev.eliminarPlan(req.params.id);
        res.json(resultado);
    } catch (error) {
        console.error('Error al eliminar rutina preventiva:', error);
        res.status(500).json({ error: error.message });
    }
});

// MIDDLEWARE DE ARCHIVOS ESTÁTICOS - DESPUÉS DE LAS RUTAS API

// El navegador solo necesita las páginas, app.js, auth.js, modal-fix.js y los
// recursos. El código del servidor, la base local y los SQL no salen de aquí.
const ARCHIVOS_RESERVADOS = /^\/(server\.js|supabase\.js|database.*\.js|setup.*\.js|test-supabase\.js|pruebas\/.*|.*\.db(\..*)?|.*\.sql|\.env.*|package(-lock)?\.json|server\.log)$/i;

app.use((req, res, next) => {
    if (ARCHIVOS_RESERVADOS.test(req.path)) {
        return res.status(404).send('No encontrado');
    }
    next();
});

// Servir archivos estáticos (CSS, JS, imágenes, etc.)
app.use(express.static(path.join(__dirname)));

// Ruta específica para app.css
app.get('/app.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, 'app.css'));
});

// Ruta específica para app.js
app.get('/app.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'app.js'));
});

// Ruta específica para moto.svg
app.get('/moto.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(__dirname, 'moto.svg'));
});

// Rutas para otros archivos estáticos comunes
app.get('/*.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('/*.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, req.path));
});

app.get('/*.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(__dirname, req.path));
});

// Rutas específicas para archivos HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/usuarios.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'usuarios.html'));
});

app.get('/inspection.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'inspection.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/maestranza.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'maestranza.html'));
});

app.get('/historico.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'historico.html'));
});

app.get('/odometros.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'odometros.html'));
});

app.get('/moto.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'moto.html'));
});

app.get('/car.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'car.html'));
});

// Manejador para rutas no encontradas - solo para rutas que NO son API
app.use((req, res, next) => {
    // Si la ruta empieza con /api/ y llegó hasta aquí, es un error 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint no encontrado' });
    }

    // Para otras rutas, redirigir a index.html
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
    console.log('Rutas API disponibles:');
    console.log('  POST /api/auth/login');
    console.log('  GET  /api/auth/me');
    console.log('  POST /api/auth/cambiar-clave');
    console.log('  GET  /api/usuarios            (solo administración)');
    console.log('  GET  /api/test');
    console.log('  GET  /api/vehiculos');
    console.log('  GET  /api/asesores');
    console.log('  GET  /api/inspecciones');
    console.log('  GET  /api/inspecciones/:id');
    console.log('  POST /api/inspecciones');
    console.log('  PUT  /api/inspecciones/:id');
    console.log('  DELETE /api/inspecciones/eliminar-multiple');
}); 