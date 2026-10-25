import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import './globals.css';
import './livein-theme.css'
import './workspace.css';

const display = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], weight: ['600', '700', '800'], variable: '--font-display' });
const body = Figtree({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'LIVE-IN Práčovňa',
  description: 'Balenie bielizne pre byty LIVE-IN v Bratislave',
  // metadata Next neprefixuje basePath, preto celé cesty
  icons: { icon: '/pracovna/icons/icon-192.png', apple: '/pracovna/icons/apple-touch-icon.png' },
  manifest: '/pracovna/manifest.webmanifest',
  // on an iPhone push notifications work only from the app added to the home screen
  appleWebApp: { capable: true, title: 'Práčovňa', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#173E2C' },
    { media: '(prefers-color-scheme: dark)', color: '#173E2C' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="sk" data-theme="light" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
