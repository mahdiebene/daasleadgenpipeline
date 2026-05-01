import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DaaS Lead Generation Pipeline',
  description: 'Distributed lead generation and intelligence pipeline',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-xl font-bold text-white">
              <span className="text-blue-400">DaaS</span> Lead Generation Pipeline
            </h1>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}