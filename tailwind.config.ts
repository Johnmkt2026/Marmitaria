import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: { 50:'#fff7ed', 500:'#ea580c', 600:'#c2410c', 900:'#7c2d12' } } } }, plugins: [] } satisfies Config;
