import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['pg', 'better-sqlite3'],
  noExternal: [],
  esbuildOptions(options) {
    options.platform = 'node';
  },
});
