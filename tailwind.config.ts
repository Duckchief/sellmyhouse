import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/views/**/*.njk', './src/views/**/*.html', './public/js/**/*.js'],
  safelist: [
    'bg-green-50', 'hover:bg-green-100',
    'bg-green-500', 'bg-red-500',
    'w-1.5', 'h-1.5',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#1a1a2e',
        accent: {
          DEFAULT: '#c8553d',
          dark: '#a8432f',
        },
        bg: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
        },
        panel: 'var(--color-panel)',
      },
    },
  },
  plugins: [],
};

export default config;
