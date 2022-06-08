import { log, types, util } from 'vortex-api';

import { endMismatchDialog, setMismatchState} from '../actions/session';
import { IMismatch, IMismatchInfo, IMismatchState, IReportError, OperationType, StateCallback } from '../types/interface';

import DelegateBase from './DelegateBase';

import { inspect } from 'util';

import { generate } from 'shortid';

class UI extends DelegateBase {
  private mStateCB: StateCallback;
  private mCancelCB: () => void;
  constructor(api: types.IExtensionApi, gameId: string) {
    super(api);
    api.events
      .on('steamkit-mismatch-select', this.onMismatchSelect)
      .on('steamkit-mismatch-cancel', this.onMismatchCancel);
  }

  public detach() {
    this.api.events
      .removeListener('steamkit-mismatch-select', this.onMismatchSelect)
      .removeListener('steamkit-mismatch-cancel', this.onMismatchCancel);
  }

  public isVerifyingFiles = (dummy, callback: (err, res: string) => void) => {
    this.api.sendNotification({
      title: 'Verifying game files...',
      type: 'activity',
      id: 'steamkit_verifying_files',
      noDismiss: true,
      allowSuppress: false,
      message: 'User logged in - File verification is running',
    });
    callback(null, '');
  }

  public ratelimitExceeded = (dummy, callback: (err, res) => void) => {
    this.closeDialogs();
    this.api.emitAndAwait('steamkit-timedout-event')
      .then(() => {
        this.api.showDialog('info', 'Steam rate limit exceeded', {
          text: 'You have exceeded Steam\'s rate limit - please wait 5 minutes and try again',
        }, [
          { label: 'Close' },
        ], 'steam-rate-limit');
      });
    callback(null, '');
  }

  public timedOut = (opType: number, callback: (err, res: string) => void) => {
    this.closeDialogs();
    this.api.emitAndAwait('steamkit-timedout-event')
      .then(() => {
        this.api.showDialog('info', 'Steam connection expired due to inactivity', {
          text: 'Your connection to the Steam servers has expired due to inactivity. Please try again.',
        }, [
          { label: 'Cancel' },
          { label: 'Try Again', action: () => {
            const operation: OperationType = opType === 0 ? 'file_verification' : 'mod_download';
            this.api.events.emit('steamkit-restart', operation);
          }},
        ]);
      });
    callback(null, '');
  }

  public requestCredentials =
  (retry: boolean, callback: (err, res: string[]) => void) => {
    const t = this.api.translate;
    const retryText = `[br][/br][br][/br][color="red"]${t('The account name or password that you have entered is incorrect')}[/color]`;
    this.api.showDialog('question', 'Verify Integrity of Steam Game Files', {
      bbcode: t('If you are missing textures or other content in game, or experiencing '
          + 'crashing while playing a game, you can have Steam verify that the game\'s '
          + 'files are installed correctly on your computer. Steam will restore any '
          + 'original files that have been altered or are missing{{bl}}'
          + 'Note: this check is only available with Steam games and can not fix '
          + 'issues with mod conflicts.{{bl}}'
          + 'To continue, please enter your Steam credentials. If you are using Steam guard, '
          + 'you will have 30 seconds to enter your code on the next screen. Vortex will NOT '
          + 'store any of your credentials. {{retry}}', {
            replace: {
              bl: '[br][/br][br][/br]',
              retry: (retry === true) ? retryText : '',
            },
          }),
      input: [
        { id: 'Username', type: 'text', label: 'Username' },
        { id: 'Password', type: 'password', label: 'Password' },
      ],
    }, [
      { label: 'Cancel' },
      { label: 'Continue', default: true },
    ], 'steamkit-login-screen').then(res => {
      if (res.action === 'Cancel') {
        util.showError(this.api.store.dispatch,
          'Unable to complete Steam operation', 'User Canceled Login', { allowReport: false });
        callback(new util.UserCanceled(), null);
      } else {
        if (!!res.input['Username'] && !!res.input['Password']) {
          const inputResult = [res.input['Username'], res.input['Password']];
          callback(null, inputResult);
        } else {
          util.showError(this.api.store.dispatch,
            'Unable to complete Steam operation', 'Please provide valid credentials', { allowReport: false });
          callback(new util.UserCanceled(), null);
        }
      }
    });
  }

  public requestSteamGuard =
  (data: any, callback: (err, res: string) => void) => {
    this.api.showDialog('question', 'Steam Guard Code Required', {
      text: 'Steam has sent you a Steam Guard Code, this will be to either your email address or your Steam mobile app.\n'
          + 'Please enter the code below:\n\n'
          + 'Note: if you have not received your code, please check your spam folder or contact Steam support.',
      input: [
        { id: 'SteamGuard', type: 'text', label: 'Steam guard code', placeholder: 'Not case sensitive' },
      ],
    }, [
      { label: 'Cancel' },
      { label: 'Continue', default: true },
    ], 'steam-guard-dialog').then(res => {
      if (res.action === 'Cancel') {
        util.showError(this.api.store.dispatch,
          'Unable to complete Steam operation', 'User Canceled Login', { allowReport: false });
        callback(new util.UserCanceled(), null);
      } else {
        const value: string = res.input['SteamGuard'];
        if (!!value) {
          callback(null, value.toUpperCase());
        } else {
          callback(new util.UserCanceled(), null);
        }
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
    ], 'steam-2fa-dialog').then(res => {
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
  (res: string[], callback: (err, revalidate: string[]) => void) => {
    log('debug', 'reportMismatch', inspect(res, null));
    this.startDialog({
      mismatches: res,
      select: (selectedMismatches: string[]) => {
        callback(null, selectedMismatches);
        this.endMismatchDialog();
      },
      cancel: () => {
        callback(new util.UserCanceled(), null);
        this.endMismatchDialog();
      },
    });
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

  private closeDialogs = () => {
    this.api.closeDialog('steam-guard-dialog');
    this.api.closeDialog('steam-2fa-dialog');
    this.api.closeDialog('steamkit-login-screen');
  };

  private startDialog = (info: IMismatchInfo) => {
    const mismatches: IMismatch[] = info.mismatches.map(m => ({
      id: generate(),
      enabled: true,
      filePath: m,
    }));
    this.api.store.dispatch(setMismatchState({ mismatches }));
    this.mStateCB = info.select;
    this.mCancelCB = info.cancel;
  }

  private endMismatchDialog = () => {
    this.mStateCB = this.mCancelCB = undefined;
  }

  private onMismatchSelect = (mismatches: IMismatch[]) => {
    if (this.mStateCB !== undefined) {
      this.mStateCB(mismatches
          .filter(m => m.enabled)
          .map(m => m.filePath));
    }
  }

  private onMismatchCancel = () => {
    if (this.mCancelCB !== undefined) {
      this.mCancelCB();
    }
  }
}

export default UI;
