# Nyx website

The website is served by `src/health-server.js`. Shared HTML is in `src/website.js`, styles and browser behavior are in `web/site.css` and `web/site.js`, and update entries are in `web/changelog.json`. `src/health-page.js` and `src/status-page.js` expose the public templates. The dashboard retains its existing bearer-token authentication and private API; its UI comes from `src/dashboard-page.js` and the shared wrapper.

Run `npm test`, `npm run check`, `node scripts/home-fixes-check.cjs`, `node scripts/artwork-check.cjs`, and `node scripts/site-check.cjs` (also available through `npm run test:website`). The browser script starts an isolated server with an in-memory synthetic credential and saves all screenshots and its report under the OS temporary directory, outside the repository. It never reads deployment credentials. Browser HTTP diagnostics for intentional 401, 404 and 503 responses are recorded separately from unexpected console errors.

`/api/commands` derives public slash-command documentation from the actual registry. Owner-only and hidden entries are omitted. Public playback rendering selects title, artist, an approved cover, duration and progress from `/api/now-playing`. This separate public payload omits server, channel, requester and stream URL fields. HTTPS artwork is validated on the server and in the browser, accepting only `i.ytimg.com`, `img.youtube.com`, and `i.scdn.co`. Tiny YouTube images are upgraded to hqdefault; missing or failed images keep the mark placeholder. All live images use no-referrer, lazy loading and asynchronous decoding. Fictional demo covers are generated as local SVG data URLs from the title seed and a per-load palette/design variant. The `/healthz` response contract remains unchanged. None of the demos call playback APIs or send messages.

Both themes share semantic controls, focus rings, no-flash theme initialization and reduced-motion handling. Public page prefetch is allowlisted; the dashboard and APIs are never prefetched. All pages carry noindex metadata and response headers until explicitly enabled for indexing. The robots file intentionally allows crawling so noindex can be read.

Icons and page-specific Open Graph artwork are generated with `python scripts/generate-site-assets.py` (Pillow), using the existing eight-spoke mark. No image-generation service or external asset dependency is required.

## Changelog

`web/changelog.json` is generated, not edited by hand. On every push to `main`, `.github/workflows/changelog.yml` runs `node scripts/generate-changelog.cjs`, which reads the commits and groups them by day. The commit prefix picks the category: `add:` Added, `improve:` Improved, `fix:` Fixed, `remove:` Removed, `change:` Changed; anything else is Changed. Merges, "update readme" and the workflow's own `chore: update changelog [skip ci]` commits are skipped. Entries without `"auto": true` are hand-written and kept as they are.

The changelog page loads the live file from GitHub (`CHANGELOG_URL`, default `https://raw.githubusercontent.com/deabz/music/main/web/changelog.json`) so it updates without redeploying the bot, and falls back to the bundled `/changelog.json`. Set `CHANGELOG_URL=` (empty) to only use the bundled file.
