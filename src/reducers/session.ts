import { types, util } from 'vortex-api';

import { endMismatchDialog, setCacheCounter, setMismatchState, setWorkshopModFilter } from '../actions/session';

export const sessionReducer: types.IReducerSpec = {
  reducers: {
    [setCacheCounter as any]: (state, payload) => {
      const { totalMods, gameMode } = payload;
      return (util.setSafe(state, ['cache', gameMode, 'totalMods'], totalMods));
    },
    [endMismatchDialog as any]:
        (state, payload) => util.setSafe(state, ['mismatches'], []),
    [setMismatchState as any]: (state, payload) => {
      const { mismatches } = payload;
      return util.setSafe(state, ['mismatches'], mismatches);
    },
    [setWorkshopModFilter as any]: (state, payload) => {
      const { filter } = payload;
      return util.setSafe(state, ['workshopModFilter'], filter);
    }
  },
  defaults: {},
};
