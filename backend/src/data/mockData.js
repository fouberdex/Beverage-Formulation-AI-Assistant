/**
 * Mock data for BeverageAI DZ
 * Used when database is not available
 */

// Generate UUID-like IDs
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Fixed IDs for cross-referencing
const INGREDIENT_IDS = {
  WATER: 'ing-water-001',
  SPRING_WATER: 'ing-water-002',
  CANE_SUGAR: 'ing-sweet-001',
  HFCS: 'ing-sweet-002',
  STEVIA: 'ing-sweet-003',
  ASPARTAME: 'ing-sweet-004',
  HONEY: 'ing-sweet-005',
  CITRIC_ACID: 'ing-acid-001',
  PHOSPHORIC_ACID: 'ing-acid-002',
  MALIC_ACID: 'ing-acid-003',
  ORANGE_FLAVOR: 'ing-flav-001',
  LEMON_FLAVOR: 'ing-flav-002',
  COLA_FLAVOR: 'ing-flav-003',
  VANILLA_EXTRACT: 'ing-flav-004',
  STRAWBERRY_FLAVOR: 'ing-flav-005',
  MANGO_FLAVOR: 'ing-flav-006',
  GRAPE_FLAVOR: 'ing-flav-007',
  SODIUM_BENZOATE: 'ing-pres-001',
  POTASSIUM_SORBATE: 'ing-pres-002',
  CARAMEL_COLOR: 'ing-color-001',
  BETA_CAROTENE: 'ing-color-002',
  SUNSET_YELLOW: 'ing-color-003',
  VITAMIN_C: 'ing-vit-001',
  VITAMIN_B: 'ing-vit-002',
  CAFFEINE: 'ing-caff-001',
  GREEN_TEA: 'ing-caff-002',
  CO2: 'ing-carb-001',
  ORANGE_JUICE: 'ing-juice-001',
  APPLE_JUICE: 'ing-juice-002',
  GRAPE_JUICE: 'ing-juice-003',
  GUM_ARABIC: 'ing-stab-001',
  PECTIN: 'ing-stab-002',
  XANTHAN_GUM: 'ing-stab-003',
  CALCIUM: 'ing-min-001',
  MAGNESIUM: 'ing-min-002',
  SALT: 'ing-min-003',
  LECITHIN: 'ing-emul-001',
  GINGER: 'ing-ext-001',
  MINT: 'ing-ext-002',
  HIBISCUS: 'ing-ext-003',
};

