import puppeteer from 'puppeteer-core';

export default {
  async fetch(request, env, ctx) {
    // 1. Get the 'id' parameter from the request URL
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing 'id' query parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Define your custom external CDP endpoint
    // (Replace with your actual endpoint or use env.CUSTOM_CDP_URL)
    const CUSTOM_CDP_URL = 'ws://your-custom-browser-ip:3000'; 

    let browser;
    try {
      // 3. Connect to your external Chromium instance
      browser = await puppeteer.connect({
        browserWSEndpoint: CUSTOM_CDP_URL,
      });

      const page = await browser.newPage();
      
      // 4. Navigate to the buzzheavier page using the dynamic ID
      await page.goto(`https://buzzheavier.com/{id}`, {
        waitUntil: 'domcontentloaded'
      });

      // 5. Execute your custom asynchronous HTMX evaluation script
      const redirectUrl = await page.evaluate(async () => {
        try {
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
        } catch (e) {
          return null;
        }
      });

      // 6. Clean up the browser context
      await browser.close();

      // 7. Return the extracted redirect URL
      return new Response(JSON.stringify({ id, redirectUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      // Ensure browser closes even if navigation or evaluation fails
      if (browser) await browser.close();

      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  },
};
