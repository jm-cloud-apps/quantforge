/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'sans-serif'],
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: {
          50: '#E2E8F0',
          100: '#CBD5E1',
          200: '#94A3B8',
          300: '#7C8DB0',
          400: '#64748B',
          500: '#475569',
          600: '#334155',
          700: '#1E293B',
          800: '#141C2B',
          900: '#0F1623',
          950: '#0A0F1A',
        },
        accent: {
          DEFAULT: '#10B981',
          muted: '#059669',
          bright: '#34D399',
        },
        danger: '#EF4444',
        success: '#10B981',
        warning: '#F59E0B',
        cyan: '#06B6D4',
        purple: '#8B5CF6',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(16, 185, 129, 0.15)',
        'glow-sm': '0 0 10px rgba(16, 185, 129, 0.1)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(16, 185, 129, 0.08)',
      },
    },
  },
  plugins: [],
}
