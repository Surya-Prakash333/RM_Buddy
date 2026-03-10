/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1B4F72',
        secondary: '#2E86AB',
        accent: '#F39C12',
        surface: '#F8F9FA',
        success: '#27AE60',
        warning: '#F39C12',
        danger: '#E74C3C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      screens: {
        'min-layout': '1280px',
      },
    },
  },
  plugins: [],
};
