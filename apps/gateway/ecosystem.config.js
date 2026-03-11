module.exports = {
  apps: [
    {
      name: 'rm-gateway',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env.gateway',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
        AUTH_SERVICE_URL: 'http://localhost:3002',
        CORE_API_URL: 'http://localhost:3001',
        AGENT_ORCHESTRATOR_URL: 'http://localhost:5000',
        COMM_SERVICE_URL: 'http://localhost:3003',
      },
      env_production: { NODE_ENV: 'production', PORT: 3000 },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '256M',
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
