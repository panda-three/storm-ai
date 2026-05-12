module.exports = {
  apps: [
    {
      name: "storm-ai",
      script: "corepack",
      args: "pnpm start:production",
      cwd: "/var/www/storm-ai",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
}
