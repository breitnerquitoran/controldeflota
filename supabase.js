// Configuración de Supabase
const { createClient } = require('@supabase/supabase-js');

// Cargar .env si existe (Node >= 20.12). En Vercel las variables ya vienen del entorno.
try {
  process.loadEnvFile();
} catch (e) {
  // Sin archivo .env: se usan las variables del entorno del sistema.
}

// Variables de entorno (se aceptan ambos nombres)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan las variables de entorno de Supabase. Copia .env.example a .env y define ' +
    'NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;