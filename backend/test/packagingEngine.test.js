import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePackagingConfiguration } from '../src/services/packagingEngine.js';

test('packaging analysis calculates server-owned cost, mass and stability coverage', () => {
  const analysis = analyzePackagingConfiguration({ id: 'cfg', currency: 'DZD', intended_shelf_life_days: 90, components: [
    { component_id: 'bottle', role: 'primary_container', quantity: 1 }, { component_id: 'cap', role: 'closure', quantity: 1 },
  ] }, [
    { id: 'bottle', code: 'PET-330', name: 'Bottle', unit_cost: 12, mass_g: 18, recycled_content_percent: 25, status: 'approved', barrier: { oxygen_transmission_rate_cc_m2_day: 0.8 } },
    { id: 'cap', code: 'CAP-28', name: 'Cap', unit_cost: 2, mass_g: 2, recycled_content_percent: 0, status: 'approved', barrier: {} },
  ], { stability_coverage_days: 90 });
  assert.equal(analysis.economics.cost_per_sale_unit, 14);
  assert.equal(analysis.sustainability.total_packaging_mass_g, 20);
  assert.equal(analysis.sustainability.recycled_content_percent_by_mass, 22.5);
  assert.equal(analysis.stability_link.coverage_sufficient, true);
  assert.equal(analysis.readiness, 'ready');
});

test('packaging analysis blocks silent readiness when components or stability evidence are weak', () => {
  const analysis = analyzePackagingConfiguration({ id: 'cfg', currency: 'DZD', intended_shelf_life_days: 180, components: [{ component_id: 'bottle', role: 'primary_container', quantity: 1 }] }, [
    { id: 'bottle', code: 'PET', name: 'Bottle', unit_cost: 10, mass_g: 20, recycled_content_percent: 0, status: 'candidate', barrier: {} },
  ], { stability_coverage_days: 30 });
  assert.equal(analysis.readiness, 'review_required');
  assert.ok(analysis.warnings.some(item => item.includes('not approved')));
  assert.ok(analysis.warnings.some(item => item.includes('closure')));
  assert.ok(analysis.warnings.some(item => item.includes('30 days')));
});
