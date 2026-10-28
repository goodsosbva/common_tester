const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const actual=JSON.parse(fs.readFileSync('.local/remote-native-check.json','utf8'));
 const pair=JSON.parse(fs.readFileSync('.local/remote-url-check.json','utf8'));
 const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:5173/?run=${actual.run_id}&execution=${actual.execution_id}`);
 await expect(page.locator('.report-overview')).toContainText(actual.execution_id);
 await expect(page.locator('.report-overview')).toContainText(actual.target_url);
 await expect(page.locator('.case-card')).toHaveCount(6);
 const first=page.locator('.case-card').first();await first.locator('summary').first().click();
 await expect(first.locator('.screenshot img')).toBeVisible();
 await first.locator('.screenshot').first().click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect.poll(()=>page.getByRole('dialog').locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
 await page.keyboard.press('Escape');
 fs.mkdirSync('docs/user-guide-assets',{recursive:true});
 await page.locator('.report-overview').screenshot({path:'docs/user-guide-assets/remote-results.png'});
 await page.locator('.preparation > summary').click();
 await page.locator('.setup-grid select').selectOption('portfolio/v1');
 await page.getByLabel('대상 앱 URL',{exact:true}).fill(actual.target_url);
 await page.locator('.preparation').screenshot({path:'docs/user-guide-assets/remote-settings.png'});
 const mismatch=pair.jobs.mismatch;
 await page.goto(`http://127.0.0.1:5173/?run=${mismatch.run_id}&execution=${mismatch.execution_id}`);
 await expect(page.locator('.report-overview h2')).toHaveText('이 앱에서 실행할 수 있는 상황이 없습니다');
 await expect(page.locator('.report-overview .badge')).toHaveText('미실행');
 await expect(page.locator('.report-overview .badge')).not.toHaveClass(/passed/);
 await expect(page.locator('.case-card.unsupported')).toHaveCount(4);
 await page.locator('.report-overview').screenshot({path:'docs/user-guide-assets/remote-unsupported.png'});
 await page.setViewportSize({width:390,height:844});
 const size=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert(size[0]<=size[1]);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('.local/remote-ui-check.json',JSON.stringify({actual_url_visible:true,actual_screenshots:true,portfolio_selectable:true,unsupported_not_passed:true,mobile_no_overflow:true,page_errors:errors},null,2));
 console.log('PASS: remote result, screenshot, portfolio selection, zero-test UI and mobile layout');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
