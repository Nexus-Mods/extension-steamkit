import { types, util } from 'vortex-api';

import { setWebApiKey } from '../actions/settings';

export const settingsReducer: types.IReducerSpec = {
  reducers: {
    [setWebApiKey as any]: (state, payload) => {
      const { key } = payload;
      return (util.setSafe(state, ['WebAPIKey'], key));
    },
  },
  defaults: {
    WebAPIKey: undefined,
  },
};
