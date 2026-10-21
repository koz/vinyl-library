import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import appCss from '../styles.css?url'
import { ButtonLabel } from '../components/ButtonLabel'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#f5f2ec' },
      { title: 'Vinyl Library' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <Message title="Page not found" body="This page doesn’t exist." />
  ),
  errorComponent: () => (
    <Message title="Something went wrong" body="Please reload the page and try again." />
  ),
})

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="sign-in">
      <div className="sign-in-panel">
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <a className="button" href="/">
          <ButtonLabel>Go to Vinyl Library</ButtonLabel>
        </a>
      </div>
    </main>
  )
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
