import { spawnSync } from 'node:child_process';

const steps = [
  ['npx', ['supabase', 'db', 'reset']],
  ...['public_menu','admin_orders','admin_customers','admin_menu','product_catalog','product_images','admin_settings','admin_dashboard','admin_reports','admin_whatsapp']
    .map(test => ['npx', ['supabase', 'db', 'query', '--local', '--file', `supabase/tests/${test}.sql`]]),
  ['npm', ['run', 'test:whatsapp']],
  ['npx', ['supabase', 'db', 'lint']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'build']],
  ['git', ['diff', '--check']],
];

for (const [command, args] of steps) {
  const commandLine = [command, ...args].join(' ');
  console.log(`\n> ${commandLine}`);
  const result = spawnSync(commandLine, {
    stdio: 'inherit', shell: true,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
