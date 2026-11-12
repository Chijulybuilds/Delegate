// PM2 process file for a VPS (e.g. Hostinger): `pm2 start ecosystem.config.cjs && pm2 save`
module.exports = {
  apps: [
    {
      name: 'delegate',
      script: 'apps/api/dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '400M',
      time: true,
    },
  ],
};
