// ecosystem.config.cjs  (place in the project root, next to package.json)
//
// Two apps are defined. Each server folder starts only the one it is for (deploy.sh passes --only):
//   hr-portal          live site     port 3000   folder on the `production` branch
//   hr-portal-staging  test copy     port 3001   folder on the `main` branch
// Each folder has its own .env, so the staging copy uses its own database and settings.
const base = {
  script: 'dist/server.cjs',
  cwd: __dirname,
  node_args: '--env-file=.env',
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_memory_restart: '800M',
  kill_timeout: 5000,
  merge_logs: true,
  time: true,
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'hr-portal',
      env: { NODE_ENV: 'production' },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
    },
    {
      ...base,
      name: 'hr-staging',
      env: { NODE_ENV: 'production', PORT: 3001 },
      out_file: './logs/staging-out.log',
      error_file: './logs/staging-error.log',
    },
  ],
};