import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/views/**/*.njk', './src/views/**/*.html'],
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
