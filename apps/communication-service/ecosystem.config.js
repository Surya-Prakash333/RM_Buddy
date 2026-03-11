module.exports = {
  apps: [
    {
      name: 'rm-comm',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env.comm',
      env: { NODE_ENV: 'development', PORT: 3003 },
      env_production: { NODE_ENV: 'production', PORT: 3003 },
      error_file: 'logs/comm-error.log',
      out_file: 'logs/comm-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
