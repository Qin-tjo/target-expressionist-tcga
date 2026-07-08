import type { Config } from "tailwindcss";

/**
 * Target Expressionist theme — locked palette: white / black / light-pink / grey.
 * Layer A (hand-drawn illustration), Layer B (pixel-sticker UI), Layer C (clean graph)
 * all share these tokens + bold black outlines so they harmonize.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        paper: "#FFFFFF",
        pink: {
          DEFAULT: "#FFC7DE",
          soft: "#FFE4F0",
          hot: "#FF4FA3",
          screen: "#FFD9EC",
        },
        grey: {
          chrome: "#C0C0C0",
          panel: "#E6E6E6",
          mid: "#9AA0A6",
          deep: "#5F6368",
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', "monospace"],
        term: ['"VT323"', "ui-monospace", "monospace"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        pixel: "3px 3px 0 0 #111111",
        "pixel-sm": "2px 2px 0 0 #111111",
        "pixel-pink": "3px 3px 0 0 #FF4FA3",
      },
      keyframes: {
        blink: { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
      },
      animation: {
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
