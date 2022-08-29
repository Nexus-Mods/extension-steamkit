import path from 'path';
import { actions, types, selectors, util, fs } from 'vortex-api';
import { IDependencyModInfo, IWorkshopMod } from '../types/interface';

import turbowalk from 'turbowalk';
import { memoize } from 'lodash';

export function addDownloadMetaData(api: types.IExtensionApi,
                                    mod: IWorkshopMod | IDependencyModInfo,
                                    dlId: string,
                                    gameId: string) {
  if (mod['title'] === undefined) {
    return;
  }
  const batchedActions = [
    actions.setDownloadModInfo(dlId, 'name', mod['title']),
    actions.setDownloadModInfo(dlId, 'source', 'website'),
    actions.setDownloadModInfo(dlId, 'url', `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`),
    actions.setDownloadModInfo(dlId, 'game', gameId),
    actions.setDownloadModInfo(dlId, 'steamkit', JSON.stringify(mod)),
  ];
  util.batchDispatch(api.store, batchedActions);
}

export function addModMetaData(api: types.IExtensionApi,
                               mod: IWorkshopMod,
                               modId: string,
                               gameId: string) {
  const batchedActions = [
    actions.setModAttribute(gameId, modId, 'name', mod.title),
    actions.setModAttribute(gameId, modId, 'description', mod.short_description),
    actions.setModAttribute(gameId, modId, 'pictureUrl', mod.preview_url),
    actions.setModAttribute(gameId, modId, 'publishedfileid', mod.publishedfileid),
  ];
  util.batchDispatch(api.store, batchedActions);
}

export async function getFiles(basePath: string): Promise<string[]> {
  let filePaths: string[] = [];
  return turbowalk(basePath, files => {
    const filtered = files.filter(entry => !entry.isDirectory && !entry.filePath.split(path.sep).includes('.DepotDownloader'));
    filePaths = filePaths.concat(filtered.map(entry => entry.filePath));
  }, { recurse: true, skipLinks: true })
  .catch(err => ['ENOENT', 'ENOTFOUND'].includes(err.code)
    ? Promise.resolve() : Promise.reject(err))
  .then(() => Promise.resolve(filePaths));
}

export async function packFiles(modPath: string, files: string[], destination: string) {
  const baseSegments = modPath.split(path.sep);
  const baseSeg = baseSegments.slice(baseSegments.length - 1)[0];
  const arcMap: { [arcName: string]: {basePath: string, relPath: string}[] } = files.reduce((accum, iter) => {
    const segments = iter.split(path.sep);
    const idx = segments.findIndex(seg => seg === baseSeg);
    if (idx === -1) {
      return accum;
    }
    const modKey = segments.slice(idx - 1, idx + 1).join('_');
    if (accum[modKey] === undefined) {
      accum[modKey] = [];
    }
    const basePath = segments.slice(0, idx + 1).join(path.sep);
    const relPath = path.relative(basePath, iter);
    const pathExists = (accum[modKey].find(file =>
      file.relPath.split(path.sep)[0] === relPath.split(path.sep)[0]) !== undefined);
    if (!pathExists) {
      accum[modKey].push({ relPath, basePath });
    }
    return accum;
  }, {});

  const szip = new util.SevenZip();
  for (const modKey of Object.keys(arcMap)) {
    await szip.add(destination, arcMap[modKey]
      .map(file => path.join(file.basePath,
        file.relPath.split(path.sep)[0])), { raw: ['-r'] });
  }
}

export function steamWebAPIKeyPath() {
  return path.join(util.getVortexPath('temp'), 'steamWebAPIKey.json');
}

export async function ensureWebAPIFile(api: types.IExtensionApi, key: string) {
  // TODO: I would use the state to store this but for some stupid reason it doesn't
  //  persist between restarts (both settings and presistent branches).
  //  That's something I'll investigate some other time.
  try {
    await fs.writeFileAsync(steamWebAPIKeyPath(), JSON.stringify({ key }));
  } catch (err) {
    api.showErrorNotification('Failed to write Steam Web API key', err);
    return Promise.resolve();
  }
}

export const getApiKey = memoize(readWebApiKey);
async function readWebApiKey() {
  try {
    const key = await fs.readFileAsync(steamWebAPIKeyPath());
    return JSON.parse(key).key;
  } catch (err) {
    return Promise.resolve('');
  }
}