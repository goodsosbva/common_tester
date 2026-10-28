import { test, expect } from '../../../../playwright-observations';

const target = process.env.COMMON_TESTER_TARGET_URL || 'http://goodsosbva1.dothome.co.kr/';

test('CONNECT_001@requirements.md:4-ALLOW-1 첫 화면 제목과 주 제목', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  await expect(page).toHaveTitle('권현성 — Frontend Developer');
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();
});

test('CONNECT_002@requirements.md:5-ALLOW-1 작업 메뉴 이동', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  const link = page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '작업', exact: true });
  await expect(link).toHaveAttribute('href', '#work');
  await link.click();
  await expect(page).toHaveURL(/#work$/);
  await expect(page.getByRole('heading', { name: '고친 문제 세 가지', exact: true })).toBeVisible();
});

test('CONNECT_003@requirements.md:6-ALLOW-1 경력 메뉴 이동', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  const link = page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '경력', exact: true });
  await expect(link).toHaveAttribute('href', '#career');
  await link.click();
  await expect(page).toHaveURL(/#career$/);
  await expect(page.getByRole('heading', { name: '경력', exact: true })).toBeVisible();
});

test('CONNECT_004@requirements.md:7-ALLOW-1 기술 메뉴 이동', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  const link = page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '기술', exact: true });
  await expect(link).toHaveAttribute('href', '#skills');
  await link.click();
  await expect(page).toHaveURL(/#skills$/);
  await expect(page.getByRole('heading', { name: '기술 스택', exact: true })).toBeVisible();
});

test('CONNECT_005@requirements.md:8-ALLOW-1 연락 메뉴 이동', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  const link = page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '연락', exact: true });
  await expect(link).toHaveAttribute('href', '#contact');
  await link.click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.getByRole('heading', { name: '함께 일할 이야기가 있다면 연락 주세요.', exact: true })).toBeVisible();
});

test('CONNECT_006@requirements.md:9-ALLOW-1 키보드로 본문 바로가기 접근', async ({ page }) => {
  await page.goto(target);
  await expect(page.getByRole('heading', { name: '권현성.', exact: true })).toBeVisible();

  const skipLink = page.getByRole('link', { name: '본문으로 바로가기', exact: true });
  await expect(skipLink).toHaveAttribute('href', '#main');
  await expect(page.locator('#main')).toBeAttached();
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
});
