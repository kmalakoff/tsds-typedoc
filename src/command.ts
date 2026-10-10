import spawn from 'cross-spawn-cb';
import { safeRm } from 'fs-remove-compat';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import mkdirp from 'mkdirp-classic';
import { bind } from 'node-version-call';
import path from 'path';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath, loadConfig } from 'tsds-lib';
import url from 'url';

const major = +process.versions.node.split('.')[0];
const __dirname = path.dirname(typeof __filename === 'undefined' ? url.fileURLToPath(import.meta.url) : __filename);
const dist = path.join(__dirname, '..');

function commandError(failures: unknown[]): Error | undefined {
  if (failures.length === 0) return undefined;
  if (failures.length === 1 && failures[0] instanceof Error) return failures[0];
  const error: Error & { errors?: unknown[] } = new Error('TypeDoc command or restoration failed');
  error.errors = failures;
  return error;
}

function run(args: string[], options: CommandOptions, callback: CommandCallback) {
  const opts = getopts(args, { alias: { 'dry-run': 'd' }, boolean: ['dry-run'] });
  const filteredArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '-d');

  const config = loadConfig(options);
  if (!config) {
    console.log('tsds: no config. Skipping');
    return callback();
  }
  if (!config.source) {
    console.log('tsds: config missing source. Skipping docs');
    return callback();
  }

  if (opts['dry-run']) {
    console.log('Dry-run: would generate docs with typedoc');
    return callback();
  }

  let acquiredTarget: string | undefined;
  let cleanupStarted = false;
  let completed = false;
  function finish(operationFailed: boolean, operationError: unknown): void {
    if (cleanupStarted) return;
    cleanupStarted = true;
    function complete(cleanupFailed: boolean, cleanupError: unknown): void {
      if (completed) return;
      completed = true;
      const failures: unknown[] = [];
      if (operationFailed) failures.push(operationError);
      if (cleanupFailed) failures.push(cleanupError);
      callback(commandError(failures));
    }
    if (!acquiredTarget) return complete(false, undefined);
    try {
      unlink(acquiredTarget, (error: unknown) => complete(error !== undefined && error !== null, error));
    } catch (error: unknown) {
      if (completed) throw error;
      complete(true, error);
    }
  }

  try {
    const cwd: string = (options.cwd as string) || process.cwd();
    const typedoc = resolveBin('typedoc');
    const dest = path.join(cwd, 'docs');

    const queue = new Queue(1);
    let operationFailed = false;
    let operationError: unknown;
    function next(error: unknown, cb: CommandCallback): void {
      if (error !== undefined && error !== null) {
        operationFailed = true;
        operationError = error;
      }
      // Queue classifies errors by truthiness; retain the original value separately.
      cb(commandError(error === undefined || error === null ? [] : [error]));
    }
    queue.defer((cb) => safeRm(dest, (err) => next(err, cb)));
    queue.defer((cb) => mkdirp(dest, (err) => next(err, cb)));
    queue.defer((cb) => {
      try {
        link(cwd, installPath(options), (err, restore) => {
          if (err !== undefined && err !== null) return next(err, cb);
          if (!restore) return next(new Error('link did not return restore path'), cb);
          acquiredTarget = restore;
          cb();
        });
      } catch (error: unknown) {
        if (cleanupStarted) throw error;
        finish(true, error);
      }
    });
    queue.defer((cb) => {
      try {
        spawn(typedoc, [config.source as string, ...filteredArgs, '--excludeExternals', 'true'], options, (err) => next(err, cb));
      } catch (error: unknown) {
        if (cleanupStarted) throw error;
        finish(true, error);
      }
    });
    queue.await(() => finish(operationFailed, operationError));
  } catch (error: unknown) {
    if (cleanupStarted) throw error;
    finish(true, error);
  }
}

type commandFunction = (args: string[], options: CommandOptions, callback: CommandCallback) => void;

const worker = (major >= 20 ? run : bind('>=20', path.join(dist, 'cjs', 'command.js'), { callbacks: true })) as commandFunction;

export default function docs(args: string[], options: CommandOptions, callback: CommandCallback) {
  worker(args, options, callback);
}
