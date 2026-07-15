/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // La evidencia es el argumento de venta: ✅ respaldado por datos vs ⚠️ sin validar.
        // Dos colores semánticos, para que la separación sea visible de un vistazo.
        respaldo: '#15803d', // verde: hay datos de mercado
        alerta: '#b45309', // ámbar: sin validar
      },
    },
  },
  plugins: [],
};
