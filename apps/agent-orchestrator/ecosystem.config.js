/**
 * ecosystem.config.js — PM2 process configuration for the RM Buddy Agent Orchestrator.
 *
 * Run with:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --env production
 *
 * Logs land in logs/ relative to this file's directory.
 * Create the logs/ directory before first start:
 *   mkdir -p logs
 */

module.exports = {
  apps: [
    {
      name: "rm-orchestrator",

      // uvicorn is invoked directly; interpreter tells PM2 to use python3
      // so that the virtual environment's uvicorn is resolved correctly.
      script: ".venv/bin/uvicorn",
      args: "src.main:app --host 0.0.0.0 --port 5000 --workers 2",
      interpreter: "none",

      // Working directory is the agent-orchestrator package root so that
      // relative imports (src.main) and .env.orchestrator file resolution work.
      cwd: __dirname,

      // Single PM2-managed process (uvicorn handles worker forking internally).
      instances: 1,
      exec_mode: "fork",

      // Load environment variables from the local env file.
      env_file: ".env.orchestrator",

      env: {
        PYTHONPATH: "src",
      },

      // Production overrides (pm2 start --env production)
      env_production: {
        NODE_ENV: "production",
        PYTHONPATH: "src",
      },

      // Log files — relative to cwd
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Restart policy
      restart_delay: 5000,    // ms — wait 5s before restart after crash
      max_restarts: 10,       // give up after 10 consecutive crashes

      // Disable file watching in production; use rolling deploys instead.
      watch: false,
    },
  ],
};
