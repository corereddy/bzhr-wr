import puppeteer from 'puppeteer-core';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing "id" query parameter (e.g., ?id=123)' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const wsEndpoint = env.BROWSER_WS_ENDPOINT;
    if (!wsEndpoint) {
      return new Response(JSON.stringify({ error: 'BROWSER_WS_ENDPOINT environment variable is missing' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let browser;
    try {
      // Connect to the remote WebSocket endpoint
      browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
      });

      const page = await browser.newPage();

      // Navigate to target
      await page.goto(`https://buzzeavier.com/${id}`, { 
        waitUntil: 'domcontentloaded' 
      });

      // Execute the script in page context
      const redirectUrl = await page.evaluate(async () => {
        const btn = document.querySelector('a[hx-get*="/download"]');
        if (!btn) return null;

        const res = await fetch(
          window.location.origin + btn.getAttribute('hx-get'),
          {
            headers: {
              'HX-Request': 'true',
              'HX-Current-URL': window.location.href,
            },
          }
        );

        return res.headers.get('HX-Redirect');
      });

      return new Response(JSON.stringify({ redirectUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};
