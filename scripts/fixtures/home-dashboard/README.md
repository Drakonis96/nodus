# Home dashboard renderer checks

Run `npm run verify:home-dashboard` to render the nine Home views with deterministic local fixtures. The fixture mounts the production React components and compiles the production Tailwind stylesheet. It substitutes only the desktop API and navigation callbacks; it does not open or modify a vault or contact AI providers.

The runner checks both themes at 1024, 1280, 1440 and 1920 px, then stresses the academic and genealogy cards in every UI language with a 360 px sidebar and 130% interface scale. It checks horizontal overflow, clipped titles and metric labels, title/action overlap, neutral surfaces, top accents, compact button styles, a navigation callback, badge backgrounds, and empty/demo states.

On macOS it uses installed Google Chrome. Set `CHROME_PATH` to use another Chromium executable. On other platforms it uses Playwright's installed Chromium.

To save full-height screenshots and an HTML comparison gallery:

```sh
NODUS_HOME_SCREENSHOTS=/absolute/output/directory npm run verify:home-dashboard
```

Screenshots contain sample data and the real Home content without the app's sidebar. The additional academic 1280 px capture reserves the default 176 px sidebar width. Screenshot-only height changes expose the full scrollable view; layout assertions run at the normal application height.
