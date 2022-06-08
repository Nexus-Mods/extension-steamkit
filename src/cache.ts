import path from 'path';
import { fs, selectors, types, util } from 'vortex-api';
import { MODS_PER_PAGE } from './constants';

import { IModsCache, IWorkshopMod } from './types/interface';

export const MOD_LIST_PREFIX = 'workshop_';

let cachedPages: { [gameMode: string]: IModsCache } = {};
let _IS_BUSY: boolean = false;

function tryCached(gameMode, page) {
  return ((cachedPages[gameMode]?.[page] !== undefined)
       && (cachedPages[gameMode][page].length >= MODS_PER_PAGE))
    ? cachedPages[gameMode][page] : undefined;
}

export async function hasPage(api, gameMode, page) {
  if (tryCached(gameMode, page) !== undefined) {
    return true;
  }
  const modList = await readCache(api, gameMode);
  return (modList[page] !== undefined) ? true : false;
}

export async function getPage(api, gameMode, page) {
  const cached = tryCached(gameMode, page);
  if (cached !== undefined) {
    return cached;
  }
  const modList = await readCache(api, gameMode);
  return modList[page];
}

export async function findMod(api, gameMode, fileId) {
  const cached = cachedPages[gameMode];
  if (cached) {
    const mod = getCacheEntry(cached, fileId);
    return Promise.resolve(mod);
  } else {
    const modList = await readCache(api, gameMode);
    const mod = getCacheEntry(modList, fileId);
    return Promise.resolve(mod);
  }
}

export async function insertMods(api: types.IExtensionApi,
                                 gameMode: string,
                                 mods: IWorkshopMod[],
                                 cb: () => void) {
  const modList = await readCache(api, gameMode);
  const filtered = mods.filter(mod => !isInCache(modList, mod.publishedfileid));
  for (const mod of filtered) {
    const pageNumber = insertPage(modList);
    modList[pageNumber] = [].concat(modList[pageNumber] || [], mod);
  }
  await writeCache(api, gameMode, modList);
  cb();
}

export async function totalMods(api, gameMode) {
  const modList = await readCache(api, gameMode);
  let total = 0;
  for (const page of Object.keys(modList)) {
    total += modList[page].length;
  }
  return total;
}

function insertPage(data: IModsCache) {
  const pages = Object.keys(data);
  for (const page of pages) {
    if (data[page].length < MODS_PER_PAGE) {
      return page;
    }
  }
  return (pages.length + 1).toString();
}

function findFileIdInPage(data: IModsCache, fileId: string, page: string) {
  return data[page]?.find(entry => entry.publishedfileid === fileId);
}

export function isInCache(data: IModsCache, publishedfileId: string) {
  const reversed = Object.keys(data).reverse();
  for (const page of reversed) {
    const entry = findFileIdInPage(data, publishedfileId, page);
    if (entry !== undefined) {
      return true;
    }
  }
  return false;
}

export function getCacheEntry(data: IModsCache, publishedfileId: string) {
  for (const page of Object.keys(data)) {
    const entry = findFileIdInPage(data, publishedfileId, page);
    if (entry !== undefined) {
      return entry;
    }
  }
  return undefined;
}

export async function updateModList(api, gameMode, page) {
  try {
    if (page < 1) { page = 1; }
    const cached = tryCached(gameMode, page);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const modList = await readCache(api, gameMode);
    const newList = modList[page];
    return Promise.resolve(newList);
  } catch (err) {
    return Promise.reject(err);
  }
}

async function parseModList(api, gameMode): Promise<IModsCache> {
  const listPath = getCachingPath(api, gameMode);
  const readLoop = () => new Promise(async (resolve, reject) => {
    if (_IS_BUSY) {
      await new Promise<void>((resTimeout) => setTimeout(() => resTimeout(), 200));
      return resolve(readLoop());
    } else {
      _IS_BUSY = true;
      try {
        const data = await fs.readFileAsync(listPath);
        const parsed = JSON.parse(data);
        return resolve(parsed);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return resolve({});
        }
        return reject(err);
      } finally {
        _IS_BUSY = false;
      }
    }
  });
  return readLoop();
}

export function resetCache() {
  _IS_BUSY = false;
}

export function getCachingPath(api, gameMode) {
  const state = api.getState();
  const installDir = selectors.installPathForGame(state, gameMode);
  return path.join(installDir, `${MOD_LIST_PREFIX + gameMode + '.json'}`);
}

const queue = () => Promise.resolve();
export async function readCache(api, gameMode) {
  return queue().then(async () => {
    const list = cachedPages[gameMode] = await parseModList(api, gameMode);
    return Promise.resolve(list);
  });
}

async function writeCache(api, gameMode, mods) {
  const cachePath = getCachingPath(api, gameMode);
  return queue().then(async () => {
    const writeLoop = () => new Promise(async (resolve, reject) => {
      if (_IS_BUSY) {
        await new Promise<void>((resTimeout) => setTimeout(() => resTimeout(), 200));
        return resolve(writeLoop());
      } else {
        try {
          _IS_BUSY = true;
          await util.writeFileAtomic(cachePath, JSON.stringify(mods, undefined, 2));
          return resolve(undefined);
        } catch (err) {
          return reject(err);
        } finally {
          _IS_BUSY = false;
        }
      }
    });
    return writeLoop();
  });
}
