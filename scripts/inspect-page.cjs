const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const [target, directory] = process.argv.slice(2);
  const validate = value => { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('HTTP/HTTPS 주소가 필요합니다.'); return url; };
  validate(target);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    validate(page.url());
    if (!response || response.status() >= 400) throw Error(`대상 응답 상태: ${response?.status() ?? '없음'}`);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const captured = await page.evaluate(() => {
      const dom = document.documentElement.cloneNode(true);
      dom.querySelectorAll('script,style,noscript').forEach(node => node.remove());
      dom.querySelectorAll('input').forEach(element => { element.removeAttribute('value'); });
      const html = dom.outerHTML;
      const controls = Array.from(document.querySelectorAll('input,select,textarea,button,[role="button"],[role="combobox"],[data-testid]'));
      const links = Array.from(document.querySelectorAll('a[href]'));
      return {
        html: html.slice(0, 1000000), html_truncated: html.length > 1000000,
        elements: controls.slice(0, 1000).map(element => ({
          tag: element.tagName.toLowerCase(), id: element.id || null,
          role: element.getAttribute('role'), name: element.getAttribute('name'),
          type: element.getAttribute('type'), test_id: element.getAttribute('data-testid'),
          aria_label: element.getAttribute('aria-label'),
          labels: Array.from(element.labels || []).map(label => label.textContent.trim()),
          text: (element.innerText || '').trim().slice(0, 500),
          disabled: element.matches(':disabled'), required: element.required || false,
          options: element.tagName === 'SELECT' ? Array.from(element.options).map(option => ({ value: option.value, label: option.label })) : undefined,
        })),
        elements_truncated: controls.length > 1000,
        links: links.slice(0, 500).map(link => ({ text: (link.innerText || '').trim().slice(0, 300), href: link.href })),
        links_truncated: links.length > 500,
      };
    });
    const accessibility = await page.locator('body').ariaSnapshot({ timeout: 10000 });
    const metadata = { requested_url: target, final_url: page.url(), title: await page.title(), http_status: response.status(), captured_at: new Date().toISOString(), html_file: 'target-page.html', reference_file: 'target-page.json' };
    const { html, ...reference } = captured;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, metadata.html_file), html);
    fs.writeFileSync(path.join(directory, metadata.reference_file), JSON.stringify({ ...metadata, ...reference, accessibility: accessibility.slice(0, 150000), accessibility_truncated: accessibility.length > 150000 }, null, 2));
    process.stdout.write(JSON.stringify(metadata));
  } finally { await browser.close(); }
})().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
