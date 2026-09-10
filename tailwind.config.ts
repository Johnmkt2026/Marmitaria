import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: { 50:'#f4f7ef', 500:'#496640', 600:'#314c37', 900:'#193324' }, terracotta: { 100:'#f7e3d6', 500:'#c86f4a', 700:'#98472f' }, cream:'#f8f2e7' } } }, plugins: [] } satisfies Config;
