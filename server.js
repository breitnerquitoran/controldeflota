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

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsing de JSON y URL-encoded
app.use(bodyParser.json({ limit: '50mb' })); // Para permitir imágenes grandes
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

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

// Agregar un nuevo vehículo
app.post('/api/vehiculos', async (req, res) => {
    try {
        const nuevoVehiculo = await db.agregarVehiculo(req.body);
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
        const vehiculoActualizado = await db.editarVehiculo(id, req.body);
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
        const mantenimientos = await mant.obtenerMantenimientos();
        res.json(mantenimientos);
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

        res.json(mantenimiento);
    } catch (error) {
        console.error('Error al obtener el mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Crear mantenimiento
app.post('/api/mantenimientos', async (req, res) => {
    try {
        const creado = await mant.crearMantenimiento(req.body);
        res.status(201).json(creado);
    } catch (error) {
        console.error('Error al crear mantenimiento:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar mantenimiento
app.put('/api/mantenimientos/:id', async (req, res) => {
    try {
        const actualizado = await mant.actualizarMantenimiento(req.params.id, req.body);
        res.json(actualizado);
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

        res.json(historial);
    } catch (error) {
        console.error('Error al obtener el historial del vehículo:', error);
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
    console.log('  GET  /api/test');
    console.log('  GET  /api/vehiculos');
    console.log('  GET  /api/asesores');
    console.log('  GET  /api/inspecciones');
    console.log('  GET  /api/inspecciones/:id');
    console.log('  POST /api/inspecciones');
    console.log('  PUT  /api/inspecciones/:id');
    console.log('  DELETE /api/inspecciones/eliminar-multiple');
}); 