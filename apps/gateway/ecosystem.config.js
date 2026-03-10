/**
 * PM2 ecosystem config for the Express gateway.
 *
 * Run with: pm2 start apps/gateway/ecosystem.config.js
 *
 * Single fork instance — the gateway is I/O-bound and Node's event loop
 * handles concurrency well without clustering. A load-balancer (nginx) should
 * sit in front for multi-instance deployments.
 */
module.exports = {
  apps: [
    {
      name: 'rm-gateway',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '256M',
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
