# Visited Buildings map

A single-page web app that colors in buildings we have visited, mainly in Kobe, Japan.
Anyone with the link can view the map. Invited editors sign in to add, recolor, rename or remove buildings.

- Live site: https://capnseaaa.github.io/visitedmaps/
- Repo: https://github.com/capnseaaa/visitedmaps (branch `main`)
- Deploy: every push to `main` runs `.github/workflows/pages.yml`, which publishes the repo root to GitHub Pages. No build step.

## Working with the owner

- Never fake a service, response or test result. If something cannot be reached or checked, say so plainly and give the owner exact steps to test it.
- Say "I do not know" instead of guessing. Mark anything from memory that could not be checked.
- Do not flatter or agree by default. Give direct, objective critique.
- Write replies in short, plain subject-verb-object sentences (aim for very easy reading). Each idea should lead into the next.
- The owner mostly uses an iPhone (Chrome). Give tap-by-tap steps for anything they must do by hand.
- Do not delete or change anything in the Supabase project that belongs to "snail mail" (see below).

## Files

| File | What it does |
|---|---|
| `index.html` | The whole app: layout, styles and script. |
| `basemap.js` | English base map: GSI vector shapes plus OpenStreetMap English labels. |
| `supabase/visited_buildings.sql` | Database setup for the shared map (tables, rules, live updates). Safe to re-run. |
| `manifest.webmanifest`, `icons/` | Lets the page be added to a phone home screen as an app. |
| `preview.html` | Old side-by-side test page for the base map. Can be deleted. |
| `.github/workflows/pages.yml` | GitHub Pages deploy. |

## Outside services (all called from the browser, no keys except Supabase's public key)

| Service | Host | Used for |
|---|---|---|
| GSI optimised vector tiles (PMTiles) | cyberjapandata.gsi.go.jp | Map shapes. Data has Japanese names only, so its labels are hidden. Marked as a trial by GSI. Falls back to GSI "pale" picture tiles if the vector map cannot start. |
| OpenFreeMap | tiles.openfreemap.org | English labels. Only the `name:latin` field is used; places without one get no label. |
| GSI address search | msearch.gsi.go.jp | Japanese address lookup. |
| Overpass API | overpass-api.de (+ backups overpass.kumi.systems, overpass.private.coffee) | Building outlines and their tags, within 30 m of a point. Often slow. |
| Nominatim (OpenStreetMap search) | nominatim.openstreetmap.org | Name search, reverse search for building names, Google-address resolution. Limit: 1 request per second (the code waits). |
| Tesseract.js, exifr | cdn.jsdelivr.net | Photo text reading (Japanese + English) and photo GPS. Loaded only when a photo is picked. |
| Supabase | ywnzfpaxyuvanipbinzh.supabase.co | Shared storage, sign-in, live updates. |
| Libraries | unpkg.com, cdn.jsdelivr.net | Leaflet 1.9.4, Turf 6.5.0, MapLibre GL 4.7.1, pmtiles 4.4.1, maplibre-gl-leaflet 0.1.4, supabase-js 2.118.0. Pinned versions. |

## How adding works

Input in the search bar goes through `geocode()` in this order: Google Maps link → plain coordinates → Plus Code → loose coordinates in text → GSI address search.
- Google short links (`maps.app.goo.gl`) cannot be read by a web page (Google sends no CORS headers). An iPhone Shortcut expands them and opens `?add=<long link>`.
- Expanded Google links often have no coordinates, only an English address like `Kōbe Hankyū, 8 Chome-1-8 Onoedori, Chuo Ward, Kobe, Hyogo 651-8511, Japan`. `resolveGoogleQuery()` turns `8 Chome-1-8 Onoedori` into `Onoedori 8-chome`, finds that block with Nominatim, then searches the name near it.
- `findBuilding()` asks Overpass for building outlines; `buildingName()` picks the label: English tag on the outline → the searched name → Nominatim reverse → local name → "Building in <area>".
- Other ways in: long-press the map, the 📷 photo panel, `?add=` in the page address.

## Supabase

- Project: "snail mail", ref `ywnzfpaxyuvanipbinzh`, region ap-northeast-1 (Tokyo).
- This project also holds the unrelated **snail mail** app: 33 tables, 25 functions, 1 user, seed data. Leave all of it alone. The map uses only the objects below.
- Map objects (from `supabase/visited_buildings.sql`):
  - `public.visited_buildings`: one row per building (`id, way_id, label, lat, lng, coords jsonb, approx, color, visit_date, added_by, added_by_email, created_at, updated_at`). Unique `way_id` stops duplicates.
  - `public.map_editors(email)`: who may edit. No policies, so the page cannot read it.
  - `public.is_map_editor()`: true when the signed-in email is in `map_editors`.
  - Rules: anyone (anon) can read buildings; only signed-in editors can insert, update or delete. Table is in the `supabase_realtime` publication for live updates.
- Page config: URL `https://ywnzfpaxyuvanipbinzh.supabase.co`, publishable key in `index.html` (`sb_publishable_…`). The publishable key is public by design. Never put a secret or service_role key in the page.
- Manage editors (SQL Editor in the Supabase dashboard):
  ```sql
  insert into public.map_editors (email) values ('someone@example.com');   -- lowercase
  delete from public.map_editors where email = 'someone@example.com';
  ```
- Sign-in: email link (`signInWithOtp`, implicit flow so the link works in any browser). Sign-ups stay open because snail mail may need them; the editor list is what limits editing.
- Auth settings are shared with snail mail. `site_url` is `http://localhost:3000` (left as is). The map's address must be in Authentication → URL Configuration → Redirect URLs.
- The project has no custom email (SMTP) set up. The built-in sender allows about 2 emails per hour, and may only send to members of the Supabase organization (not verified). Invited editors outside the organization will likely need custom SMTP.

## Testing

- Serve the repo root locally (`python3 -m http.server 8766`) and drive it with Playwright (Chromium; use `--use-angle=swiftshader` for the vector map).
- Test against real services. If a service is unreachable, report it and ask the owner to test that part on their phone.
- Database rules can be tested inside a transaction with `set local role authenticated; set local request.jwt.claims = '{"email": ...}'` and then rolled back.
- Things only the owner can test: email sign-in, the iPhone Shortcut, photo location from the iPhone photo picker, home-screen install.

## Known problems and next steps

1. **Photo reader is weak.** Tesseract misreads real signs and offers names that do not exist. Better: a Supabase Edge Function that sends the photo to a vision model (for example Claude) and returns the building name. Needs an API key stored as an Edge Function secret, never in the page.
2. **Search misses many Kobe buildings.** Nominatim's coverage of Japanese building names is thin. Options: Overpass name search near the map view (free, flaky), or Google Places Text Search through an Edge Function (best coverage, needs a Google API key and has usage costs).
3. Buildings added by long-press often get a Japanese or shop name from reverse search. Editors can rename.
4. Dark mode changes the controls but not the map style.
5. Custom SMTP for sign-in emails (see Supabase above).
