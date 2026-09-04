import { chromium } from 'playwright-core';

export default {
  async fetch(request, env, ctx) {
    // 1. Extract the "id" parameter from the request URL
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing "id" query parameter (e.g., ?id=123)' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // 2. Validate the remote WebSocket endpoint
    const wsEndpoint = "wss://production-sfo.browserless.io?token=2VCGARGwme2LmgAde3e547f037305d9721120664337acf42d";
    if (!wsEndpoint) {
      return new Response(JSON.stringify({ error: 'BROWSER_WS_ENDPOINT environment variable is missing' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let browser;
    try {
      // 3. Connect to the remote browser
      browser = await chromium.connect(wsEndpoint);
      const page = await browser.newPage();

      // 4. Navigate to the target URL
      await page.goto(`https://buzzeavier.com/${id}`, { 
        waitUntil: 'domcontentloaded' 
      });

      // 5. Execute the injected script
      const redirectUrl = await page.evaluate(async () => {
        const btn = document.querySelector('a[hx-get*="/download"]');
        if (!btn) return null;

        const res = await fetch(
          window.location.origin + btn.getAttribute("hx-get"),
          {
            headers: {
              "HX-Request": "true",
              "HX-Current-URL": window.location.href
            }
          }
        );

        return res.headers.get("HX-Redirect");
      });

      // 6. Return the scraped redirect URL
      return new Response(JSON.stringify({ redirectUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    } finally {
      // Clean up the connection to avoid memory/socket leaks
      if (browser) {
        await browser.close();
      }
    }
  }
};
