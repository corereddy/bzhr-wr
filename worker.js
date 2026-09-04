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

    const parsedWsUrl = new URL(browserlessUrl);
    const token = parsedWsUrl.searchParams.get('token');
    const apiUrl = `https://${parsedWsUrl.host}/function?token=${token}`;

    try {
      const code = `
        export default async function({ page }) {
          // Set standard desktop user agent to avoid headless bot detection
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
          
          const targetUrl = 'https://buzzheavier.com/${id}';
          console.log('Navigating to:', targetUrl);
          
          await page.goto(targetUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 
          });

          // Wait for download trigger
          await page.waitForSelector('a[hx-get*="/download"], button[hx-get*="/download"], a[href*="/download"]', { 
            timeout: 8000 
          }).catch(() => console.log('Selector timeout: checking DOM directly'));

          const direct = await page.evaluate(async () => {
            try {
              const btn = document.querySelector('a[hx-get*="/download"], button[hx-get*="/download"]');
              if (!btn) {
                // Fallback to regular link href if HTMX attribute is absent
                const fallbackLink = document.querySelector('a[href*="/download"]');
                return fallbackLink ? fallbackLink.href : null;
              }

              const path = btn.getAttribute("hx-get");
              const requestUrl = path.startsWith("http") ? path : (window.location.origin + path);

              const res = await fetch(requestUrl, {
                headers: {
                  "HX-Request": "true",
                  "HX-Current-URL": window.location.href
                }
              });

              return res.headers.get("HX-Redirect") || res.headers.get("Location");
            } catch (e) {
              return null;
            }
          });

          console.log('Resolved direct URL:', direct);

          return {
            data: { targetUrl, directUrl: direct },
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
