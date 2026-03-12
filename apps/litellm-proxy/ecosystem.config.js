const dotenv = require('dotenv');
const parsedEnv = dotenv.config({ path: '.env.litellm' }).parsed || {};

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
      ...parsedEnv,
      LITELLM_MASTER_KEY: parsedEnv.LITELLM_MASTER_KEY,
      GEMINI_API_KEY: parsedEnv.GEMINI_API_KEY,
      GROQ_API_KEY: parsedEnv.GROQ_API_KEY,
      OPENAI_API_KEY: parsedEnv.OPENAI_API_KEY || parsedEnv.GROQ_API_KEY,
      NODE_ENV: 'production',
      PORT: '4000',
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 5000,
    max_restarts: 10,
    watch: false,
  }],
};
