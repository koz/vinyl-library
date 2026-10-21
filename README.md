# Vinyl Library

Browse the vinyl in your Discogs collection. Built with TanStack Start, React and TypeScript. No database.

## Setup

1. Register an application at <https://www.discogs.com/settings/developers> and set its callback URL to `http://localhost:3000/auth/discogs/callback`.
2. Copy `.env.example` to `.env` and fill in the Discogs consumer key/secret and a `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`).
3. Run `npm install`, then `npm run dev`, and open <http://localhost:3000>.

## How it works

- **Sign-in:** Discogs OAuth 1.0a, handled on the server (`src/routes/auth/discogs`). The Discogs access token is kept in an AES-256-GCM encrypted, HTTP-only cookie that lasts 30 days (`src/server/session.server.ts`). Browser JavaScript can’t read it, and the server holds no per-user state.
- **Collection:** Discogs can’t filter by format or sort by artist then title. The browser asks the server for each page of the collection; the server returns only the vinyl entries, and the browser sorts the full list once every page has arrived. The sorted list is saved in the browser (IndexedDB), so the next visit shows it straight away while a refresh runs.
- **Shelf:** the collection is shown as records standing on wooden shelves, drawn with three.js in one fixed, full-viewport canvas (`src/components/shelf`). WebGPU uses `WoodNodeMaterial` with reference-based oak fiber color, relief and roughness; the WebGL backend uses the same texture maps. The supplied reference is saved in `src/assets/oak-fibers.jpg`, with brightness 1.4, warmth 0.3, grain density 2.55, roughness 0.7 and no surface relief. Each shelf gets a random grain position that stays fixed while scrolling. Texture coordinates preserve the grain's physical scale across plank faces and viewport sizes. The page lays out invisible slot buttons, and each frame the 3D sleeves are placed over them, so scrolling, hovering, keyboard focus and clicks all stay in the DOM. Sleeves are only created, and their covers only loaded, while they are near the viewport. Clicking a sleeve brings it to the front, slides the record 30% out and spins it at 33⅓ rpm. If neither graphics backend is available, the page falls back to a plain list.
- **Covers** are fetched through `/api/cover`, a same-origin proxy limited to `i.discogs.com`, because Discogs images have no CORS headers and WebGL can't read them otherwise.
- **Sign out** clears the cookie. **Disconnect** also deletes the collection saved in that browser. Neither affects other devices or Discogs itself; users can revoke access everywhere in their Discogs application settings.

## Scripts

- `npm run dev`: development server
- `npm run build`: production build
- `npm run typecheck`, `npm test`

## Spotify embed proof of concept

Run `npm run dev`, open a record on the shelf, and paste a Spotify **album** link into “Listen on Spotify”. The player attempts to start playback; browsers may require pressing play inside Spotify’s player. If the controller doesn't become ready, it falls back to a standard embed and offers “Reload player”. Closing the record stops playback. Spotify determines whether full tracks or previews are available to the listener.

For automatic matching, add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from a Spotify developer app to `.env`, then restart the server. `SPOTIFY_MARKET` defaults to `NL`. Credentials and application tokens stay on the server; visitors don’t authorize Spotify with this app. Spotify developer access and quota restrictions still apply to searches.

Only the selected record is searched. Artist/title matches are ranked, with year used as a small tie-breaker. An exact artist/title match with a clear lead is selected automatically. Listings with the same normalized title, complete artist credits, and release year are treated as one candidate for this decision: the first listing wins. Distinct albums with close scores still show a list to choose from. “Change album” also accepts a pasted album URL or `spotify:album:` URI. Pressing and digital release years can differ, so year is never a required match. Tracklist/barcode matching and cross-device storage are outside this proof of concept.

Matches are saved by Discogs release ID in localStorage, separately from collection imports, and survive refreshes in that browser. “Disconnect and delete app data” removes them. If browser storage is unavailable, playback still works for the current visit. The prototype lives in `src/components/SpotifyAlbumPrototype.tsx` on `codex/spotify-embed-poc`; the question to validate is whether conservative matching plus a manual correction gives a useful listening experience. Actual full-track playback needs verification in your Spotify session.

Validated locally: pasting ABBA’s Arrival loaded the album and started playback; closing paused it, and the saved match survived reopening and reloading. Desktop and 390px mobile layouts were inspected. Matching and search handling were exercised with mocked Spotify responses (including ambiguous editions, token reuse, fallback search, and 403/429 responses). After configuring Spotify credentials, live catalog matching and playback were verified for Alabama Shakes’ Sound & Color.
