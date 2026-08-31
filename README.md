# Sistema de Inspección Vehicular con React

Este proyecto es una refactorización a React de un sistema de inspección vehicular originalmente desarrollado con HTML, CSS y JavaScript vanilla.

## Requisitos previos

- Node.js (v14 o superior)
- npm (v6 o superior)

## Instalación

1. Clona este repositorio o descarga los archivos.

2. Instala las dependencias del servidor:
   ```
   npm install
   ```

3. Instala las dependencias del cliente React:
   ```
   npm run install-client
   ```

## Ejecución

### Modo desarrollo

Para ejecutar tanto el servidor como el cliente en modo desarrollo:

```
npm run dev
```

Esto iniciará:
- El servidor Express en http://localhost:3000
- La aplicación React en http://localhost:3001

### Solo servidor

```
npm run server
```

### Solo cliente

```
npm run client
```

## Estructura del proyecto

```
/
├── client/                 # Aplicación React
│   ├── public/             # Archivos públicos
│   └── src/                # Código fuente React
├── server.js               # Servidor Express
├── database.js             # Configuración de la base de datos SQLite
└── package.json            # Configuración del proyecto
```

## Características

- Gestión de vehículos y asesores
- Registro de inspecciones vehiculares
- Captura de fotos con la cámara
- Histórico de inspecciones
- Registro de odómetros
- Panel de administración

## Acceso y roles

El sistema arranca en `login.html`: sin sesión iniciada ninguna pantalla se abre.

| Rol | Pantallas |
| --- | --- |
| **Usuario** | Inicio (nueva inspección), Inspección e Histórico |
| **Maestranza** | Maestranza y Odómetros, **sin ver costos ni presupuestos** |
| **Administración** | Todas las anteriores más Administración, Usuarios y la información económica |

### Separación entre lo técnico y lo financiero

El taller registra el trabajo (vehículo o activo, tipo de servicio, descripción,
tiempo de trabajo, repuestos y observaciones) y administración lleva el dinero
(costo de los repuestos, mano de obra, presupuesto y validación del servicio).

La separación se aplica **en el servidor**, no escondiendo campos en la pantalla:
a quien no es administrador, las respuestas de `/api/mantenimientos`,
`/api/mantenimientos/:id` y `/api/vehiculos/:id/historial` viajan sin
`costo_mano_obra`, `total_insumos`, `costo_total`, `presupuesto` ni el
`costo_unitario` de cada repuesto; y si esos campos llegaran en un POST o un PUT,
se descartan antes de tocar la base.

Al reeditar una orden ya valorizada, los repuestos se casan por su identificador:
el técnico puede corregir descripciones o cantidades y añadir o quitar líneas sin
que se pierdan los importes que cargó administración.

Puesta en marcha:

1. Ejecutar en el SQL Editor de Supabase, en este orden: `supabase-usuarios.sql` y
   luego `supabase-costos-roles.sql` (este último necesita que ya existan las tablas
   de `supabase-mantenimientos.sql` y `supabase-preventivos.sql`). Ambos son
   idempotentes: se pueden volver a ejecutar sin romper nada.
2. Entrar la primera vez con **admin / admin123**: la tabla está vacía, así que la
   aplicación crea ese administrador y obliga a cambiar la clave.
   La clave temporal se puede fijar con la variable `ADMIN_CLAVE_INICIAL`.
3. Definir `AUTH_SECRET` en el entorno (cualquier cadena larga y secreta) para que
   las sesiones sobrevivan a los despliegues.

Desde **Usuarios** (solo administración) se dan de alta personas, se cambia su rol,
se les asigna una clave nueva y se activan o desactivan. Cada quien cambia su propia
clave desde su nombre en la barra superior. Las claves se guardan cifradas con scrypt
y la sesión dura 12 horas. **Al cambiar el rol de alguien, esa persona debe volver a
iniciar sesión**: el rol viaja firmado dentro del token.

## API Endpoints

### Acceso
- `POST /api/auth/login` - Iniciar sesión (devuelve el token de la sesión)
- `GET /api/auth/me` - Datos del usuario de la sesión
- `POST /api/auth/cambiar-clave` - Cambiar la clave propia

### Plantillas de servicio
- `GET /api/catalogo-servicios` - Actividades frecuentes del taller (todos los perfiles operativos)
- `POST /api/catalogo-servicios` - Crear una plantilla (solo administración)
- `PUT /api/catalogo-servicios/:id` - Editar una plantilla (solo administración)
- `DELETE /api/catalogo-servicios/:id` - Eliminar una plantilla (solo administración)

### Reportes (solo administración)
- `GET /api/reportes/economico` - Inversión por vehículo o activo, gasto por tipo de
  atención, evolución mensual y presupuesto contra gasto real.
  Acepta los filtros `desde`, `hasta`, `tipo` y `vehiculo_id`.

### Usuarios (solo administración)
- `GET /api/usuarios` - Listar usuarios
- `POST /api/usuarios` - Crear un usuario
- `PUT /api/usuarios/:id` - Cambiar nombre, rol o estado
- `PUT /api/usuarios/:id/clave` - Asignar una clave nueva
- `DELETE /api/usuarios/:id` - Eliminar un usuario

### Vehículos
- `GET /api/vehiculos` - Obtener todos los vehículos
- `GET /api/vehiculos/:id` - Obtener un vehículo específico
- `POST /api/vehiculos` - Crear un nuevo vehículo
- `PUT /api/vehiculos/:id` - Actualizar un vehículo
- `DELETE /api/vehiculos/:id` - Eliminar un vehículo

### Asesores
- `GET /api/asesores` - Obtener todos los asesores
- `GET /api/asesores/:id` - Obtener un asesor específico
- `POST /api/asesores` - Crear un nuevo asesor
- `PUT /api/asesores/:id` - Actualizar un asesor
- `DELETE /api/asesores/:id` - Eliminar un asesor

### Inspecciones
- `GET /api/inspecciones` - Obtener todas las inspecciones
- `GET /api/inspecciones/:id` - Obtener una inspección específica
- `POST /api/inspecciones` - Crear una nueva inspección
- `PUT /api/inspecciones/:id` - Actualizar una inspección
- `DELETE /api/inspecciones/eliminar-multiple` - Eliminar múltiples inspecciones

## Tecnologías utilizadas

- **Frontend**: React, React Router, Bootstrap, Axios
- **Backend**: Express.js, SQLite3
- **Herramientas**: Concurrently, Nodemon