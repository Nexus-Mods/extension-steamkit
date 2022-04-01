import { ChildProcess, spawn } from 'child_process';
import path from 'path';

export async function createIPC(usePipe, id, cb): Promise<ChildProcess> {
  // it does actually get named .exe on linux as well
  const exeName = 'DepotDownloaderIPC.exe';

  return new Promise((resolve, reject) => {
    const args = [id];
    if (usePipe) {
      args.push('--pipe');
    }
    const proc = spawn(path.join(__dirname, 'dist', exeName), args)
      .on('error', err => {
        reject?.(err);
        resolve = reject = undefined;
      })
      .on('exit', (code, signal) => {
        if (code === 0x80131700) {
          reject?.(new Error('No compatible .Net Framework, you need .Net framework 6.0 or newer'));
        } else if (code !== null) {
          reject?.(new Error(`Failed to run depot downloader. Errorcode ${code.toString(16)}`));
        } else {
          reject?.(new Error(`The depot downloader was terminated. Signal: ${signal}`));
        }
        resolve = reject = undefined;
      });
    cb(proc);

    setTimeout(() => {
      if ((proc.exitCode !== null) && (proc.exitCode !== 0)) {
        reject?.(new Error('Failed to spawn depot downloader'));
      } else {
        resolve?.(proc);
      }
      resolve = reject = undefined;
    }, 100);
  });
}
