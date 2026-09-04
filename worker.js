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
          await page.goto('https://buzzheavier.com/${id}', { 
            waitUntil: 'networkidle0',
            timeout: 30000 
          });

          // 1. Wait for the download button or any link containing /download
          await page.waitForSelector('a[hx-get*="/download"], a[href*="/download"], button[hx-get*="/download"]', { 
            timeout: 10000 
          }).catch(() => null);

          // 2. Extract and trigger the download endpoint
          const redirectUrl = await page.evaluate(async () => {
            const btn = document.querySelector('a[hx-get*="/download"], button[hx-get*="/download"]');
            
            if (btn) {
              const endpoint = btn.getAttribute("hx-get");
              const targetUrl = endpoint.startsWith("http") ? endpoint : (window.location.origin + endpoint);

              const res = await fetch(targetUrl, {
                method: "GET",
                redirect: "manual",
                headers: {
                  "HX-Request": "true",
                  "HX-Current-URL": window.location.href
                }
              });

              // Check HX-Redirect header
              const hxRedirect = res.headers.get("HX-Redirect") || res.headers.get("hx-redirect");
              if (hxRedirect) return hxRedirect;

              // Check Location header if standard 3xx redirect
              const locationHeader = res.headers.get("location");
              if (locationHeader) return locationHeader;
            }

            // Fallback: Check if there is a direct href link already present
            const directLink = document.querySelector('a[href*="/download/"], a[download]');
            if (directLink) {
              return directLink.href;
            }

            return null;
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
