/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        accent: { DEFAULT: '#E3002D' }
      },
      backdropBlur: {
        xs: '2px'
      }
    },
  },
  plugins: [],
}
