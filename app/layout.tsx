import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// `--font-inter` rather than `--font-sans`: the @theme block maps the Tailwind font-sans token onto it.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
    title: { default: 'Reposite', template: '%s · Reposite' },
    description: 'Self-hosted backup manager for WordPress sites',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
            <body className="min-h-screen bg-background antialiased">{children}</body>
        </html>
    );
}
