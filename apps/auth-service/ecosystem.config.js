module.exports = {
  apps: [
    {
      name: 'rm-auth',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env.auth',
      env: { NODE_ENV: 'development', PORT: 3002 },
      env_production: { NODE_ENV: 'production', PORT: 3002 },
      error_file: 'logs/auth-error.log',
      out_file: 'logs/auth-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
