import type { Metadata } from 'next';
import './globals.css';
import './theme.css';
import './viewport.css';
import './polish.css';
import { ThemeProvider } from '../components/theme-provider';

export const metadata: Metadata = {
  title: 'Veriqon | Knowledge workspace',
  description: 'An evidence-first workspace for your self-correcting RAG pipeline.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A constant, first-paint script; no user-controlled values are interpolated.
  const themeScript = `(function(){var t='dark';try{var p=localStorage.getItem('veriqon-theme');if(p==='light'||p==='dark')t=p;else if(p==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()`;
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
