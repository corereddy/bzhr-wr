export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing "id" query parameter' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const browserlessUrl = env.BROWSER_WS_ENDPOINT;
    if (!browserlessUrl) {
      return new Response(JSON.stringify({ error: 'BROWSER_WS_ENDPOINT is missing' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert wss:// URL to https:// REST API endpoint
    const parsedWsUrl = new URL(browserlessUrl);
    const token = parsedWsUrl.searchParams.get('token');
    const apiUrl = `https://${parsedWsUrl.host}/function?token=${token}`;

    try {
      // Browserless runs this Puppeteer script on their server
      const code = `
        export default async function({ page }) {
          await page.goto('https://buzzheavier.com/${id}', { waitUntil: 'domcontentloaded' });
          
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

          return {
            data: { redirectUrl },
            type: 'application/json'
          };
        }
      `;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/javascript',
        },
        body: code,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(JSON.stringify({ error: errorText }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const result = await response.json();
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
