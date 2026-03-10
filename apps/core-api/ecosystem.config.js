/**
 * PM2 ecosystem config for core-api.
 *
 * Run with: pm2 start apps/core-api/ecosystem.config.js
 * Or from repo root: pm2 start deployment/pm2/ecosystem.config.js
 *
 * cluster mode with 2 instances enables zero-downtime restarts and
 * distributes load across CPU cores.
 */
module.exports = {
  apps: [
    {
      name: 'rm-core-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '512M',
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
