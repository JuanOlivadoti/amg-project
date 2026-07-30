/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      // Un token por ROL, resuelto por variable CSS. El tema se cambia en `styles.css` (`:root` y
      // `.oscuro`) y las plantillas no se enteran: por eso la pieza C hereda el modo oscuro por
      // construcción, en vez de tener que acordarse de un `dark:` en cada clase.
      //
      // Hex plano y no canales: Tailwind 3 con `var()` NO soporta el modificador de opacidad
      // (`bg-superficie/50`). El portal no usa opacidad en colores; si alguna vez hace falta, se
      // migra a `--fondo: 249 250 251` + `rgb(var(--fondo) / <alpha-value>)`. YAGNI.
      colors: {
        fondo: 'var(--fondo)',
        superficie: 'var(--superficie)',
        'superficie-2': 'var(--superficie-2)',
        texto: 'var(--texto)',
        'texto-medio': 'var(--texto-medio)',
        'texto-tenue': 'var(--texto-tenue)',
        'texto-invertido': 'var(--texto-invertido)',
        borde: 'var(--borde)',
        'borde-fuerte': 'var(--borde-fuerte)',
        accion: 'var(--accion)',
        respaldo: 'var(--respaldo)',
        'respaldo-suave': 'var(--respaldo-suave)',
        alerta: 'var(--alerta)',
        'alerta-suave': 'var(--alerta-suave)',
        error: 'var(--error)',
        'error-suave': 'var(--error-suave)',
      },
      // El preflight de Tailwind le pone `#e5e7eb` al borde de TODO elemento. Un `class="border"` sin
      // color —hay dos botones así en `brief`— quedaba con un borde casi blanco (13.68:1) sobre la
      // superficie oscura. Se arregla en el default: parchar los dos botones deja roto al próximo.
      borderColor: {
        DEFAULT: 'var(--borde)',
      },
    },
  },
  plugins: [],
};
