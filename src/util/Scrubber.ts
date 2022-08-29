import Client from 'node-rest-client';
import { fs, log, selectors, types, util } from 'vortex-api';

import { NoSteamDataException } from '../types/errors';
import { IModsCache, IWorkshopMod } from '../types/interface';

import { MODS_PER_PAGE } from '../constants';

export interface IQueryFilesParameters {
  appid?: string;
  key?: string;
  page?: number;
  publishedfileid?: string;
  filter?: string;
}

const MODS_PER_PAGE_PARAM = `&numperpage=${MODS_PER_PAGE}`;
const QUERY_LINK_TEMPLATE = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key={{key}}&appid={{appId}}&query_type=1&page={{page}}&creator_appid={{appId}}&return_children=true&return_short_description=true${MODS_PER_PAGE_PARAM}{{fileid}}{{title}}`;

export class ModScrubber {
  // Steam api key.
  private mApiKey: string;

  private mClient;
  // Steam app id
  private mAppId: string;
  private mCurrentAvailableTotal: number;
  private mApi: types.IExtensionApi;
  private mDataArray: IModsCache;
  private mGameMode: string;
  private mCurrentFilter: string;
  private onChangeCallback: (gameMode: string, totalMods: number) => void;

  constructor(api: types.IExtensionApi,
              onChangeCallback: (gameMode: string, totalMods: number) => void) {
    this.mApi = api;
    this.mClient = new Client.Client();
    this.onChangeCallback = onChangeCallback;
  }

  public init(appId: string, gameId: string, webApiKey: string) {
    this.reset();
    this.mApiKey = webApiKey;
    this.mAppId = appId;
    this.mGameMode = gameId;
    this.mDataArray = {};
    // this.start();
  }

  private async reset() {
    this.mDataArray = {};
    this.mCurrentAvailableTotal = 0;
    this.mAppId = undefined;
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
          if (!this.mCurrentAvailableTotal) {
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
    const { appid, key, page, publishedfileid } = parameters;
    const apiKey = this.stringValOrDefault<string>(key, this.mApiKey);
    const appId = this.stringValOrDefault<string>(appid, this.mAppId);
    const currPage = this.stringValOrDefault<number>(page, '1');
    let fileId = this.stringValOrDefault<string>(publishedfileid, '');
    if (fileId) {
      fileId = `&child_publishedfileid=${fileId}`;
    }

    let filter = this.mCurrentFilter;
    if (filter) {
      filter = `&search_text=${filter}`;
    }
    if (!appId) {
      return null;
    }
    const link: string = QUERY_LINK_TEMPLATE.replace(/{{appId}}/g, appId)
                                            .replace('{{key}}', apiKey)
                                            .replace('{{page}}', currPage)
                                            .replace('{{fileid}}', fileId)
                                            .replace('{{title}}', filter);
    return link;
  }

  private async startQuery(link: string): Promise<IWorkshopMod[]> {
    return this.scrub(link);
  }

  public availableTotal(): number {
    return this.mCurrentAvailableTotal ?? 0;
  }

  public async queryFileId(publishedfileid: string): Promise<IWorkshopMod> {
    const pages = Object.keys(this.mDataArray);
    for (const page of pages) {
      if (this.findFileIdInPage(publishedfileid, page)) {
        return this.findFileIdInPage(publishedfileid, page);
      }
    }
    const queryLink = this.generateLink({ publishedfileid, appid: this.mAppId });
    const data = await this.startQuery(queryLink);
    return (data.length > 0) ? data[0] : undefined;
  }

  public resetDataArray() {
    this.mDataArray = {};
  }

  public async scrubPage(query: IQueryFilesParameters): Promise<IWorkshopMod[]> {
    if (this.mDataArray[query.page] !== undefined) {
      return this.mDataArray[query.page];
    }
    if (query?.filter !== this.mCurrentFilter) {
      this.mCurrentFilter = query.filter;
    }
    const queryLink = this.generateLink(query);
    try {
      const res: IWorkshopMod[] = await this.startQuery(queryLink);
      this.mDataArray[query.page] = res;
      return res;
    } catch (err) {
      const allowReport = !(err instanceof NoSteamDataException);
      this.mApi.showErrorNotification('Failed to query Steam Workshop', err, { allowReport });
      return Promise.resolve([]);
    }
  }
}
