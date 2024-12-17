export const tokens = {
  colors: {
    light: {
      background: '255 255 255',    // White
      surface: '250 250 250',       // Light gray
      primary: '79 70 229',         // Indigo
      secondary: '99 102 241',      // Lighter indigo
      accent: '236 72 153',         // Pink
      text: '17 24 39',             // Dark gray
      muted: '107 114 128',         // Medium gray
      border: '229 231 235'         // Light border
    },
    dark: {
      background: '15 23 42',       // Dark blue-gray
      surface: '30 41 59',          // Slightly lighter blue-gray
      primary: '129 140 248',       // Light indigo
      secondary: '165 180 252',     // Lighter indigo
      accent: '244 114 182',        // Pink
      text: '241 245 249',          // Off-white
      muted: '148 163 184',         // Medium gray
      border: '51 65 85'            // Dark border
    }
  },
  spacing: {
    '0': '0',
    '1': '0.25rem',
    '2': '0.5rem',
    '3': '0.75rem',
    '4': '1rem',
    '5': '1.25rem',
    '6': '1.5rem',
    '8': '2rem',
    '10': '2.5rem',
    '12': '3rem',
    '16': '4rem',
    '20': '5rem',
    '24': '6rem',
    '32': '8rem'
  },
  typography: {
    fonts: {
      sans: 'Inter, system-ui, -apple-system, sans-serif',
      display: '"Plus Jakarta Sans", var(--font-sans)'
    },
    sizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem'
    },
    weights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700'
    }
  },
  animation: {
    durations: {
      fast: '150ms',
      normal: '250ms',
      slow: '350ms'
    },
    timings: {
      ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
    }
  }
};