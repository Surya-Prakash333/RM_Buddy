module.exports = {
  apps: [
    {
      name: 'rm-core-api',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env.core-api',
      env: { NODE_ENV: 'development', PORT: 3001 },
      env_production: { NODE_ENV: 'production', PORT: 3001 },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '512M',
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
