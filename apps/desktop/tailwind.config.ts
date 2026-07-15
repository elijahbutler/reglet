import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        reglet: {
          bg: '#0f1115',
          panel: '#161920',
          panel2: '#1f242d',
          line: '#303642',
          text: '#f5f2eb',
          muted: '#a9b0bc',
          accent: '#d6b36a',
          green: '#7ccf91',
          red: '#ff7a7a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
