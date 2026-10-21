# Vinyl Library

Browse the vinyl in your Discogs collection. Built with TanStack Start, React and TypeScript. No database.

## Setup

1. Register an application at <https://www.discogs.com/settings/developers> and set its callback URL to `http://localhost:3000/auth/discogs/callback`.
2. Copy `.env.example` to `.env` and fill in the Discogs consumer key/secret and a `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
3. Run `npm install`, then `npm run dev`, and open <http://localhost:3000>.

## How it works

- **Sign-in:** Discogs OAuth 1.0a, handled on the server (`src/routes/auth/discogs`). The Discogs access token is kept in an AES-256-GCM encrypted, HTTP-only cookie that lasts 30 days (`src/server/session.server.ts`). Browser JavaScript can’t read it, and the server holds no per-user state.
- **Collection:** Discogs can’t filter by format or sort by artist then title. The browser asks the server for each page of the collection; the server returns only the vinyl entries, and the browser sorts the full list once every page has arrived. The sorted list is saved in the browser (IndexedDB), so the next visit shows it straight away while a refresh runs.
- **Sign out** clears the cookie. **Disconnect** also deletes the collection saved in that browser. Neither affects other devices or Discogs itself; users can revoke access everywhere in their Discogs application settings.

## Scripts

- `npm run dev`: development server
- `npm run build`: production build
- `npm run typecheck`, `npm test`
