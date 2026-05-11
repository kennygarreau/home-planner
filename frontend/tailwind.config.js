/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'cursive'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0f9f0',
          100: '#dcf0dc',
          200: '#bbe3bb',
          300: '#8ecf8e',
          400: '#5cb35c',
          500: '#3a9a3a',
          600: '#2a7a2a',
          700: '#226022',
          800: '#1e4d1e',
          900: '#193f19',
        },
        slate: {
          850: '#172033',
          950: '#0a0f1a',
        }
      }
    }
  },
  plugins: []
}
