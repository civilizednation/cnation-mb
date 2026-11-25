/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        panel: '#151922',
        panel2: '#1d2230',
        line: '#2a3142',
        accent: '#7c5cff',
        accent2: '#22d3ee',
        star: '#fbbf24',
      },
    },
  },
  plugins: [],
};
