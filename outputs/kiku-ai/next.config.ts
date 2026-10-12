import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Next infers the workspace root by walking up for a package.json. On a machine
// with an unrelated project higher up the drive it picks that one, and then
// loads its PostCSS config instead of this app's. Pinning the root keeps the
// build and the standalone output tied to this directory wherever it is cloned.
const root = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root },
  outputFileTracingRoot: root,
};
export default config;
