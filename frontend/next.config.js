/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://144.172.99.105:3001'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
