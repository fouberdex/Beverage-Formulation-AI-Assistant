import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aiVariants,
  batchCostCalculations,
  categories,
  complianceRecords,
  formulations,
  ingredients,
  pricingHistory,
} from './mockData.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataFile = path.resolve(moduleDirectory, '../../data/app-data.json');
let dataFile = defaultDataFile;
let persistenceEnabled = true;
let writeQueue = Promise.resolve();

function replaceContents(target, values) {
  target.splice(0, target.length, ...values);
}

export async function initializePersistentStore() {
  dataFile = path.resolve(process.env.DATA_FILE || defaultDataFile);
  persistenceEnabled = process.env.PERSIST_DATA !== 'false' && !process.env.NODE_TEST_CONTEXT;
  if (!persistenceEnabled) return;

  try {
    const bundledIngredients = [...ingredients];
    const stored = JSON.parse(await readFile(dataFile, 'utf8'));
    if (Array.isArray(stored.ingredients)) {
      const storedIds = new Set(stored.ingredients.map(item => item.id));
      const bundledById = new Map(bundledIngredients.map(item => [item.id, item]));
      replaceContents(ingredients, [
        ...stored.ingredients.map(item => ({ ...(bundledById.get(item.id) || {}), ...item })),
        ...bundledIngredients.filter(item => !storedIds.has(item.id)),
      ]);
    }
    if (Array.isArray(stored.formulations)) replaceContents(formulations, stored.formulations);
    if (Array.isArray(stored.aiVariants)) replaceContents(aiVariants, stored.aiVariants);
    if (Array.isArray(stored.complianceRecords)) replaceContents(complianceRecords, stored.complianceRecords);
    if (Array.isArray(stored.batchCostCalculations)) replaceContents(batchCostCalculations, stored.batchCostCalculations);
    if (Array.isArray(stored.pricingHistory)) replaceContents(pricingHistory, stored.pricingHistory);
    replaceContents(categories, [...new Set(ingredients.map(item => item.category))]);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function persistStore() {
  if (!persistenceEnabled) return;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    const temporaryFile = `${dataFile}.tmp`;
    const data = {
      version: 1,
      saved_at: new Date().toISOString(),
      ingredients,
      formulations,
      aiVariants,
      complianceRecords,
      batchCostCalculations,
      pricingHistory,
    };
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, dataFile);
  });
  await writeQueue;
}

export function getStorageConfiguration() {
  return {
    mode: persistenceEnabled ? 'file' : 'memory',
    persistent: persistenceEnabled,
    data_file: persistenceEnabled ? dataFile : null,
  };
}
