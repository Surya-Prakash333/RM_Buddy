module.exports = {
  apps: [
    {
      name: 'rm-auth',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3002,
      },
      // Graceful restart on SIGINT/SIGTERM
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      // Restart on uncaught exceptions with back-off
      max_restarts: 10,
      restart_delay: 2000,
      // Log configuration
      error_file: 'logs/auth-error.log',
      out_file: 'logs/auth-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
