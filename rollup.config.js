import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import { dts } from 'rollup-plugin-dts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const external = [
  'node:fs',
  'node:path',
  'fs',
  'path',
  'os',
  'file-type',
  '@emblemvault/auth-sdk'  // Peer dependency for headless auth
];

// Plugin to replace dynamic imports with conditional code
const conditionalImports = () => ({
  name: 'conditional-imports',
  renderChunk(code) {
    // Replace Node.js dynamic imports with conditional logic that won't execute in browsers
    return code
      .replace(/await import\(['"]fs['"]\)/g, 'await (typeof window !== "undefined" ? Promise.reject(new Error("fs not available in browser")) : import("fs"))')
      .replace(/await import\(['"]path['"]\)/g, 'await (typeof window !== "undefined" ? Promise.reject(new Error("path not available in browser")) : import("path"))')
      .replace(/await import\(['"]file-type['"]\)/g, 'await (typeof window !== "undefined" ? Promise.reject(new Error("file-type not available in browser")) : import("file-type"))');
  }
});

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/esm/index.js',
      format: 'es',
      sourcemap: true
    },
    external,
    plugins: [
      replace({
        preventAssignment: true,
        __SDK_VERSION__: JSON.stringify(pkg.version)
      }),
      resolve({
        preferBuiltins: true,
        browser: true
      }),
      commonjs(),
      json(),
      typescript({
        outDir: 'dist/esm',
        declaration: false,
        target: 'es2020'
      }),
      conditionalImports()
    ]
  },
  // CJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/cjs/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    external,
    plugins: [
      replace({
        preventAssignment: true,
        __SDK_VERSION__: JSON.stringify(pkg.version)
      }),
      resolve({
        preferBuiltins: true
      }),
      commonjs(),
      json(),
      typescript({
        outDir: 'dist/cjs',
        declaration: false,
        target: 'es2020'
      }),
      conditionalImports()
    ]
  },
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/types/index.d.ts',
      format: 'es'
    },
    external,
    plugins: [
      dts()
    ]
  },
  // Browser (ES module) build - for use with <script type="module">
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/browser/hustle-incognito.esm.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true
    },
    // Don't externalize anything for browser build - bundle everything except node builtins
    // Note: @emblemvault/auth-sdk is external since it's a peer dependency for headless auth
    external: ['fs', 'path', 'os', 'node:fs', 'node:path', '@emblemvault/auth-sdk'],
    plugins: [
      replace({
        preventAssignment: true,
        __SDK_VERSION__: JSON.stringify(pkg.version)
      }),
      resolve({
        preferBuiltins: false,
        browser: true
      }),
      commonjs(),
      json(),
      typescript({
        outDir: 'dist/browser',
        declaration: false,
        target: 'es2020'
      }),
      conditionalImports()
    ]
  }
];