import type { NextConfig } from 'next';
const config: NextConfig = {
  // Keep fixture builds small enough for local development and CI runners.
  experimental: { cpus: 2 },
};
export default config;
