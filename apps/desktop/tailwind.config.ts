import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        reglet: {
          bg: '#040506',
          panel: '#07080a',
          panel2: '#111214',
          graphite: '#1b1c1e',
          line: '#2f3031',
          iron: '#454647',
          text: '#e6e6e6',
          muted: '#9c9c9d',
          accent: '#e6e6e6',
          coral: '#ff6363',
          info: '#56c2ff',
          green: '#59d499',
          warning: '#ffb224',
          error: '#e5484d',
          red: '#ff9294',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
