/** @type {import('next').NextConfig} */
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const nextConfig = {
  // Keep dev and production output apart. Sharing one .next folder between
  // `next dev` and `next build` corrupts the React client manifest and throws
  // "Could not find the module ... global-error.js# in the React Client Manifest".
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/plivo/:path*', destination: `${API}/plivo/:path*` },
    ];
  },
};

export default nextConfig;
