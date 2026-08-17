import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const formulation = (index: number) => ({
  id: `form-${index}`, code: `FORM-${index}`, name: `Formula ${index}`,
  beverage_type: 'soft_drink', version: 1, is_latest_version: true, status: 'draft',
  total_percentage: 100, total_cost_per_liter: 40, total_calories_per_100ml: 30,
  total_sugar_per_100ml: 7, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ingredients: [],
});

async function mockApi(page: Page, options: { formulationStatus?: number } = {}) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'x-request-id': 'e2e-request' } });
    if (path === '/ingredients/meta/stats') return reply({ data: { total_ingredients: 42 } });
    if (path === '/ingredients/meta/categories') return reply({ data: ['base', 'flavor'] });
    if (path === '/ingredients') return reply({ data: [], pagination: { total: 0, limit: 25, offset: 0, has_more: false } });
    if (path === '/formulations' && options.formulationStatus) return reply({ error: 'Backend exploded' }, options.formulationStatus);
    if (path === '/formulations') {
      const limit = Number(url.searchParams.get('limit') || 12);
      const offset = Number(url.searchParams.get('offset') || 0);
      const all = Array.from({ length: 13 }, (_, index) => formulation(index + 1));
      return reply({ data: all.slice(offset, offset + limit), pagination: { total: all.length, limit, offset, has_more: offset + limit < all.length } });
    }
    if (/^\/formulations\/[^/]+\/versions$/.test(path)) return reply({ data: [formulation(1)] });
    if (path === '/target-generation/runs' || path === '/audit') return reply({ data: [], pagination: { total: 0, limit: 10, offset: 0, has_more: false } });
    return reply({ data: [] });
  });
}

async function useRole(page: Page, role: 'admin' | 'formulator' | 'viewer') {
  await page.addInitScript(value => localStorage.setItem('e2e-role', value), role);
}

test('viewer navigation and formulation actions are read-only', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/formulations');
  await expect(page.getByRole('heading', { name: 'Formulations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI Engine' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Formulation' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Formula 1 / }).click();
  await expect(page.getByRole('heading', { name: 'Formulation Details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update Formulation' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('viewer is blocked from a privileged URL entered directly', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/ai');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await expect(page.getByText('viewer role cannot open this workspace')).toBeVisible();
});

test('administrator sees privileged navigation and ingredient management', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/ingredients');
  await expect(page.getByRole('link', { name: 'AI Engine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Ingredient' })).toBeVisible();
});

test('formulations paginate using the API total', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page); await page.goto('/formulations');
  await expect(page.getByText('Showing 1–12 of 13')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Showing 13–13 of 13')).toBeVisible();
  await expect(page.getByRole('button', { name: /Formula 13/ })).toBeVisible();
});

test('API failures are announced with a support reference', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page, { formulationStatus: 500 }); await page.goto('/formulations');
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('alert')).toContainText('e2e-request');
});

test('expired sessions return the user to sign in', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page, { formulationStatus: 401 }); await page.goto('/formulations');
  await expect(page.getByRole('heading', { name: 'BeverageAI DZ' })).toBeVisible();
  await expect(page.locator('form').getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('dashboard has no serious automated accessibility violations', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});

test('core workspace pages have no serious automated accessibility violations', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page);
  for (const path of ['/ingredients', '/formulations', '/compatibility', '/history', '/account']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || '')), path).toEqual([]);
  }
});
