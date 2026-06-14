/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Idea node type palette — reused by graph + legend.
        node: {
          claim: '#6366f1',
          finding: '#10b981',
          construct: '#f59e0b',
          method: '#ec4899',
          framework: '#06b6d4',
        },
      },
    },
  },
  plugins: [],
};
