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
  targetGenerationRuns,
} from './mockData.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataFile = path.resolve(moduleDirectory, '../../data/app-data.json');
const collections = {
  ingredients,
  formulations,
  aiVariants,
  complianceRecords,
  batchCostCalculations,
  pricingHistory,
  targetGenerationRuns,
};

let dataFile = defaultDataFile;
let storageMode = 'file';
let persistenceEnabled = true;
let writeQueue = Promise.resolve();

function replaceContents(target, values) {
  target.splice(0, target.length, ...values);
}

async function loadLocalData() {
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
    for (const [name, target] of Object.entries(collections)) {
      if (name !== 'ingredients' && Array.isArray(stored[name])) replaceContents(target, stored[name]);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  replaceContents(categories, [...new Set(ingredients.map(item => item.category))]);
}

export async function initializePersistentStore() {
  dataFile = path.resolve(process.env.DATA_FILE || defaultDataFile);
  if (process.env.NODE_TEST_CONTEXT) {
    persistenceEnabled = false;
    storageMode = 'memory';
    return;
  }

  if (process.env.STORAGE_MODE === 'supabase') {
    if (!isSupabaseConfigured()) throw new Error('Supabase storage selected but credentials are missing');
    persistenceEnabled = true;
    storageMode = 'supabase';
    return;
  }

  persistenceEnabled = process.env.PERSIST_DATA !== 'false';
  if (!persistenceEnabled) {
    storageMode = 'memory';
    return;
  }

  storageMode = 'file';
  await loadLocalData();
}

export async function persistStore() {
  if (!persistenceEnabled || storageMode !== 'file') return;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    const temporaryFile = `${dataFile}.tmp`;
    const data = { version: 1, saved_at: new Date().toISOString(), ...collections };
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, dataFile);
  });
  await writeQueue;
}

export function getLocalCollections() {
  return { ...collections, categories };
}

export function getStorageConfiguration() {
  return {
    mode: storageMode,
    persistent: persistenceEnabled,
    data_file: storageMode === 'file' && persistenceEnabled ? dataFile : null,
    supabase_url: storageMode === 'supabase' ? process.env.SUPABASE_URL : null,
  };
}
