import Client from 'node-rest-client';
import { fs, log, selectors, types, util } from 'vortex-api';

import { insertMods, readCache } from '../cache';

import { NoSteamDataException } from '../types/errors';
import { IModsCache, IWorkshopMod } from '../types/interface';

import { MODS_PER_PAGE } from '../constants';

export interface IQueryFilesParameters {
  appid: string;
  key?: string;
  page?: number;
  publishedfileid?: string;
}

const MODS_PER_PAGE_PARAM = `&numperpage=${MODS_PER_PAGE}`;
const QUERY_LINK_TEMPLATE = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key={{key}}&appid={{appId}}&query_type=1&page={{page}}&creator_appid={{appId}}&return_children=true&return_short_description=true${MODS_PER_PAGE_PARAM}{{fileid}}`;

export class ModScrubber {
  // Steam api key.
  private mApiKey: string = '6180A3487F40BF0CC8E7CAC1903F2555';

  private mClient;
  // Steam app id
  private mAppId: string;
  private mCurrentAvailableTotal: number;
  private mApi: types.IExtensionApi;
  private mDataArray: IModsCache;
  private mCachingFilepath: string;
  private mGameMode: string;
  private onChangeCallback: (gameMode: string, totalMods: number) => void;

  constructor(api, onChangeCallback) {
    this.mApi = api;
    this.mClient = new Client.Client();
    this.onChangeCallback = onChangeCallback;
  }

  public async init(appId: string, cachingFilepath: string, gameId: string, webApiKey: string) {
    await this.reset();
    this.mApiKey = webApiKey;
    this.mAppId = appId;
    this.mCachingFilepath = cachingFilepath;
    this.mGameMode = gameId;
    this.mDataArray = await readCache(this.mApi, gameId);
    this.start();
  }

  private async reset() {
    this.mDataArray = {};
    this.mCurrentAvailableTotal = 0;
    this.mAppId = undefined;
    this.mCachingFilepath = undefined;
    this.mGameMode = undefined;
    this.mApiKey = undefined;
  }

  private findFileIdInPage(fileId: string, page: string) {
    return this.mDataArray[page]?.find(entry => entry.publishedfileid === fileId);
  }

  private isInCache(publishedfileId: string) {
    const reversed = Object.keys(this.mDataArray).reverse();
    for (const page of reversed) {
      const entry = this.findFileIdInPage(publishedfileId, page);
      if (entry !== undefined) {
        return true;
      }
    }
    return false;
  }

  private async scrub(qLink: string): Promise<IWorkshopMod[]> {
    if (!qLink) {
      return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
      try {
        this.mClient.get(qLink, async (data, response) => {
          if (response.statusCode !== 200) {
            return reject(new Error('Failed to query link'));
          }
          if (this.mCurrentAvailableTotal === 0 && data.response.total === 0) {
            return reject(new NoSteamDataException());
          }
          if (this.mCurrentAvailableTotal === 0) {
            this.mCurrentAvailableTotal = data.response.total;
          }

          const details = [];
          if (data.response.publishedfiledetails) {
            for (const fileDetails of data.response.publishedfiledetails) {
              if (fileDetails && !this.isInCache(fileDetails.publishedfileid)) {
                details.push(fileDetails);
              }
            }
          }
          return resolve(details);
        });
      } catch (err) {
        log('error', 'Failed to query link', err);
        return reject(err);
      }
    });
  }

  private stringValOrDefault<T>(val: T, defaultVal: string) {
    return (val) ? val.toString() : defaultVal;
  }

  private generateLink(parameters: IQueryFilesParameters): string {
    const state = this.mApi.getState();
    const { appid, key, page, publishedfileid } = parameters;
    const apiKey = this.stringValOrDefault<string>(key, this.mApiKey);
    const appId = this.stringValOrDefault<string>(appid, selectors.activeGameId(state));
    const currPage = this.stringValOrDefault<number>(page, '1');
    let fileId = this.stringValOrDefault<string>(publishedfileid, '');
    if (fileId) {
      fileId = `&child_publishedfileid=${fileId}`;
    }
    if (appid === undefined) {
      return null;
    }
    const link: string = QUERY_LINK_TEMPLATE.replace(/{{appId}}/g, appId)
                                            .replace('{{key}}', apiKey)
                                            .replace('{{page}}', currPage)
                                            .replace('{{fileid}}', fileId);
    return link;
  }

  private async startQuery(link: string): Promise<IWorkshopMod[]> {
    return this.scrub(link);
  }

  private async resolveNextPage(): Promise<number> {
    const data = await readCache(this.mApi, this.mGameMode);
    return Object.keys(data).length + 1;
  }

  private async start() {
    // First we need to get the total available mods - we do this by scrubbing
    //  the first page.
    const queryLink = this.generateLink({ appid: this.mAppId, key: this.mApiKey });
    try {
      const res = await this.startQuery(queryLink);
    } catch (err) {
      const allowReport = !(err instanceof NoSteamDataException);
      this.mApi.showErrorNotification('Failed to query Steam Workshop', err, { allowReport });
      return Promise.resolve();
    }

    // Now that we have the total, we can start by picking off from the last
    //  page number and generate all the links we need.
    const queryLinks: string[] = [];
    const startPage = await this.resolveNextPage();
    for (let page = startPage; page < this.mCurrentAvailableTotal; page++) {
      const link = this.generateLink({ appid: this.mAppId, key: this.mApiKey, page });
      queryLinks.push(link);
    }
    // Start scrubbing.
    for (const q of queryLinks) {
      let result: IWorkshopMod[] = [];
      try {
        result = await this.startQuery(q);
      } catch (err) {
        log('error', 'Failed to query Steam API servers', err);
        break;
      }
      await insertMods(this.mApi, this.mGameMode, result, () => {
        this.onChangeCallback(this.mGameMode, Object.keys(this.mDataArray).length * MODS_PER_PAGE);
      });
    }
  }
}
