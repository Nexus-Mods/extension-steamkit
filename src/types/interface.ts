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

  PubFile?: number;
  UgcId?: number;
  Branch?: string;
  BetaBranchPassword?: string;
  DepotIdList?: number[];
  ManifestIdList?: number[];
}

export interface IReportError {
  title: string;
  message: string;
  details: string;
}
