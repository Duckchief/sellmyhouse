import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/views/**/*.njk', './src/views/**/*.html'],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a2e',
        accent: {
          DEFAULT: '#c8553d',
          dark: '#a8432f',
        },
        bg: {
          DEFAULT: '#fafaf7',
          alt: '#f0efe9',
        },
      },
    },
  },
  plugins: [],
};

export default config;
