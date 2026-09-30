import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], weight: ['600', '700', '800'], variable: '--font-display' });
const body = Figtree({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'LIVE-IN Práčovňa',
  description: 'Balenie bielizne pre byty LIVE-IN v Bratislave',
  icons: { icon: '/assets/live-in-logo.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F2F0' },
    { media: '(prefers-color-scheme: dark)', color: '#141312' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="sk" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
