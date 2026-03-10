import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/views/**/*.njk', './src/views/**/*.html'],
  theme: {
    extend: {
      // Brand colors will be defined in Phase 1
    },
  },
  plugins: [],
};

export default config;
