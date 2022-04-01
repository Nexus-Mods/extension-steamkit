import { types } from 'vortex-api';

class DelegateBase {
  private mApi;

  constructor(api: types.IExtensionApi) {
    this.mApi = api;
  }

  public detach(): void {
    // nop
  }

  get api(): types.IExtensionApi {
    return this.mApi;
  }
}

export default DelegateBase;
