import { fs, log, selectors, types, util } from 'vortex-api';

import DelegateBase from './DelegateBase';

import Promise from 'bluebird';
import minimatch from 'minimatch';
import * as path from 'path';
import turbowalk, { IEntry } from 'turbowalk';

export class Context extends DelegateBase {
  private gameId: string;
  private gameDiscovery: types.IDiscoveryResult;
  private gameInfo: types.IGame;
  constructor(api: types.IExtensionApi, gameId: string) {
    super(api);
    this.gameId = gameId;

    this.gameDiscovery =
        util.getSafe(api.store.getState(),
                ['settings', 'gameMode', 'discovered', gameId], undefined);
    this.gameInfo = util.getGame(this.gameId);
    if ((this.gameDiscovery === undefined) || (this.gameDiscovery.path === undefined)) {
      throw new util.ProcessCanceled('Game not installed');
    }
  }

  public getSteamId =
      (callback: (err, res: string) => void) => {
        log('debug', 'getSteamId called');
        return (this.gameInfo?.environment?.SteamAPPId || this.gameInfo?.details?.SteamAPPId) !== undefined
          ? callback(null, this.gameInfo?.details?.SteamAPPId)
          : callback(new Error('SteamAppId is unavailable'), null);
      }

  public getExistingDataFile =
      (fileName: string, callback: (err, res: any) => void) => {
        log('debug', 'getExistingDataFile called', fileName);
        const fullPath = this.resolveFilePath(fileName);

        fs.readFileAsync(fullPath)
          .then(data => callback(null, data))
          .catch(err => callback(err, null));
      }

  public getGameFileList =
    (callback: (err, res: string[]) => void) => {
     log('debug', 'getGameFileList called');
     const fullPath = this.gameDiscovery.path;
     const modPath = this.gameInfo.queryModPath(this.gameDiscovery.path);
     const filterFunc = (input: IEntry) => ((modPath !== '.') && (modPath !== fullPath))
      ? input.filePath.indexOf(modPath) === -1
      : true;
     this.readDir(fullPath, true, filterFunc)
       .then((fileList) => callback(null, fileList))
       .catch(err => callback(err, null));
  }

  public getExistingDataFileList =
    (basePath: string, pattern: string, recursive: boolean,
     callback: (err, res: string[]) => void) => {
      log('debug', 'getExistingDataFileList called', basePath);
      const fullPath = this.resolveFilePath(basePath);

      const filterFunc = (input: IEntry) => minimatch(path.basename(input.filePath), pattern);

      this.readDir(fullPath, recursive, filterFunc)
        .then((fileList) => callback(null, fileList))
        .catch(err => callback(err, null));
  }

  public getDepotIds =
    (args: any, callback: (err, res: string[]) => void) => {
      log('debug', 'getDepotIds called');
      const appId = (this.gameInfo?.details !== undefined)
        ? Object.keys(this.gameInfo.details).find(key => key.toLowerCase() === 'steamappid')
        : undefined;
      if (!appId || this.gameInfo.details?.[appId] === undefined) {
        callback(new util.DataInvalid('Could not find app id'), null);
      } else {
        util.GameStoreHelper.findByAppId([this.gameInfo.details[appId].toString()], 'steam')
          .then(gameEntry => {
            const installedDepots = gameEntry?.['manifestData']?.['AppState']?.['InstalledDepots'];
            if (installedDepots !== undefined) {
              callback(null, Object.keys(installedDepots))
            } else {
              callback(new util.DataInvalid('Could not find app id'), null);
            }
          })
          .catch(err => callback(new util.DataInvalid('Could not find gameEntry'), null));
      }
  }

  public getGameExecutable =
    (args: any, callback: (err, res: string) => void) => {
      log('debug', 'getGameExecutable called');
      const executable = path.join(this.gameDiscovery.path,
                                   this.gameInfo.executable(this.gameDiscovery.path));
      callback(null, executable);
  }

  private resolveFilePath(filePath: string): string {
    let modPath = this.gameInfo.queryModPath(this.gameDiscovery.path);
    if (!path.isAbsolute(modPath)) {
      modPath = path.join(this.gameDiscovery.path, modPath);
    }
    return path.join(modPath, filePath);
  }

  private readDir = (rootPath: string,
                     recurse: boolean,
                     filterFunc: (entry: IEntry) => boolean)
                     : Promise<string[]> => {
    let fileList: string[] = [];

    return turbowalk(rootPath, entries => {
      fileList = fileList.concat(
        entries
          .filter(iter => !iter.isDirectory)
          .filter(filterFunc)
          // in the past this mapped to a path relative to rootPath but NMM
          // clearly returns absolute paths. Obviously there is no documentation
          // for the _expected_ behavior
          .map(iter => iter.filePath));
    }, { recurse })
    .then(() => fileList);
  }
}

export default Context;
