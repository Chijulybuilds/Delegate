import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/vercel.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source; bundle it into the API build.
  noExternal: ['@delegate/shared'],
});
