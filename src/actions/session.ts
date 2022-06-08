import { createAction } from 'redux-act';
import { IMismatchState } from '../types/interface';

export const setCacheCounter = createAction('SET_CACHE_COUNTER',
  (gameMode: string, totalMods: number) => ({ gameMode, totalMods }));

export const endMismatchDialog = createAction('END_MISMATCH_DIALOG');

export const setMismatchState = createAction('SET_MISMATCH_DIALOG_STATE',
  (state: IMismatchState): any => state);
