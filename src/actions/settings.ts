import { createAction } from 'redux-act';

export const setWebApiKey = createAction('SET_STEAM_WEB_API_KEY',
  (key: string) => ({ key }));
