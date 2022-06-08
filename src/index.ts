import { actions, fs, log, selectors, types, util } from 'vortex-api';

import Core from './delegates/Core';
import { IMismatch, ISteamKitParameters, IWorkshopMod, OperationType } from './types/interface';

import { ChildProcess } from 'child_process';
import { createIPC } from './createIPC';

import * as net from 'net';
import * as path from 'path';
import { generate as shortid } from 'shortid';

import Settings from './views/Settings';
import WorkshopPage from './views/WorkshopPage';

import { findMod, getCachingPath, getPage, hasPage, resetCache } from './cache';
import { ModScrubber } from './util/Scrubber';

import MismatchDialog from './views/MismatchDialog';

import { addDownloadMetaData, addModMetaData, getFiles, packFiles } from './util/util';

import { endMismatchDialog, setCacheCounter, setMismatchState } from './actions/session';
import { sessionReducer } from './reducers/session';

import { setWebApiKey } from './actions/settings';
import { settingsReducer } from './reducers/settings';

import { STEAM_WEB_API_URL } from './constants';

const SENSITIVE_DATA = ['requestCredentials', 'requestSteamGuard', 'request2FA'];

interface IAwaitingPromise {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

function transformError(err: any): Error {
  let result: Error;
  if (err === undefined) {
    result = new Error('unknown error');
  } else if (err.name === 'DepotDownloader.InvalidCredentialsException') {
    result = new util.ProcessCanceled('Invalid Steam Credentials');
  }

  if (result === undefined) {
    result = new Error(err.name ?? err.Message ?? 'unknown error');
  }
  [
    { in: 'StackTrace', out: 'stack' },
    { in: 'stack', out: 'stack' },
    { in: 'FileName', out: 'path' },
    { in: 'message', out: 'message' },
    { in: 'HResult', out: 'code' },
    { in: 'name', out: 'Name' },
    { in: 'Source', out: 'Module' },
    { in: 'data', out: 'data' },
  ].forEach(transform => {
    if (err[transform.in] !== undefined) {
      result[transform.out] = err[transform.in];
    }
  });

  return result;
}

function jsonReplace(key: string, value: any) {
  return (typeof(value) === 'object' && value?.type === 'Buffer')
    ? { type: 'Buffer', data: Buffer.from(value.data).toString('base64') }
    : value;
}

function makeJsonRevive(invoke: (data: any) => Promise<void>, getId: () => string) {
  return (key: string, value: any) => {
    if (!!(value) && (typeof (value) === 'object')) {
      if (value.type === 'Buffer') {
        return Buffer.from(value.data, 'base64');
      }
      Object.keys(value).forEach(subKey => {
        if (!!(value[subKey])
          && (typeof (value[subKey]) === 'object')
          && (value[subKey].__callback !== undefined)) {
          const callbackId = value[subKey].__callback;
          value[subKey] = (...args: any[]) => {
            invoke({ requestId: getId(), callbackId, args })
              .catch(err => {
                log('info', 'process data', err.message);
              });
          };
        }
      });
    }
    return value;
  };
}

interface ICreateSocketOptions {
  // if true, use a pipe. windows only
  pipe: boolean;
  // if true, use a fixed id/port for the connection
  debug: boolean;
}

/**
 * create a socket that will be used to communicate with the depot downloader process
 * @param options options that control how the socket is created
 */
function createSocket(options: ICreateSocketOptions)
    : Promise<{ ipcId: string, server: net.Server }> {
  return new Promise((resolve, reject) => {
    try {
      const server = new net.Server();
      server.on('error', err => {
        reject(err);
      });
      if (options.pipe && !options.debug) {
        // on windows, using a socket is a pita because firewalls and AVs...
        const ipcId = options.debug ? 'debug' : shortid();
        server.listen(`\\\\?\\pipe\\${ipcId}`, () => {
          resolve({ ipcId, server });
        });
      } else {
        const port = options.debug ? 12346 : 0;
        server.listen(port, 'localhost', () => {
          const ipcId = (server.address() as net.AddressInfo).port.toString();
          resolve({ ipcId, server });
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

function createConnection(ipcPath: string, tries: number = 5): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const errCB = err => {
      if ((err['code'] === 'ENOENT') && (tries > 0)) {
        util.delay(1000)
          .then(() => createConnection(ipcPath, tries - 1))
          .then(resolve)
          .catch(reject);
      } else {
        err.message = err.message.replace(ipcPath, '<ipc path>');
        reject(err);
      }
    };

    const sock = net.createConnection(ipcPath, () => {
      sock.off('error', errCB);
      resolve(sock);
    });
    sock.on('error', errCB);
  });
}

class ConnectionIPC {
  public static async bind(retry: boolean = false): Promise<ConnectionIPC> {
    let proc: ChildProcess = null;
    let onResolve: () => void;
    let onReject: (err: Error) => void;
    const connectedPromise = new Promise<void>((resolve, reject) => {
      onResolve = resolve;
      onReject = reject;
    });
    let wasConnected = false;
    let servSocket: net.Socket;
    let cliSocket: net.Socket;

    // on windows, retry using a network socket, maybe that will work
    const pipe = (process.platform === 'win32') && !retry;
    const debug = false;

    if ((ConnectionIPC.sListen === undefined) || retry) {
      // only set up the listening server once, otherwise we might end
      // up creating orphaned connections if a connection later dies
      ConnectionIPC.sListen = await createSocket({
        pipe,
        debug,
      });
    } else {
      ConnectionIPC.sListen.server.removeAllListeners('connection');
    }

    const { server, ipcId } = ConnectionIPC.sListen;

    log('debug', '[steamkit] waiting for peer process to connect', { pipe, ipcId });

    server.on('connection', sock => {
      log('debug', '[steamkit] peer connected');
      sock.setEncoding('utf8');
      if (!wasConnected) {
        wasConnected = true;
        servSocket = sock;
        if (pipe && !debug) {
          log('debug', '[steamkit] connecting to reply pipe');
          createConnection(`\\\\?\\pipe\\${ipcId}_reply`)
          .then(sockIn => {
            log('debug', '[steamkit] reply pipe connected');
            sockIn.setEncoding('utf-8');
            sockIn.on('error', err => {
              log('error', '[steamkit] socket error', err.message);
            });
            cliSocket = sockIn;
            onResolve();
          })
          .catch(err => {
            onReject(err);
          });
        } else {
          cliSocket = servSocket;
          onResolve();
        }
      }
    });

    let res: ConnectionIPC;

    let connectOutcome: null | Error;
    let setConnectOutcome = (error: Error) => {
      if (connectOutcome === undefined) {
        connectOutcome = error;
      }
    };

    const awaitConnected = async () => {
      if (connectOutcome !== undefined) {
        return connectOutcome === null ? Promise.resolve() : Promise.reject(connectOutcome);
      } else {
        setConnectOutcome = (error: Error) => {
          if (error === null) {
            onResolve?.();
          } else {
            onReject?.(error);
          }
          onResolve = onReject = undefined;
        };
        return connectedPromise;
      }
    };

    if (!debug) {
      try {
        proc = await createIPC(pipe, ipcId, procCB => {
          procCB.stdout.on('data', (dat: Buffer) => {
            log('debug', 'from depot downloader:', dat.toString().trim());
          });
          procCB.stderr.on('data', async (dat: Buffer) => {
            const errorMessage = dat.toString().trim();
            if (!retry && errorMessage.includes('The operation has timed out')) {
              // if the client failed to connect to our pipe, try a second time connecting
              // via socket
              try {
                res = await ConnectionIPC.bind(true);
                setConnectOutcome(null);
              } catch (err) {
                setConnectOutcome(err);
              }
            } else if (errorMessage.length > 0) {
              log('error', 'from depot downloader:', errorMessage);
              if (!wasConnected) {
                const err = new Error(errorMessage);
                err['attachLogOnReport'] = true;
                setConnectOutcome(err);
                wasConnected = true;
              }
            }
          });
        });
      } catch (err) {
        setConnectOutcome(err);
      }
    }

    // wait until the child process has actually connected, any error in this phase
    // probably means it's not going to happen...
    await awaitConnected();

    if (res === undefined) {
      return new ConnectionIPC({ in: cliSocket, out: servSocket }, proc);
    }
    return res;
  }

  private static sListen: { ipcId: string, server: net.Server };

  private mSocket: { in: net.Socket, out: net.Socket };
  private mProcess: ChildProcess;
  private mAwaitedReplies: { [id: string]: IAwaitingPromise } = {};
  private mDelegates: { [id: string]: Core } = {};
  private mOnInterrupted: (err: Error) => void;
  private mReceivedBuffer: string;
  private mActionLog: string[];
  private mOnDrained: Array<() => void> = [];

  constructor(socket: { in: net.Socket, out: net.Socket }, proc: ChildProcess) {
    this.mSocket = socket;
    this.mProcess = proc;
    this.mActionLog = [];

    if (this.mProcess !== null) {
      this.mProcess.on('exit', async (code, signal) => {
        log(code === 0 ? 'info' : 'error', 'remote process exited', { code, signal });
        try {
          await util.toPromise(cb => socket.out.end(cb));
          this.interrupt(new Error(`Process quit unexpectedly (Code ${code})`));
        } catch (err) {
          log('warn', 'failed to close connection to depot downloader process', err.message);
        }
      });
    }

    this.mSocket.out.on('drain', (hadError) => {
      this.mOnDrained.forEach(cb => cb());
      this.mOnDrained = [];
    });

    this.mSocket.in.on('close', async () => {
      log('info', 'remote was disconnected');
      Object.keys(this.mAwaitedReplies).forEach(replyId => {
        this.mAwaitedReplies[replyId].reject(new util.ProcessCanceled('remote was disconnected'));
        delete this.mAwaitedReplies[replyId];
      });
      this.mSocket.out.destroy();
      try {
        // just making sure, the remote is probably closing anyway
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.mSocket.in.destroy();
        this.mSocket = undefined;
        this.interrupt(new Error(`Process disconnected unexpectedly`));
      } catch (err) {
        // nop
      }
    });
  }

  public handleMessages() {
    this.mSocket.in.on('data', (data: string) => {
      this.logAction(`receiving ${data.length} bytes`);
      if (data.length > 0) {
        this.mReceivedBuffer = (this.mReceivedBuffer === undefined)
          ? data
          : this.mReceivedBuffer + data;
        if (this.mReceivedBuffer.endsWith('\uffff')) {
          this.logAction(`processing ${this.mReceivedBuffer.length} bytes`);
          try {
            this.processData(this.mReceivedBuffer);
            this.mReceivedBuffer = undefined;
          } catch (err) {
            log('error', 'failed to parse data from remote process', err.message);
            this.mReceivedBuffer = undefined;
          }
        }
      }
    })
    .on('error', (err) => {
      log('error', 'ipc socket error', err.message);
    });
  }

  public closeAllAwaitedReplies() {
    Object.keys(this.mAwaitedReplies).forEach(replyId => {
      this.mAwaitedReplies[replyId].reject(new util.ProcessCanceled('timed out'));
      delete this.mAwaitedReplies[replyId];
    });
  }

  public isActive(): boolean {
    // kill accepts numeric signal codes and returns a boolean to signal success
    // For some reason the type declaration is incomplete
    return (this.mProcess !== null) ||  (this.mProcess?.kill as any)?.(0);
  }

  public async sendMessage(command: string, data: any, delegate?: Core): Promise<any> {
    // reset action log because we're starting a new exchange
    this.mActionLog = [];
    return Promise.race([
      this.interruptible(),
      this.sendMessageInner(command, data, delegate),
    ]);
  }

  private logAction(message: string) {
    this.mActionLog.push(message);
  }

  private async interruptible() {
    return new Promise((resolve, reject) => {
      this.mOnInterrupted = reject;
    });
  }

  private async sendMessageInner(command: string, data: any, delegate?: Core): Promise<any> {
    const id = shortid();

    const res = new Promise((resolve, reject) => {
      this.mAwaitedReplies[id] = { resolve, reject };
      if (delegate !== undefined) {
        this.mDelegates[id] = delegate;
      }
    });

    if (SENSITIVE_DATA.includes(data?.name)) {
      this.logAction(`sending cmd ${command}`);
    } else {
      this.logAction(`sending cmd ${command}: ${JSON.stringify(data)}`);
    }

    const outData = JSON.stringify({
      id,
      payload: {
        ...data,
        command,
      },
    }, jsonReplace);

    const written = this.mSocket.out.write(outData + '\uFFFF');
    if (!written) {
      await new Promise<void>(resolve => {
        this.mOnDrained.push(resolve);
      });
    }

    return res;
  }

  private copyErr(input: Error): any {
    if (input === null) {
      return null;
    }
    return {
      message: input.message,
      name: input.name,
      code: input['code'],
    };
  }

  private processData(data: string) {
    // there may be multiple messages sent at once
    const messages = data.split('\uFFFF');
    messages.forEach(msg => {
      if (msg.length > 0) {
        try {
          this.logAction(`processing message "${this.mReceivedBuffer}"`);
          this.processDataImpl(msg);
        } catch (err) {
          log('error', 'failed to parse', { input: msg, error: err.message });
        }
      }
    });
  }

  private processDataImpl(msg: string) {
    const data: any = JSON.parse(msg, makeJsonRevive((payload) =>
      this.sendMessageInner('Invoke', payload), () => data.id));
    if (data.id === 'parseerror') {
      const err = new Error(data.error.message);
      err.stack = data.error.stack;
      if (!!(data.error.name)) {
        err.name = data.error.name;
      }
      Object.keys(this.mAwaitedReplies).forEach(replyId => {
        this.mAwaitedReplies[replyId].reject(err);
        delete this.mAwaitedReplies[replyId];
      });
    } else if ((data.callback !== null)
        && (this.mDelegates[data.callback.id] !== undefined)) {
      const func = this.mDelegates[data.callback.id][data.callback.type][data.data.name];
      func(...data.data.args, (err, response) => {
        this.sendMessageInner(`Reply`, { request: data, data: response, error: this.copyErr(err) })
          .catch(e => {
            log('info', 'process data', e.message);
          });
      });
    } else if (this.mAwaitedReplies[data.id] !== undefined) {
      if (data.error !== null) {
        const err = new Error(data.error.message);
        err.stack = data.error.stack;
        if (!!(data.error.name)) {
          err.name = data.error.name;
        }
        if (!!(data.error.data)) {
          err['data'] = data.error.data;
        }
        this.mAwaitedReplies[data.id].reject(err);
      } else {
        this.mAwaitedReplies[data.id].resolve(data.data);
      }
      delete this.mAwaitedReplies[data.id];
    }
  }

  private interrupt(err: Error) {
    if (this.mSocket?.out !== this.mSocket?.in) {
      this.mSocket?.out?.end();
    }
    this.mSocket?.in?.end();

    log('warn', 'interrupted, recent actions', JSON.stringify(this.mActionLog, undefined, 2));
    if (this.mOnInterrupted !== undefined) {
      this.mOnInterrupted(err);
      this.mOnInterrupted = undefined;
    }
  }
}
const ensureConnected = (() => {
  let conn: ConnectionIPC;
  return async (): Promise<ConnectionIPC> => {
    // if (conn === undefined) {
    if ((conn === undefined) || !conn.isActive()) {
      conn = await ConnectionIPC.bind();
      log('debug', '[steamkit] connection bound');
      conn.handleMessages();
    }
    return Promise.resolve(conn);
  };
})();

async function VerifyFiles(parameters: ISteamKitParameters,
                           progressDelegate: types.ProgressDelegate,
                           coreDelegates: Core): Promise<void> {
  const connection = await ensureConnected();
  return connection.sendMessage('VerifyFiles', { ...parameters, progressDelegate }, coreDelegates)
    .catch(err => Promise.reject(transformError(err)));
}

async function downloadMod(parameters: ISteamKitParameters,
                           progressDelegate: types.ProgressDelegate,
                           coreDelegates: Core): Promise<void> {
const connection = await ensureConnected();
return connection.sendMessage('DownloadMod', { ...parameters, progressDelegate }, coreDelegates)
  .catch(err => Promise.reject(transformError(err)));
}

async function onGameModeActivated(api: types.IExtensionApi, gameMode: string) {
  resetCache();
}

const normalizePath = (filePath: string) => {
  return path.normalize(filePath.toLowerCase())
    .replace(/[(\/)(\\)]/g, '/')
    .replace(/(\/)+$/g, '');
};

function purge(api: types.IExtensionApi) {
  return new Promise<void>((resolve, reject) =>
    api.events.emit('purge-mods', true, (err) => err ? reject(err) : resolve()));
}

function showSteamWebApiDialog(api: types.IExtensionApi) {
  const t = api.translate;
  return api.showDialog('question', 'Steam Web API Key required', {
    bbcode: t('To browse Steam Workshop mods within Vortex, a Steam Web API key is required. '
            + 'The API key can be generated at the below link (use any domain name); once generated, paste it into the '
            + 'input box.[br][/br][br][/br]'
            + '[url]'
            + `${STEAM_WEB_API_URL}`
            + '[/url][br][/br][br][/br]'
            + 'Please note: the API Key is stored confidentially in your application state to avoid '
            + 'having to re-type it. You can reset the API key at any point in the '
            + 'Settings page.'),
    input: [
      { id: 'apikey', label: 'Steam Web API Key' },
    ],
  }, [
    { label: 'Cancel' },
    { label: 'Confirm' },
  ]);
}

function raiseNotASteamGameNotif(api: types.IExtensionApi) {
  api.sendNotification({
    type: 'error',
    message: 'Must be a Steam game to verify file integrity',
    actions: [
      {
        title: 'More',
        action: () => api.showDialog('error', 'Must be a Steam Game', {
          text: 'Steam file integrity verification is a service provided by Steam '
              + 'that detects and replaces files that have either been altered or '
              + 'are missing from the original installation. For this reason this '
              + 'feature will only work for games installed via Steam.',
        }, [
          { label: 'Close' },
        ]),
      },
    ],
  });
}

function init(context: types.IExtensionContext): boolean {
  context.registerReducer(['session', 'steamkit'], sessionReducer);
  context.registerReducer(['settings', 'steamkit'], settingsReducer);
  let downloadQueue;
  let modScrubber: ModScrubber;
  let _mismatches: IMismatch[] = [];
  util.installIconSet('steam', path.join(__dirname, 'icons.svg'));
  const verifyIsSteamGame = async (parameters: ISteamKitParameters,
                                   discovery: types.IDiscoveryResult) => {
    let gameEntry;
    try {
      gameEntry = await util.GameStoreHelper.findByAppId([parameters.AppId.toString()], 'steam');
    } catch (err) {
      return Promise.reject(new Error('Not a Steam game'));
    }
    return (normalizePath(gameEntry.gamePath) === normalizePath(discovery.path))
      ? Promise.resolve()
      : Promise.reject(new Error('Not a Steam game'));
  };

  const verifyFilesWrap = async (parameters: ISteamKitParameters, gameId: string) => {
    _mismatches = [];
    const state = context.api.getState();
    const discovery = selectors.discoveryByGame(state, gameId);
    try {
      await verifyIsSteamGame(parameters, discovery);
    } catch (err) {
      raiseNotASteamGameNotif(context.api);
      return;
    }

    try {
      await purge(context.api);
    } catch (err) {
      context.api.showErrorNotification('Failed to purge mods', err);
      return;
    }
    const coreDelegates = new Core(context.api, gameId);
    const progress = (perc: number) => {
      context.api.sendNotification({
        title: 'Verifying game files...',
        type: 'activity',
        id: 'steamkit_verifying_files',
        message: 'Patience is a virtue...',
        noDismiss: true,
        allowSuppress: false,
        progress: perc,
      });
    };
    let hadError = false;
    try {
      context.api.sendNotification({
        title: 'Verifying game files...',
        type: 'activity',
        id: 'steamkit_verifying_files',
        noDismiss: true,
        allowSuppress: false,
        message: 'Connecting to Steam servers',
      });
      await VerifyFiles(parameters, progress, coreDelegates);
      return Promise.resolve();
    } catch (err) {
      hadError = true;
      context.api.showErrorNotification('File integrity checks failed', err);
      return Promise.resolve();
    } finally {
      context.api.dismissNotification('steamkit_verifying_files');
      if (!hadError) {
        if (_mismatches.length > 0) {
          const game = util.getGame(gameId);
          context.api.sendNotification({
            title: 'Steam game files successfully restored',
            message: game.name,
            type: 'success',
            actions: [
              {
                title: 'View',
                action: () => context.api.showDialog('info', 'Steam game files successfully restored',
                {
                  text: 'Steam file integrity service has restored the following original games files:',
                  message: _mismatches.filter(m => m.enabled).map(m => m.filePath).join('\n'),
                }, [ { label: 'Close' } ])},
            ],
          });
        } else {
          context.api.sendNotification({
            title: 'Steam file integrity verification successful',
            message: 'Original game files are installed correctly',
            type: 'success',
            displayMS: 3000,
          });
        }
      }
      context.api.store.dispatch(actions.setDeploymentNecessary(gameId, true));
      coreDelegates.detach();
    }
  };

  const downloadWorkshopMod = async (parameters: ISteamKitParameters, gameId: string) => {
    const coreDelegates = new Core(context.api, gameId);
    let hadError = false;
    try {
      context.api.sendNotification({
        title: `Downloading ${parameters.PubFile}`,
        type: 'activity',
        id: 'steamkit_downloading_mod',
        message: 'Connecting to SteamAPI servers',
      });
      await downloadMod(parameters, null, coreDelegates);
    } catch (err) {
      context.api.showErrorNotification('Failed to download mod', err);
      hadError = true;
      return Promise.reject(err);
    } finally {
      context.api.dismissNotification('steamkit_downloading_mod');
      context.api.sendNotification({
        message: (hadError)
          ? 'Failed to download mod'
          : 'Mod downloaded',
        type: hadError ? 'warning' : 'success',
        displayMS: 3000,
      });
      coreDelegates.detach();
    }
  };
  // context.registerMainPage('steam', 'Steam Workshop', WorkshopPage, {
  //   hotkeyRaw: 'F1',
  //   group: 'global',
  //   visible: () => {
  //     const state = context.api.getState();
  //     const gameMode = selectors.activeGameId(state);
  //     if (!gameMode) {
  //       return false;
  //     }
  //     const game = util.getGame(gameMode);
  //     return (game?.details?.steamAppId !== undefined);
  //   },
  //   props: () => ({
  //     t: context.api.translate,
  //     onRefreshWorkshopMods: async (gameId: string, page: number) => {
  //       try {
  //         const modList = await getPage(context.api, gameId, page);
  //         const state = context.api.getState();
  //         const game = selectors.gameById(state, gameId);
  //         const discovery = selectors.discoveryByGame(state, gameId);
  //         await verifyIsSteamGame({ AppId: game?.details?.steamAppId }, discovery);
  //         let webApiKey = util.getSafe(state, ['settings', 'steamkit', 'WebAPIKey'], undefined);
  //         if (webApiKey === undefined) {
  //           const t = context.api.translate;
  //           await showSteamWebApiDialog(context.api)
  //             .then(result => {
  //               if (result.action === 'Confirm' && !!result.input['apikey']) {
  //                 webApiKey = result.input['apikey'];
  //                 context.api.store.dispatch(setWebApiKey(result.input['apikey']));
  //               } else {
  //                 context.api.sendNotification({
  //                   message: 'Unable to query Steam web API servers',
  //                   type: 'warning',
  //                   displayMS: 3000,
  //                 });
  //                 return Promise.resolve([]);
  //               }
  //             });
  //         }
  //         modScrubber.init(game.details.steamAppId,
  //           getCachingPath(context.api, gameId), gameId, webApiKey);
  //         return Promise.resolve(modList);
  //       } catch (err) {
  //         if (err.message === 'Not a Steam game') {
  //           raiseNotASteamGameNotif(context.api);
  //         } else {
  //           context.api.showErrorNotification('Unable to refresh workshop list', err);
  //         }
  //         return Promise.resolve([]);
  //       }
  //     },
  //     onGetPage: async (page: number) => {
  //       if (page <= 0) {
  //         return Promise.resolve(false);
  //       }
  //       const state = context.api.getState();
  //       const gameMode = selectors.activeGameId(state);
  //       return hasPage(context.api, gameMode, page);
  //     },
  //     onModClick: async (mod: IWorkshopMod) => {
  //       const state = context.api.getState();
  //       const gameMode = selectors.activeGameId(state);
  //       const tempPath = util.getVortexPath('temp');
  //       const addToQueue = (queued: IWorkshopMod) => {
  //         downloadQueue(async () => {
  //           const modPath = path.join(tempPath,
  //             gameMode, queued.title.replace(/[^a-zA-Z0-9.]/gm, ''));
  //           await fs.ensureDirWritableAsync(modPath);
  //           const params: ISteamKitParameters = {
  //             AppId: queued.creator_appid,
  //             InstallDirectory: modPath,
  //             PubFile: queued.publishedfileid,
  //           };
  //           try {
  //             await downloadWorkshopMod(params, gameMode);
  //           } catch (err) {
  //             return Promise.resolve();
  //           }
  //           const files = await getFiles(modPath);
  //           await packFiles(modPath, files, `${modPath}.7z`);
  //           await new Promise<void>((resolve) =>
  //             context.api.events.emit('import-downloads', [ `${modPath}.7z` ],
  //             async (dlIds: string[]) => {
  //               if (dlIds.length === 0) {
  //                 context.api.showErrorNotification('Failed to import archive', `${modPath}.zip`);
  //                 return resolve();
  //               }

  //               for (const dlId of dlIds) {
  //                 addDownloadMetaData(context.api, queued, dlId, gameMode);
  //               }

  //               return resolve();
  //           }));
  //         });
  //       };
  //       if (mod.num_children > 0) {
  //         for (const child of mod['children']) {
  //           const childMod = await findMod(context.api, gameMode, child.publishedfileid);
  //           if (childMod !== undefined) {
  //             addToQueue(childMod);
  //           }
  //         }
  //       }
  //       addToQueue(mod);
  //     },
  //   }),
  // } as any);

  context.registerAction('mod-icons', 300, 'steam', {}, 'Verify Files', () => {
    const state = context.api.getState();
    const gameMode = selectors.activeGameId(state);
    const discovery = selectors.discoveryByGame(state, gameMode);
    const game = util.getGame(gameMode);
    const parameters: ISteamKitParameters = {
      AppId: (game?.details?.steamAppId || game?.environment?.steamAppId),
      VerifyAll: true,
      ManifestOnly: true,
      InstallDirectory: discovery.path,
    };
    if (!parameters.AppId) {
      context.api.showErrorNotification('Failed to verify file integrity', 'Cannot resolve SteamAppId',
        { allowReport: game.contributed ? false : true });
      return;
    }
    verifyFilesWrap(parameters, gameMode);
  }, () => {
    const state = context.api.store.getState();
    const gameMode = selectors.activeGameId(state);
    const game = util.getGame(gameMode);
    return ((game?.details?.hideSteamKit !== true)
         && (game?.details?.steamAppId || game?.environment?.steamAppId)) !== undefined;
  });

  context.registerAPI('steamkitVerifyFileIntegrity', (parameters: ISteamKitParameters,
                                                      gameId: string,
                                                      callback: (err, result) => void) => {
    verifyFilesWrap(parameters, gameId);
  }, { minArguments: 2 });

  // context.registerSettings('Interface', Settings, () => ({
  //   t: context.api.translate,
  //   onSetSteamWebAPIKey: () => showSteamWebApiDialog(context.api)
  //     .then(result => {
  //       if (result.action === 'Confirm' && !!result.input['apikey']) {
  //         context.api.store.dispatch(setWebApiKey(result.input['apikey']));
  //       }
  //     }),
  // }), () => true, 51);

  context.registerDialog('mismatched-files-dialog', MismatchDialog, () => ({
    onSelect: (mismatches: IMismatch[]) => {
      _mismatches = mismatches;
      context.api.store.dispatch(endMismatchDialog());
      if (mismatches?.length > 0) {
        context.api.sendNotification({
          title: 'Restoring Steam game files...',
          type: 'activity',
          noDismiss: true,
          allowSuppress: false,
          id: 'steamkit_verifying_files',
          message: 'Downloading files from Steam servers',
        });
      }
      context.api.events.emit('steamkit-mismatch-select', mismatches);
    },
    onCancel: () => {
      context.api.store.dispatch(endMismatchDialog());
      context.api.events.emit('steamkit-mismatch-cancel');
    },
  }));

  context.once(() => {
    modScrubber = new ModScrubber(context.api, (gameMode: string, totalMods: number) => {
      context.api.store.dispatch(setCacheCounter(gameMode, totalMods));
    });

    context.api.onAsync('steamkit-timedout-event', async () => {
      try {
        const connection = await ensureConnected();
        connection.closeAllAwaitedReplies();
        return Promise.resolve();
      } catch (err) {
        log('error', 'failed to close all replies', err);
        return Promise.resolve();
      }
    });

    downloadQueue = util.makeQueue<any>();

    context.api.events.on('steamkit-restart', (op: OperationType) => {
      if (op === 'file_verification') {
        const state = context.api.getState();
        const gameMode = selectors.activeGameId(state);
        const discovery = selectors.discoveryByGame(state, gameMode);
        const game = util.getGame(gameMode);
        const parameters: ISteamKitParameters = {
          AppId: (game?.details?.steamAppId || game?.environment?.steamAppId),
          VerifyAll: true,
          ManifestOnly: true,
          InstallDirectory: discovery.path,
        };
        if (!parameters.AppId) {
          context.api.showErrorNotification('Failed to verify file integrity', 'Cannot resolve SteamAppId',
            { allowReport: game.contributed ? false : true });
          return;
        }
        verifyFilesWrap(parameters, gameMode);
      }
    });

    context.api.events.on('gamemode-activated',
      async (gameMode: string) => onGameModeActivated(context.api, gameMode));

    context.api.events.on('did-install-mod', (gameId, archiveId, modId) => {
      const state = context.api.getState();
      const download: types.IDownload = state.persistent.downloads?.files?.[archiveId];
      const steamkitMod = download.modInfo?.steamkit !== undefined
        ? JSON.parse(download.modInfo?.steamkit) as IWorkshopMod
        : undefined;
      if (steamkitMod) {
        addModMetaData(context.api, steamkitMod, modId, gameId);
      }
    });
    context.api.setStylesheet('workshoppagestyle', path.join(__dirname, 'workshop.scss'));
  });

  return true;
}

export default init;
