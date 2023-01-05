export interface ISteamKitParameters {
  Username?: string;
  Password?: string;
  RememberPassword?: boolean;
  ManifestOnly?: boolean;
  CellId?: number;

  // Files need to be separated by /r or /n
  FileList?: string;
  InstallDirectory?: string;
  VerifyAll?: boolean;
  MaxServers?: number;
  MaxDownloads?: number;
  LoginId?: number;

  // Steam app id
  AppId?: number;

  PubFile?: string;
  UgcId?: string;
  Branch?: string;
  BetaBranchPassword?: string;
  DepotIdList?: number[];
  ManifestIdList?: number[];
}

export interface IModsCache { [page: string]: IWorkshopMod[]; }

export interface IWorkshopModInfo {
  name: string;
  subscriptions: number;
  preview_url: string;
  favorited: number;
  time_updated: number;
}

export interface IDependencyModInfo {
  // This is grim - we don't have a title or anything besides the ugcid...
  publishedfileid: string;
  creator_appid: number;
}

export interface IWorkshopMod {
  app_name: string;
  ban_reason: string;
  ban_text_check_result: number;
  banned: boolean;
  banner: string;
  can_be_deleted: boolean;
  can_subscribe: boolean;

  // Steam app id
  consumer_appid: number;
  consumer_shortcutid: number;
  creator: string;
  creator_appid: number;
  favorited: number;
  file_size: string;
  file_type: number;
  filename: string;
  flags: number;
  followers: number;
  short_description: string;
  lifetime_favorited: number;
  lifetime_followers: number;
  lifetime_playtime: string;
  lifetime_playtime_sessions: string;
  lifetime_subscriptions: number;
  maybe_inappropriate_sex: boolean;
  maybe_inappropriate_violence: boolean;
  num_children: number;
  preview_file_size: string;
  preview_url: string;

  // UGC id
  publishedfileid: string;
  subscriptions: number;
  time_created: number;
  time_updated: number;
  title: string;
  url: string;
  views: number;
  visibility: number;
  workshop_file: boolean;
  workshop_accepted: boolean;

  vote_data: {
    score: number;
    votes_up: number;
    votes_down: number;
  }
}

export interface IReportError {
  title: string;
  message: string;
  details: string;
}

export interface IMismatch {
  id: string;
  filePath: string;
  enabled: boolean;
}

export type StateCallback = (mismatches: string[]) => void;

export interface IMismatchInfo {
  mismatches: string[];
  select?: StateCallback;
  cancel?: () => void;
}

export interface IMismatchState {
  mismatches: IMismatch[];
}

export type OperationType = 'file_verification' | 'mod_download';
