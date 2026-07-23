/**
 * `prebuild`: frena `npm run build` si `environment.prod.ts` no está listo para producción (quedan
 * placeholders o una URL no-HTTPS). Ver `src/environments/config-check.ts` (10ª review, #6).
 *
 * Corre solo antes de `build` (producción). El build de desarrollo y `ng serve` no lo disparan.
 */
import { environment } from '../src/environments/environment.prod';
import { problemasDeConfigProd } from '../src/environments/config-check';

const problemas = problemasDeConfigProd(environment);

if (problemas.length > 0) {
  console.error('✖ environment.prod.ts NO está listo para producción:');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error('\nCompletá apiBaseUrl, supabaseUrl y supabaseAnonKey (valores reales, HTTPS) antes de `npm run build`.');
  process.exit(1);
}

console.log('✔ environment.prod.ts: sin placeholders y con URLs HTTPS.');
