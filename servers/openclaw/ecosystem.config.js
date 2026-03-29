module.exports = {
  apps: [
    {
      name: "openclaw-mcp",
      script: "dist/index.js",
      cwd: __dirname,
      env_file: ".env",
      // Restart strategy
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      // Logging
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Auto-restart on file change (disable in production)
      watch: false,
    },
  ],
};
