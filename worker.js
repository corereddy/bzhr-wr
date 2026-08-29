/**
 * Cloudflare Worker using Browser Rendering (real headless Chrome via
 * @cloudflare/puppeteer) to replicate the original Playwright flow:
 *
 *   1. Navigate to the page with a real browser.
 *   2. Wait for the htmx download button: a[hx-get*="/download"]
 *   3. In-page, fetch the hx-get endpoint with HX-Request / HX-Current-URL
 *      headers and read back the HX-Redirect response header.
 *
 * REQUIREMENTS:
 *   - Workers Paid plan (Browser Rendering requires it).
 *   - `npm install @cloudflare/puppeteer` in your worker project.
 *   - A Browser Rendering binding in wrangler.toml (see wrangler.toml below).
 *
 * IMPORTANT CAVEAT: Browser Rendering sessions still originate from
 * Cloudflare's own network/IP ranges. If buzzheavier's Bot Management is
 * blocking based on ASN/IP reputation (not just JS-fingerprinting), a real
 * browser here may still get challenged or blocked. This gets you past
 * pure "no-JS / fingerprint-only" blocks, not IP-reputation blocks.
 *
 * Usage:  GET https://your-worker.example.workers.dev/?url=https://example.com/some-page
 */

import puppeteer from '@cloudflare/puppeteer';

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

    let browser;
    try {
      browser = await puppeteer.launch(env.MYBROWSER);
      const direct = await getDirectUrl(browser, parsed.toString());
      return json({ url: targetUrl, direct });
    } catch (err) {
      return json({ error: err.message || 'Unknown error', url: targetUrl }, 500);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};

async function getDirectUrl(browser, url) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector('a[hx-get*="/download"]', { timeout: 10000 });

    const direct = await page.evaluate(async () => {
      try {
        const btn = document.querySelector('a[hx-get*="/download"]');
        if (!btn) return null;

        const res = await fetch(window.location.origin + btn.getAttribute('hx-get'), {
          headers: {
            'HX-Request': 'true',
            'HX-Current-URL': window.location.href,
          },
        });

        return res.headers.get('HX-Redirect');
      } catch {
        return null;
      }
    });

    return direct;
  } finally {
    await page.close();
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
