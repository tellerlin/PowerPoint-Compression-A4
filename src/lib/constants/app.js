export const APP_CONFIG = {
  MAX_FILE_SIZE: 314572800, // 300MB in bytes
  SUPPORTED_EXTENSIONS: [".pptx"],
  CACHE_DURATION: 1800000, // 30 minutes in milliseconds
  API_TIMEOUT: 30000, // 30 seconds in milliseconds
};

export const UI_CONFIG = {
  ANIMATIONS: {
    DURATION: {
      FAST: 200,
      NORMAL: 300,
      SLOW: 500
    },
    EASING: {
      DEFAULT: "ease-out",
      BOUNCE: "cubic-bezier(0.68, -0.55, 0.265, 1.55)"
    }
  },
  TOAST: {
    DURATION: 3000,
    POSITION: "bottom-right"
  }
};