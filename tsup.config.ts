import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.tsx',
    'src/mcp-app-view/index.ts',
    'src/mcp-app-view/react.ts',
    'src/mcp-app-view/host.ts',
  ],
  format: ['esm'], // ESM only for browser compatibility
  dts: true,
  sourcemap: true,
  clean: true,
  platform: 'browser', // Browser-only build
  target: 'es2019', // Modern browsers
  outDir: 'lib',
  treeshake: true,
  splitting: false,
  minify: false, // Set to true for production builds
  shims: false, // Disable CJS shims to avoid __require
  
  // External dependencies that users will install (peer dependencies)
  external: [
    'react', 
    'react-dom',
  ],
  
  // Bundle internal BotDojo packages that aren't published to npm
  // Also bundle mcp-app-view so it's included in the chat-sdk bundle
  noExternal: [
    'botdojo-rpc',
    'mcp-app-view',
  ],
  
  // Exclude Node.js built-in modules from bundling - make them external/empty
  esbuildOptions(options) {
    options.platform = 'browser';
    options.define = {
      ...options.define,
      'process.env.NODE_ENV': JSON.stringify('production'),
      'global': 'globalThis',
    };
    // Mark Node.js built-ins AND React as external so they're not bundled
    options.external = [
      ...(options.external || []),
      'react',
      'react-dom',
      'react/jsx-runtime',
      'crypto',
      'stream',
      'buffer',
      'util',
      'fs',
      'path',
      'os',
      'net',
      'tls',
      'http',
      'https',
      'url',
      'querystring',
      'events',
      'assert',
    ];
    // Force conditions to prefer browser builds
    options.conditions = ['browser', 'module', 'import'];
    // Resolve extensions for browser
    options.resolveExtensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
    // Handle CJS require shims for React when bundling CJS dependencies
    options.banner = {
      js: `import * as __React from 'react';
import * as __ReactDOM from 'react-dom';
var require = (id) => {
  if (id === 'react') return __React;
  if (id === 'react-dom') return __ReactDOM;
  throw new Error('Dynamic require not supported: ' + id);
};`
    };
  },
  
  // Define globals for browser compatibility
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'globalThis',
  },
  
  // Skip bundling Node.js modules
  skipNodeModulesBundle: false,
  
  tsconfig: './tsconfig.json',
});
