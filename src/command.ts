import spawn from 'cross-spawn-cb';
import { safeRm } from 'fs-remove-compat';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import mkdirp from 'mkdirp-classic';
import { wrap } from 'node-version-call';
import path from 'path';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath, loadConfig } from 'tsds-lib';
import url from 'url';

const major = +process.versions.node.split('.')[0];
const version = major > 14 ? 'local' : 'stable';
const __dirname = path.dirname(typeof __filename === 'undefined' ? url.fileURLToPath(import.meta.url) : __filename);
const dist = path.join(__dirname, '..');
const workerWrapper = wrap(path.join(dist, 'cjs', 'command.js'));

function worker(args: string[], options: CommandOptions, callback: CommandCallback) {
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

  try {
    const cwd: string = (options.cwd as string) || process.cwd();
    const typedoc = resolveBin('typedoc');
    const dest = path.join(cwd, 'docs');

    const queue = new Queue(1);
    queue.defer((cb) => safeRm(dest, cb));
    queue.defer(mkdirp.bind(null, dest));
    queue.defer(link.bind(null, cwd, installPath(options))); // link the latest for tests
    queue.defer(spawn.bind(null, typedoc, [config.source, ...filteredArgs, '--excludeExternals', 'true'], options));
    queue.await((err) => {
      // unlink the latest for tests
      unlink(installPath(options), () => {
        callback(err);
      });
    });
  } catch (err) {
    return callback(err);
  }
}

export default function docs(args: string[], options: CommandOptions, callback: CommandCallback) {
  version !== 'local' ? workerWrapper('stable', args, options, callback) : worker(args, options, callback);
}
