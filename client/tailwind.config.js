/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand gradient: deep indigo → violet → teal
        brand: {
          50: '#f0f4ff',
          100: '#e0e8ff',
          200: '#c4d1ff',
          300: '#9ab0ff',
          400: '#6b83ff',
          500: '#4f5fff',
          600: '#3b3df7',
          700: '#2e2ed4',
          800: '#2626ac',
          900: '#222288',
          950: '#161655',
        },
        violet: {
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
        // Glass / dark backgrounds
        glass: {
          dark: 'rgba(10, 10, 30, 0.85)',
          mid: 'rgba(20, 20, 50, 0.70)',
          light: 'rgba(255, 255, 255, 0.05)',
        },
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #4f5fff 0%, #8b5cf6 50%, #14b8a6 100%)',
        'gradient-dark': 'linear-gradient(135deg, #0a0a1e 0%, #14142e 50%, #0a1628 100%)',
        'gradient-card': 'linear-gradient(135deg, rgba(79,95,255,0.1) 0%, rgba(139,92,246,0.1) 100%)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'gradient-shift': 'gradientShift 8s ease infinite',
        'waveform': 'waveform 0.5s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        waveform: {
          '0%': { transform: 'scaleY(0.2)' },
          '100%': { transform: 'scaleY(1)' },
        },
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        'glass-hover': '0 16px 48px 0 rgba(31, 38, 135, 0.5)',
        'brand': '0 0 30px rgba(79, 95, 255, 0.4)',
        'teal': '0 0 30px rgba(20, 184, 166, 0.3)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 12px 48px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};
