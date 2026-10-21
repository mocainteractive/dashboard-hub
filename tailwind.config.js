/** @type {import('tailwindcss').Config} */
/* Design token Moca Hub (identici all'Hub) più i colori dei grafici del brand. */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'moca-red': '#E52217',
        'moca-red-light': '#FFE7E6',
        'moca-black': '#191919',
        'moca-gray': '#8A8A8A',
        'moca-bg': '#F3F4F6',
        'moca-text': '#595959',
        'moca-line': '#ECEDEF',
        'chart-green': '#118541',
        'chart-blue': '#5781FF',
        'chart-purple': '#551FC4',
        'chart-pink': '#CE2A59',
        'chart-orange': '#DB5E29',
        'chart-gray': '#484848',
        'success': '#22c55e',
        'warning': '#f59e0b',
        'danger': '#ef4444',
      },
      fontFamily: {
        'figtree': ['Figtree', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(25,25,25,0.04), 0 1px 3px rgba(25,25,25,0.06)',
      },
    },
  },
  plugins: [],
};
