module.exports = {
  apps: [
    {
      name: 'rm-comm',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3003,
      },
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      // Restart policy
      max_restarts: 10,
      restart_delay: 2000,
      // Log configuration
      error_file: 'logs/comm-error.log',
      out_file: 'logs/comm-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
