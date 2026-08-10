#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Configurando Sistema de Inspección Vehicular - React');
console.log('================================================\n');

// Función para ejecutar comandos
function runCommand(command, description) {
  console.log(`📦 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completado\n`);
  } catch (error) {
    console.error(`❌ Error en ${description}:`, error.message);
    process.exit(1);
  }
}

// Verificar si Node.js está instalado
function checkNodeVersion() {
  try {
    const version = execSync('node --version', { encoding: 'utf8' }).trim();
    console.log(`✅ Node.js detectado: ${version}`);
    
    const majorVersion = parseInt(version.slice(1).split('.')[0]);
    if (majorVersion < 14) {
      console.error('❌ Se requiere Node.js versión 14 o superior');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Node.js no está instalado. Por favor instale Node.js desde https://nodejs.org/');
    process.exit(1);
  }
}

// Crear directorio client si no existe
function ensureClientDirectory() {
  const clientDir = path.join(__dirname, 'client');
  if (!fs.existsSync(clientDir)) {
    console.log('📁 Creando directorio client...');
    fs.mkdirSync(clientDir, { recursive: true });
  }
}

// Función principal
async function setup() {
  try {
    console.log('🔍 Verificando prerrequisitos...');
    checkNodeVersion();
    
    console.log('\n📋 Instalando dependencias del servidor...');
    runCommand('npm install', 'Instalación de dependencias del servidor');
    
    console.log('📋 Instalando dependencias del cliente React...');
    ensureClientDirectory();
    
    // Verificar si existe package.json en client
    const clientPackageJson = path.join(__dirname, 'client', 'package.json');
    if (fs.existsSync(clientPackageJson)) {
      runCommand('cd client && npm install', 'Instalación de dependencias del cliente');
    } else {
      console.log('⚠️  No se encontró package.json en el directorio client');
      console.log('   Asegúrese de que todos los archivos del cliente estén presentes');
    }
    
    console.log('🎉 ¡Configuración completada exitosamente!');
    console.log('\n📖 Comandos disponibles:');
    console.log('   npm run dev     - Ejecutar en modo desarrollo');
    console.log('   npm run server  - Solo servidor Express');
    console.log('   npm run client  - Solo cliente React');
    console.log('   npm run build   - Construir para producción');
    console.log('   npm start       - Ejecutar en producción');
    
    console.log('\n🌐 URLs:');
    console.log('   Desarrollo: http://localhost:3001 (React)');
    console.log('   Producción: http://localhost:3000 (Express)');
    
    console.log('\n🚀 Para comenzar, ejecute: npm run dev');
    
  } catch (error) {
    console.error('❌ Error durante la configuración:', error.message);
    process.exit(1);
  }
}

// Ejecutar setup
setup();