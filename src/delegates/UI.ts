import { log, types, util } from 'vortex-api';

import { IReportError } from '../types/interface';

import DelegateBase from './DelegateBase';

import { inspect } from 'util';

class UI extends DelegateBase {
  constructor(api: types.IExtensionApi, gameId: string) {
    super(api);
  }

  public detach() {
    // nop
  }

  public requestCredentials =
  (data: any, callback: (err, res: string[]) => void) => {
    this.api.showDialog('question', 'Steam Credentials Required', {
      text: 'Please enter your Steam credentials.\n\n Please note: if you have '
          + 'SteamGuard or 2FA protection enabled, make sure you are able to enter '
          + 'these within 30 seconds of passing your credentials (SteamAPI timeout period).\n\n'
          + 'Vortex will NOT store any of your credentials.',
      input: [
        { id: 'Username', type: 'text', label: 'Username' },
        { id: 'Password', type: 'password', label: 'Password' },
      ],
    }, [
      { label: 'Cancel' },
      { label: 'Continue', default: true },
    ]).then(res => {
      if (res.action === 'Cancel') {
        util.showError(this.api.store.dispatch,
          'Unable to complete Steam operation', 'User Canceled Login', { allowReport: false });
        callback(new util.UserCanceled(), null);
      } else {
        const inputResult = [res.input['Username'], res.input['Password']];
        callback(null, inputResult);
      }
    });
  }

  public requestSteamGuard =
  (data: any, callback: (err, res: string) => void) => {
    this.api.showDialog('question', 'Steam Guard Key Required', {
      text: 'Steam should\'ve sent you an email with your Steam Guard Key, please enter that key below',
      input: [
        { id: 'SteamGuard', type: 'text', label: 'SteamGuard Key' },
      ],
    }, [
      { label: 'Cancel' },
      { label: 'Continue', default: true },
    ]).then(res => {
      if (res.action === 'Cancel') {
        util.showError(this.api.store.dispatch,
          'Unable to complete Steam operation', 'User Canceled Login', { allowReport: false });
        callback(new util.UserCanceled(), null);
      } else {
        callback(null, res.input['SteamGuard']);
      }
    });
  }

  public request2FA =
  (data: any, callback: (err, res: string) => void) => {
    this.api.showDialog('question', 'Two Factor Authentication Required', {
      text: 'Please authenticate using your 2FA application',
      input: [
        { id: '2FA', type: 'text', label: 'Two Factor Auth Key' },
      ],
    }, [
      { label: 'Cancel' },
      { label: 'Continue', default: true },
    ]).then(res => {
      if (res.action === 'Cancel') {
        util.showError(this.api.store.dispatch,
          'Unable to complete Steam operation', 'User Canceled Login', { allowReport: false });
        callback(new util.UserCanceled(), null);
      } else {
        callback(null, res.input['2FA']);
      }
    });
  }

  public reportMismatch =
  (res: string[], callback: (err, revalidate: boolean) => void) => {
    log('debug', 'reportMismatch', inspect(res, null));
    this.api.showDialog('question', 'Mistmatched files', {
      text: 'The following files need revalidation:',
      message: '{{invalid}}',
      parameters: { invalid: res.join('\n') },
    }, [
      { label: 'Cancel' },
      { label: 'Download and Replace Game Files' },
    ])
      .then(dialogRes => {
        if (dialogRes.action === 'Cancel') {
          callback(new util.UserCanceled(), null);
        } else {
          callback(null, true);
        }
      })
      .catch(err => { throw err; });
  }

  public reportError = (parameters: IReportError, callback: (err) => void) => {
    log('debug', 'reportError', inspect(parameters, null));
    try {
      let msg = parameters.message;
      if (!!(parameters.details)) {
        msg += '\n' + parameters.details;
      }
      this.api.showErrorNotification(parameters.title, parameters.details ?? undefined,
        { isHTML: true, allowReport: false, message: parameters.message });
      callback(null);
    } catch (err) {
      util.showError(this.api.store.dispatch,
        'Failed to display error message from installer', err);
      callback(err);
    }
  }
}

export default UI;
