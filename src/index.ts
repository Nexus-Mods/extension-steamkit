import { log, selectors, types, util } from 'vortex-api';

import Core from './delegates/Core';
import { ISteamKitParameters } from './types/interface';

import Bluebird from 'bluebird';
import { ChildProcess } from 'child_process';
import { createIPC } from './createIPC';

import * as net from 'net';
import * as path from 'path';
import * as semver from 'semver';
import { generate as shortid } from 'shortid';

const SENSITIVE_DATA = ['requestCredentials', 'requestSteamGuard', 'request2FA'];
const DOTNET6 = 'https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/runtime-desktop-6.0.3-windows-x64-installer';

function checkNetInstall(): Bluebird<types.ITestResult> {
  const { exec } = require('child_process');
  return new Bluebird<types.ITestResult>((resolve, reject) => {
    exec('dotnet --version', (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      } else {
        try {
          const match = stdout.trim().match(/6\.0\.\d/gm);
          const version = util.semverCoerce(match[0]);
          if (!version) {
            reject(new Error('Incorrect dotnet version'));
          }
          return (semver.gte(version, '6.0.0'))
            ? resolve(undefined)
            : reject(new Error('Incorrect dotnet version'));
        } catch (err) {
          return reject(new Error('Incorrect dotnet version'));
        }
      }
    });
  })
  .catch(err => {
    if (err.message.indexOf('Incorrect') === -1) {
      log('error', 'failed to parse/coerce dotnet version', err);
    }
    const res: types.ITestResult = {
      description: {
        short: '.NET 6.0 required',
        long: 'Steam Depot Downloader requires .NET 6.0 runtime in order '
            + 'to function.',
      },
      automaticFix: () => util.opn(DOTNET6).catch(() => null),
      severity: 'error',
    };
    return Bluebird.resolve(res);
  });
}

interface IAwaitingPromise {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
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
  return connection.sendMessage('VerifyFiles', { ...parameters, progressDelegate }, coreDelegates);
}

const normalizePath = (filePath: string) => {
  return path.normalize(filePath.toLowerCase())
    .replace(/[(\/)(\\)]/g, '/')
    .replace(/(\/)+$/g, '');
};

function init(context: types.IExtensionContext): boolean {
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
    const state = context.api.getState();
    const discovery = selectors.discoveryByGame(state, gameId);
    try {
      await verifyIsSteamGame(parameters, discovery);
    } catch (err) {
      context.api.showErrorNotification('Failed to verify file integrity',
          err, { allowReport: false });
      return;
    }
    const coreDelegates = new Core(context.api, gameId);
    const progress = (perc: number) => {
      context.api.sendNotification({
        title: 'Verifying game files...',
        type: 'activity',
        id: 'steamkit_verifying_files',
        message: 'Patience is a virtue...',
        progress: perc,
      });
    };
    let hadError = false;
    try {
      context.api.sendNotification({
        title: 'Verifying game files...',
        type: 'activity',
        id: 'steamkit_verifying_files',
        message: 'Connecting to SteamAPI servers',
      });
      await VerifyFiles(parameters, progress, coreDelegates);
      return Promise.resolve();
    } catch (err) {
      hadError = true;
      return Promise.reject(err);
    } finally {
      context.api.dismissNotification('steamkit_verifying_files');
      context.api.sendNotification({
        message: (hadError)
          ? 'File integrity checks failed'
          : 'File integrity checks finished',
        type: hadError ? 'warning' : 'success',
        displayMS: 3000,
      });
      coreDelegates.detach();
    }
  };

  context.registerAction('mod-icons', 300, 'steam', {}, 'Verify File Integrity', () => {
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

  // if (process.platform === 'win32') {
  //   context.registerTest('net-current', 'startup', checkNetInstall);
  // }

  return true;
}

export default init;
