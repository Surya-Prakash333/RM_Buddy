module.exports = {
  apps: [
    {
      name: 'rm-gateway',
      script: 'apps/gateway/dist/index.js',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: 3000 },
    },
    {
      name: 'rm-core',
      script: 'apps/core-api/dist/main.js',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: 3001 },
    },
    {
      name: 'rm-auth',
      script: 'apps/auth-service/dist/main.js',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: 3002 },
    },
    {
      name: 'rm-comm',
      script: 'apps/communication-service/dist/main.js',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: 3003 },
    },
    {
      name: 'rm-litellm',
      script: 'apps/litellm-proxy/run.sh',
      interpreter: 'bash',
      instances: 1,
      env: { PORT: 4000 },
    },
    {
      name: 'rm-orchestrator',
      script: 'apps/agent-orchestrator/src/main.py',
      interpreter: 'python3',
      instances: 1,
      env: { PORT: 5000 },
    },
  ],
};
