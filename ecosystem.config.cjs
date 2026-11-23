// ecosystem.config.cjs  (place in the project root, next to package.json)
module.exports = {
  apps: [
    {
      name: 'hr-portal',
      script: 'dist/server.cjs',
      cwd: __dirname,
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '800M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};