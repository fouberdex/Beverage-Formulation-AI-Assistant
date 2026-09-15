export const PACKAGING_ENGINE_VERSION = '1.0.0';

const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

export function analyzePackagingConfiguration(configuration, components, context = {}) {
  const byId = new Map(components.map(component => [component.id, component]));
  const resolved = configuration.components.map(line => {
    const component = byId.get(line.component_id);
    if (!component) return { ...line, missing: true };
    return {
      component_id: component.id,
      code: component.code,
      name: component.name,
      role: line.role,
      quantity: line.quantity,
      unit_cost: component.unit_cost,
      extended_cost: round(component.unit_cost * line.quantity),
      mass_g: round(component.mass_g * line.quantity),
      recycled_mass_g: round(component.mass_g * line.quantity * component.recycled_content_percent / 100),
      status: component.status,
      barrier: component.barrier,
    };
  });
  const available = resolved.filter(item => !item.missing);
  const totalMass = available.reduce((sum, item) => sum + item.mass_g, 0);
  const recycledMass = available.reduce((sum, item) => sum + item.recycled_mass_g, 0);
  const warnings = [];
  if (resolved.some(item => item.missing)) warnings.push('One or more packaging components could not be resolved.');
  if (available.some(item => item.status !== 'approved')) warnings.push('The configuration contains a component that is not approved.');
  if (!available.some(item => item.role === 'primary_container')) warnings.push('No primary container is declared.');
  if (!available.some(item => item.role === 'closure')) warnings.push('No closure is declared.');
  const shelfLife = Number(configuration.intended_shelf_life_days || 0);
  const stabilityCoverage = Number(context.stability_coverage_days || 0);
  if (shelfLife > 0 && stabilityCoverage < shelfLife) warnings.push(`Recorded stability coverage (${stabilityCoverage} days) is below intended shelf life (${shelfLife} days).`);
  const maxBarrier = key => {
    const values = available.map(item => Number(item.barrier?.[key])).filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  };
  return {
    engine_version: PACKAGING_ENGINE_VERSION,
    configuration_id: configuration.id,
    component_count: available.length,
    components: resolved,
    economics: { currency: configuration.currency, cost_per_sale_unit: round(available.reduce((sum, item) => sum + item.extended_cost, 0)) },
    sustainability: { total_packaging_mass_g: round(totalMass), recycled_content_percent_by_mass: totalMass ? round(recycledMass / totalMass * 100, 2) : 0 },
    barrier_screen: {
      maximum_oxygen_transmission_rate_cc_m2_day: maxBarrier('oxygen_transmission_rate_cc_m2_day'),
      maximum_water_vapor_transmission_rate_g_m2_day: maxBarrier('water_vapor_transmission_rate_g_m2_day'),
      maximum_light_transmission_percent: maxBarrier('light_transmission_percent'),
      note: 'Screening values are component supplier data; validate the assembled package under intended storage conditions.',
    },
    stability_link: { intended_shelf_life_days: shelfLife, recorded_coverage_days: stabilityCoverage, coverage_sufficient: shelfLife > 0 && stabilityCoverage >= shelfLife },
    readiness: warnings.length ? 'review_required' : 'ready',
    warnings,
  };
}
