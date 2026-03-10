module.exports = {
  apps: [{
    name: 'rm-litellm-proxy',
    script: 'litellm',
    args: '--config config.yaml --port 4000',
    interpreter: 'python3',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: '4000',
    },
    env_file: '.env.litellm',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 5000,
    max_restarts: 10,
    watch: false,
  }],
};
