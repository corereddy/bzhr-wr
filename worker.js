/**
 * Cloudflare Worker: resolves the direct download URL from a buzzheavier-style
 * htmx page, using two external services to get around Cloudflare bot
 * protection (since Workers' own IPs get blocked):
 *
 *   1. Firecrawl (https://firecrawl.dev) scrapes the page HTML on your behalf,
 *      using their own scraping infrastructure/anti-bot handling.
 *   2. From that HTML, extract the <a hx-get="..."> download endpoint.
 *   3. Fetch that endpoint through Corsfix's proxy (https://corsfix.com),
 *      sending the HX-Request / HX-Current-URL headers, and read back
 *      the HX-Redirect response header.
 *
 * REQUIRED SECRETS (set via `wrangler secret put NAME`):
 *   - FIRECRAWL_API_KEY   your Firecrawl API key (fc-...)
 *   - CORSFIX_KEY         your Corsfix API key (cfx_...) — optional if you've
 *                         whitelisted your domain in the Corsfix dashboard
 *                         instead; falls back to no key if unset.
 *
 * Usage: GET https://your-worker.example.workers.dev/?url=https://buzzheavier.com/xxxx
 */

const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';
const CORSFIX_PROXY = 'https://proxy.corsfix.com/?';

export default {
  async fetch(request, env) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return json({ error: 'Missing "url" query parameter' }, 400);
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return json({ error: 'Invalid "url" parameter' }, 400);
    }

    try {
      const html = await scrapeWithFirecrawl(parsed.toString());
      const hxGet = extractHxGet(html);

      if (!hxGet) {
        return json({
          url: targetUrl,
          direct: null,
          note: 'No hx-get download link found in the scraped HTML.',
          htmlPreview: html.slice(0, 1500),
        });
      }

      const origin = parsed.origin;
      const downloadUrl = /^https?:\/\//i.test(hxGet) ? hxGet : new URL(hxGet, origin).toString();

      const direct = await fetchHxRedirect(downloadUrl, parsed.toString());

      return json({ url: targetUrl, direct });
    } catch (err) {
      return json({ error: err.message || 'Unknown error', url: targetUrl }, 500);
    }
  },
};

/**
 * Calls Firecrawl's /v2/scrape endpoint and returns the page HTML.
 */
async function scrapeWithFirecrawl(url) {
  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      onlyMainContent: true,
      maxAge: 172800000,
      parsers: ['pdf'],
      formats: ['html'],
    }),
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(`Firecrawl request failed (${res.status}): ${body.slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Firecrawl returned non-JSON response: ${body.slice(0, 500)}`);
  }

  const html = parsed?.data?.html;
  if (!html) {
    throw new Error(`Firecrawl response had no html field: ${body.slice(0, 500)}`);
  }

  return html;
}

/**
 * Extracts the hx-get attribute value from the first <a> tag whose
 * hx-get contains "/download".
 */
function extractHxGet(html) {
  const regex = /<a\b[^>]*\bhx-get\s*=\s*["']([^"']*\/download[^"']*)["'][^>]*>/i;
  const match = html.match(regex);
  return match ? match[1] : null;
}

/**
 * Fetches the download endpoint through Corsfix's proxy (keyless — relies on
 * your Worker's outbound domain being whitelisted in the Corsfix dashboard
 * at https://app.corsfix.com/applications), sending the same headers htmx
 * would send, and returns the HX-Redirect response header.
 */
async function fetchHxRedirect(downloadUrl, currentUrl) {
  const proxiedUrl = CORSFIX_PROXY + downloadUrl;

  const res = await fetch(proxiedUrl, {
    headers: {
      'HX-Request': 'true',
      'HX-Current-URL': currentUrl,
    },
  });

  const redirect = res.headers.get('HX-Redirect');
  if (redirect) return redirect;

  // If the header didn't come through, surface enough info to debug —
  // some proxies don't forward non-standard response headers by default.
  const bodyPreview = (await res.text()).slice(0, 500);
  throw new Error(
    `No HX-Redirect header in Corsfix proxy response (status ${res.status}). ` +
      `Response headers: ${JSON.stringify([...res.headers.entries()])}. ` +
      `Body preview: ${bodyPreview}`
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
