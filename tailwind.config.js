/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./store.html",
    "./js/**/*.js",
    "./*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
      },
      colors: {
        gymDark: '#0b1120',
        gymBlack: '#040812',
        gymAccent: '#22d3ee',
      }
    }
  },
  plugins: []
};
