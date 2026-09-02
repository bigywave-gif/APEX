const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eef6ff",
          100: "#d9ebff",
          200: "#bcdaff",
          300: "#8ec2ff",
          400: "#59a1ff",
          500: "#3480fa",
          600: "#1e60ef",
          700: "#174bdc",
          800: "#193eb2",
          900: "#1a388c",
          950: "#152255",
        },
        soft: {
          teal: "#0e9384",
          amber: "#b26400",
        },
      },
    },
  },
  darkMode: "class",
  plugins: [heroui()],
};