// Sample ingredients (1,200+ for production, 40 for demo)
export const mockIngredients = [
  // Water & Base
  { id: INGREDIENT_IDS.WATER, code: 'WATER-001', name: 'Purified Water', name_en: 'Purified Water', name_ar: 'ماء نقي', name_fr: 'Eau Purifiée', category: 'base', subcategory: 'water', price_per_kg: 5, base_price_per_kg: 5, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.SPRING_WATER, code: 'WATER-002', name: 'Spring Water', name_en: 'Spring Water', name_ar: 'ماء الينابيع', name_fr: 'Eau de Source', category: 'base', subcategory: 'water', price_per_kg: 15, base_price_per_kg: 15, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Sweeteners
  { id: INGREDIENT_IDS.CANE_SUGAR, code: 'SWEET-001', name: 'Cane Sugar', name_en: 'Cane Sugar', name_ar: 'سكر القصب', name_fr: 'Sucre de Canne', category: 'sweetener', subcategory: 'natural', price_per_kg: 120, base_price_per_kg: 120, calories_per_100g: 387, sugar_per_100g: 100, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.HFCS, code: 'SWEET-002', name: 'High Fructose Corn Syrup', name_en: 'High Fructose Corn Syrup', name_ar: 'شراب الذرة', name_fr: 'Sirop de Maïs', category: 'sweetener', subcategory: 'processed', price_per_kg: 80, base_price_per_kg: 80, calories_per_100g: 281, sugar_per_100g: 76, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.STEVIA, code: 'SWEET-003', name: 'Stevia Extract', name_en: 'Stevia Extract', name_ar: 'مستخلص ستيفيا', name_fr: 'Extrait de Stévia', category: 'sweetener', subcategory: 'natural', price_per_kg: 2500, base_price_per_kg: 2500, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.ASPARTAME, code: 'SWEET-004', name: 'Aspartame', name_en: 'Aspartame', name_ar: 'أسبارتام', name_fr: 'Aspartame', category: 'sweetener', subcategory: 'artificial', price_per_kg: 1800, base_price_per_kg: 1800, calories_per_100g: 4, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.5, is_active: true },
  { id: INGREDIENT_IDS.HONEY, code: 'SWEET-005', name: 'Honey', name_en: 'Honey', name_ar: 'عسل', name_fr: 'Miel', category: 'sweetener', subcategory: 'natural', price_per_kg: 800, base_price_per_kg: 800, calories_per_100g: 304, sugar_per_100g: 82, halal: true, halal_certified: true, kosher: true, vegan: false, regulatory_status: 'approved', is_active: true },
  
  // Acids
  { id: INGREDIENT_IDS.CITRIC_ACID, code: 'ACID-001', name: 'Citric Acid', name_en: 'Citric Acid', name_ar: 'حمض الستريك', name_fr: 'Acide Citrique', category: 'acidulant', subcategory: 'organic', price_per_kg: 150, base_price_per_kg: 150, calories_per_100g: 0, sugar_per_100g: 0, ph_min: 2.0, ph_max: 3.0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 1.0, is_active: true },
  { id: INGREDIENT_IDS.PHOSPHORIC_ACID, code: 'ACID-002', name: 'Phosphoric Acid', name_en: 'Phosphoric Acid', name_ar: 'حمض الفوسفوريك', name_fr: 'Acide Phosphorique', category: 'acidulant', subcategory: 'inorganic', price_per_kg: 200, base_price_per_kg: 200, calories_per_100g: 0, sugar_per_100g: 0, ph_min: 1.5, ph_max: 2.5, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.5, is_active: true },
  { id: INGREDIENT_IDS.MALIC_ACID, code: 'ACID-003', name: 'Malic Acid', name_en: 'Malic Acid', name_ar: 'حمض الماليك', name_fr: 'Acide Malique', category: 'acidulant', subcategory: 'organic', price_per_kg: 250, base_price_per_kg: 250, calories_per_100g: 0, sugar_per_100g: 0, ph_min: 2.5, ph_max: 3.5, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.8, is_active: true },
  
  // Flavors
  { id: INGREDIENT_IDS.ORANGE_FLAVOR, code: 'FLAV-001', name: 'Orange Flavor', name_en: 'Orange Flavor', name_ar: 'نكهة البرتقال', name_fr: 'Arôme Orange', category: 'flavor', subcategory: 'citrus', price_per_kg: 450, base_price_per_kg: 450, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.LEMON_FLAVOR, code: 'FLAV-002', name: 'Lemon Flavor', name_en: 'Lemon Flavor', name_ar: 'نكهة الليمون', name_fr: 'Arôme Citron', category: 'flavor', subcategory: 'citrus', price_per_kg: 420, base_price_per_kg: 420, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.COLA_FLAVOR, code: 'FLAV-003', name: 'Cola Flavor', name_en: 'Cola Flavor', name_ar: 'نكهة الكولا', name_fr: 'Arôme Cola', category: 'flavor', subcategory: 'cola', price_per_kg: 600, base_price_per_kg: 600, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.VANILLA_EXTRACT, code: 'FLAV-004', name: 'Vanilla Extract', name_en: 'Vanilla Extract', name_ar: 'مستخلص الفانيليا', name_fr: 'Extrait de Vanille', category: 'flavor', subcategory: 'extract', price_per_kg: 3500, base_price_per_kg: 3500, calories_per_100g: 12, sugar_per_100g: 0.5, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.STRAWBERRY_FLAVOR, code: 'FLAV-005', name: 'Strawberry Flavor', name_en: 'Strawberry Flavor', name_ar: 'نكهة الفراولة', name_fr: 'Arôme Fraise', category: 'flavor', subcategory: 'berry', price_per_kg: 480, base_price_per_kg: 480, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.MANGO_FLAVOR, code: 'FLAV-006', name: 'Mango Flavor', name_en: 'Mango Flavor', name_ar: 'نكهة المانجو', name_fr: 'Arôme Mangue', category: 'flavor', subcategory: 'tropical', price_per_kg: 520, base_price_per_kg: 520, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.GRAPE_FLAVOR, code: 'FLAV-007', name: 'Grape Flavor', name_en: 'Grape Flavor', name_ar: 'نكهة العنب', name_fr: 'Arôme Raisin', category: 'flavor', subcategory: 'fruit', price_per_kg: 440, base_price_per_kg: 440, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Preservatives
  { id: INGREDIENT_IDS.SODIUM_BENZOATE, code: 'PRES-001', name: 'Sodium Benzoate', name_en: 'Sodium Benzoate', name_ar: 'بنزوات الصوديوم', name_fr: 'Benzoate de Sodium', category: 'preservative', subcategory: 'antimicrobial', price_per_kg: 180, base_price_per_kg: 180, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.1, is_active: true },
  { id: INGREDIENT_IDS.POTASSIUM_SORBATE, code: 'PRES-002', name: 'Potassium Sorbate', name_en: 'Potassium Sorbate', name_ar: 'سوربات البوتاسيوم', name_fr: 'Sorbate de Potassium', category: 'preservative', subcategory: 'antimicrobial', price_per_kg: 220, base_price_per_kg: 220, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.1, is_active: true },
  
  // Colors
  { id: INGREDIENT_IDS.CARAMEL_COLOR, code: 'COLOR-001', name: 'Caramel Color', name_en: 'Caramel Color', name_ar: 'لون الكراميل', name_fr: 'Colorant Caramel', category: 'colorant', subcategory: 'natural', price_per_kg: 350, base_price_per_kg: 350, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.5, is_active: true },
  { id: INGREDIENT_IDS.BETA_CAROTENE, code: 'COLOR-002', name: 'Beta Carotene', name_en: 'Beta Carotene', name_ar: 'بيتا كاروتين', name_fr: 'Bêta-Carotène', category: 'colorant', subcategory: 'natural', price_per_kg: 1200, base_price_per_kg: 1200, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.05, is_active: true },
  { id: INGREDIENT_IDS.SUNSET_YELLOW, code: 'COLOR-003', name: 'Sunset Yellow', name_en: 'Sunset Yellow', name_ar: 'أصفر الغروب', name_fr: 'Jaune Orangé S', category: 'colorant', subcategory: 'synthetic', price_per_kg: 280, base_price_per_kg: 280, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.01, is_active: true },
  
  // Vitamins
  { id: INGREDIENT_IDS.VITAMIN_C, code: 'VIT-001', name: 'Vitamin C (Ascorbic Acid)', name_en: 'Vitamin C (Ascorbic Acid)', name_ar: 'فيتامين سي', name_fr: 'Vitamine C', category: 'vitamin', subcategory: 'water-soluble', price_per_kg: 650, base_price_per_kg: 650, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.VITAMIN_B, code: 'VIT-002', name: 'Vitamin B Complex', name_en: 'Vitamin B Complex', name_ar: 'فيتامين ب المركب', name_fr: 'Complexe Vitamine B', category: 'vitamin', subcategory: 'water-soluble', price_per_kg: 1800, base_price_per_kg: 1800, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Caffeine & Stimulants
  { id: INGREDIENT_IDS.CAFFEINE, code: 'CAFF-001', name: 'Caffeine Anhydrous', name_en: 'Caffeine Anhydrous', name_ar: 'كافيين', name_fr: 'Caféine Anhydre', category: 'stimulant', subcategory: 'caffeine', price_per_kg: 950, base_price_per_kg: 950, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.032, is_active: true },
  { id: INGREDIENT_IDS.GREEN_TEA, code: 'CAFF-002', name: 'Green Tea Extract', name_en: 'Green Tea Extract', name_ar: 'مستخلص الشاي الأخضر', name_fr: 'Extrait de Thé Vert', category: 'stimulant', subcategory: 'natural', price_per_kg: 1100, base_price_per_kg: 1100, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Carbonation
  { id: INGREDIENT_IDS.CO2, code: 'CARB-001', name: 'Carbon Dioxide (CO2)', name_en: 'Carbon Dioxide (CO2)', name_ar: 'ثاني أكسيد الكربون', name_fr: 'Dioxyde de Carbone', category: 'carbonation', subcategory: 'gas', price_per_kg: 30, base_price_per_kg: 30, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Juice Concentrates
  { id: INGREDIENT_IDS.ORANGE_JUICE, code: 'JUICE-001', name: 'Orange Juice Concentrate', name_en: 'Orange Juice Concentrate', name_ar: 'عصير برتقال مركز', name_fr: 'Concentré de Jus d\'Orange', category: 'juice', subcategory: 'citrus', price_per_kg: 280, base_price_per_kg: 280, calories_per_100g: 180, sugar_per_100g: 42, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.APPLE_JUICE, code: 'JUICE-002', name: 'Apple Juice Concentrate', name_en: 'Apple Juice Concentrate', name_ar: 'عصير تفاح مركز', name_fr: 'Concentré de Jus de Pomme', category: 'juice', subcategory: 'fruit', price_per_kg: 240, base_price_per_kg: 240, calories_per_100g: 170, sugar_per_100g: 40, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.GRAPE_JUICE, code: 'JUICE-003', name: 'Grape Juice Concentrate', name_en: 'Grape Juice Concentrate', name_ar: 'عصير عنب مركز', name_fr: 'Concentré de Jus de Raisin', category: 'juice', subcategory: 'fruit', price_per_kg: 320, base_price_per_kg: 320, calories_per_100g: 200, sugar_per_100g: 48, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Stabilizers
  { id: INGREDIENT_IDS.GUM_ARABIC, code: 'STAB-001', name: 'Gum Arabic', name_en: 'Gum Arabic', name_ar: 'صمغ عربي', name_fr: 'Gomme Arabique', category: 'stabilizer', subcategory: 'gum', price_per_kg: 450, base_price_per_kg: 450, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.PECTIN, code: 'STAB-002', name: 'Pectin', name_en: 'Pectin', name_ar: 'بكتين', name_fr: 'Pectine', category: 'stabilizer', subcategory: 'gum', price_per_kg: 680, base_price_per_kg: 680, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.XANTHAN_GUM, code: 'STAB-003', name: 'Xanthan Gum', name_en: 'Xanthan Gum', name_ar: 'صمغ الزانثان', name_fr: 'Gomme Xanthane', category: 'stabilizer', subcategory: 'gum', price_per_kg: 720, base_price_per_kg: 720, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', max_percentage: 0.5, is_active: true },
  
  // Minerals
  { id: INGREDIENT_IDS.CALCIUM, code: 'MIN-001', name: 'Calcium Carbonate', name_en: 'Calcium Carbonate', name_ar: 'كربونات الكالسيوم', name_fr: 'Carbonate de Calcium', category: 'mineral', subcategory: 'calcium', price_per_kg: 120, base_price_per_kg: 120, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.MAGNESIUM, code: 'MIN-002', name: 'Magnesium Citrate', name_en: 'Magnesium Citrate', name_ar: 'سترات المغنيسيوم', name_fr: 'Citrate de Magnésium', category: 'mineral', subcategory: 'magnesium', price_per_kg: 380, base_price_per_kg: 380, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.SALT, code: 'MIN-003', name: 'Sodium Chloride (Salt)', name_en: 'Sodium Chloride (Salt)', name_ar: 'ملح', name_fr: 'Chlorure de Sodium', category: 'mineral', subcategory: 'sodium', price_per_kg: 15, base_price_per_kg: 15, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Emulsifiers
  { id: INGREDIENT_IDS.LECITHIN, code: 'EMUL-001', name: 'Lecithin', name_en: 'Lecithin', name_ar: 'ليسيثين', name_fr: 'Lécithine', category: 'emulsifier', subcategory: 'natural', price_per_kg: 420, base_price_per_kg: 420, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  
  // Natural Extracts
  { id: INGREDIENT_IDS.GINGER, code: 'EXT-001', name: 'Ginger Extract', name_en: 'Ginger Extract', name_ar: 'مستخلص الزنجبيل', name_fr: 'Extrait de Gingembre', category: 'extract', subcategory: 'spice', price_per_kg: 580, base_price_per_kg: 580, calories_per_100g: 5, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.MINT, code: 'EXT-002', name: 'Mint Extract', name_en: 'Mint Extract', name_ar: 'مستخلص النعناع', name_fr: 'Extrait de Menthe', category: 'extract', subcategory: 'herb', price_per_kg: 620, base_price_per_kg: 620, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
  { id: INGREDIENT_IDS.HIBISCUS, code: 'EXT-003', name: 'Hibiscus Extract', name_en: 'Hibiscus Extract', name_ar: 'مستخلص الكركديه', name_fr: 'Extrait d\'Hibiscus', category: 'extract', subcategory: 'flower', price_per_kg: 480, base_price_per_kg: 480, calories_per_100g: 0, sugar_per_100g: 0, halal: true, halal_certified: true, kosher: true, vegan: true, regulatory_status: 'approved', is_active: true },
].map((ing) => ({
  ...ing,
  sugar_g: ing.sugar_g ?? ing.sugar_per_100g ?? 0,
  currency: ing.currency ?? 'DZD',
  kosher_certified: ing.kosher_certified ?? ing.kosher ?? false,
  organic: ing.organic ?? false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

// Sample formulations with fixed ingredient IDs
export const mockFormulations = [
  {
    id: 'form-001',
    code: 'ORANGE-SODA-001',
    name: 'Classic Orange Soda',
    beverage_type: 'carbonated',
    status: 'active',
    version: 1,
    ingredients: [
      { ingredient_id: INGREDIENT_IDS.WATER, percentage: 86.5 },
      { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 10 },
      { ingredient_id: INGREDIENT_IDS.ORANGE_FLAVOR, percentage: 1.5 },
      { ingredient_id: INGREDIENT_IDS.CITRIC_ACID, percentage: 0.3 },
      { ingredient_id: INGREDIENT_IDS.CO2, percentage: 1.5 },
      { ingredient_id: INGREDIENT_IDS.BETA_CAROTENE, percentage: 0.02 },
      { ingredient_id: INGREDIENT_IDS.SODIUM_BENZOATE, percentage: 0.08 },
      { ingredient_id: INGREDIENT_IDS.VITAMIN_C, percentage: 0.1 },
    ],
    total_percentage: 100,
    total_cost_per_liter: 25.5,
    total_calories_per_100ml: 38.7,
    total_sugar_per_100ml: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'form-002',
    code: 'COLA-001',
    name: 'Premium Cola',
    beverage_type: 'carbonated',
    status: 'active',
    version: 1,
    ingredients: [
      { ingredient_id: INGREDIENT_IDS.WATER, percentage: 87 },
      { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 9.5 },
      { ingredient_id: INGREDIENT_IDS.COLA_FLAVOR, percentage: 1.2 },
      { ingredient_id: INGREDIENT_IDS.PHOSPHORIC_ACID, percentage: 0.3 },
      { ingredient_id: INGREDIENT_IDS.CO2, percentage: 1.5 },
      { ingredient_id: INGREDIENT_IDS.CARAMEL_COLOR, percentage: 0.3 },
      { ingredient_id: INGREDIENT_IDS.CAFFEINE, percentage: 0.02 },
      { ingredient_id: INGREDIENT_IDS.SODIUM_BENZOATE, percentage: 0.08 },
      { ingredient_id: INGREDIENT_IDS.VANILLA_EXTRACT, percentage: 0.1 },
    ],
    total_percentage: 100,
    total_cost_per_liter: 28.3,
    total_calories_per_100ml: 36.8,
    total_sugar_per_100ml: 9.5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'form-003',
    code: 'ENERGY-001',
    name: 'Power Energy Drink',
    beverage_type: 'energy',
    status: 'active',
    version: 1,
    ingredients: [
      { ingredient_id: INGREDIENT_IDS.WATER, percentage: 85 },
      { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 8 },
      { ingredient_id: INGREDIENT_IDS.CITRIC_ACID, percentage: 0.5 },
      { ingredient_id: INGREDIENT_IDS.CAFFEINE, percentage: 0.03 },
      { ingredient_id: INGREDIENT_IDS.GREEN_TEA, percentage: 0.5 },
      { ingredient_id: INGREDIENT_IDS.VITAMIN_B, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.VITAMIN_C, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.CO2, percentage: 1.5 },
      { ingredient_id: INGREDIENT_IDS.MANGO_FLAVOR, percentage: 1 },
      { ingredient_id: INGREDIENT_IDS.SODIUM_BENZOATE, percentage: 0.07 },
      { ingredient_id: INGREDIENT_IDS.GUM_ARABIC, percentage: 0.2 },
      { ingredient_id: INGREDIENT_IDS.SALT, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.BETA_CAROTENE, percentage: 0.02 },
      { ingredient_id: INGREDIENT_IDS.STEVIA, percentage: 0.08 },
      { ingredient_id: INGREDIENT_IDS.MAGNESIUM, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.CALCIUM, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.SPRING_WATER, percentage: 2.5 },
    ],
    total_percentage: 100,
    total_cost_per_liter: 45.2,
    total_calories_per_100ml: 31.0,
    total_sugar_per_100ml: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'form-004',
    code: 'JUICE-ORANGE-001',
    name: 'Fresh Orange Juice',
    beverage_type: 'juice',
    status: 'active',
    version: 1,
    ingredients: [
      { ingredient_id: INGREDIENT_IDS.WATER, percentage: 60 },
      { ingredient_id: INGREDIENT_IDS.ORANGE_JUICE, percentage: 35 },
      { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 3 },
      { ingredient_id: INGREDIENT_IDS.CITRIC_ACID, percentage: 0.2 },
      { ingredient_id: INGREDIENT_IDS.VITAMIN_C, percentage: 0.15 },
      { ingredient_id: INGREDIENT_IDS.PECTIN, percentage: 0.15 },
      { ingredient_id: INGREDIENT_IDS.BETA_CAROTENE, percentage: 0.01 },
      { ingredient_id: INGREDIENT_IDS.POTASSIUM_SORBATE, percentage: 0.05 },
      { ingredient_id: INGREDIENT_IDS.ORANGE_FLAVOR, percentage: 1.44 },
    ],
    total_percentage: 100,
    total_cost_per_liter: 35.8,
    total_calories_per_100ml: 74.6,
    total_sugar_per_100ml: 17.7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'form-005',
    code: 'LEMON-LIME-001',
    name: 'Lemon Lime Sparkling',
    beverage_type: 'carbonated',
    status: 'active',
    version: 1,
    ingredients: [
      { ingredient_id: INGREDIENT_IDS.WATER, percentage: 87.5 },
      { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 8 },
      { ingredient_id: INGREDIENT_IDS.LEMON_FLAVOR, percentage: 1.2 },
      { ingredient_id: INGREDIENT_IDS.CITRIC_ACID, percentage: 0.5 },
      { ingredient_id: INGREDIENT_IDS.CO2, percentage: 2 },
      { ingredient_id: INGREDIENT_IDS.SODIUM_BENZOATE, percentage: 0.05 },
      { ingredient_id: INGREDIENT_IDS.STEVIA, percentage: 0.05 },
      { ingredient_id: INGREDIENT_IDS.VITAMIN_C, percentage: 0.1 },
      { ingredient_id: INGREDIENT_IDS.MINT, percentage: 0.6 },
    ],
    total_percentage: 100,
    total_cost_per_liter: 22.1,
    total_calories_per_100ml: 31.0,
    total_sugar_per_100ml: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Sample AI variants
export const aiVariants = [];

// Sample compliance records
export const mockComplianceRecords = [];

// Sample batch cost calculations
export const batchCostCalculations = [];

// Categories
export const categories = [...new Set(mockIngredients.map(i => i.category))];

// Export functions to manipulate data
export function getIngredientById(id) {
  return mockIngredients.find(i => i.id === id);
}

export function addFormulation(formulation) {
  const newFormulation = {
    ...formulation,
    id: generateId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  mockFormulations.push(newFormulation);
  return newFormulation;
}

export function updateFormulation(id, data) {
  const idx = mockFormulations.findIndex(f => f.id === id);
  if (idx >= 0) {
    mockFormulations[idx] = { ...mockFormulations[idx], ...data, updated_at: new Date().toISOString() };
    return mockFormulations[idx];
  }
  return null;
}

export function deleteFormulation(id) {
  const idx = mockFormulations.findIndex(f => f.id === id);
  if (idx >= 0) {
    mockFormulations[idx].status = 'archived';
    return mockFormulations[idx];
  }
  return null;
}

// Also export under 'ingredients' and 'formulations' for backward compatibility
export const ingredients = mockIngredients;
export const formulations = mockFormulations;
export const complianceRecords = mockComplianceRecords;

export { generateId, INGREDIENT_IDS };
