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

## API Endpoints

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