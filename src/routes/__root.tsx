import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { ThemeProvider } from '@/components/theme-provider'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'CSV Diff Viewer',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: 'csv diff view',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: './favicon-96x96.png',
        sizes: '96x96',
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: './favicon.svg',
      },
      {
        rel: 'shortcut icon',
        href: './favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: './apple-touch-icon.png',
      },
      {
        rel: 'manifest',
        href: './site.webmanifest',
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storageKey = 'theme';
                  var defaultTheme = 'system';
                  var theme = localStorage.getItem(storageKey) || defaultTheme;
                  var root = document.documentElement;
                  
                  root.classList.remove('light', 'dark');

                  if (theme === 'system') {
                    var systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                    root.classList.add(systemTheme);
                  } else {
                    root.classList.add(theme);
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="theme">
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
