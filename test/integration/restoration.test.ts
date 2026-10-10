import assert from 'assert';
import { execFile } from 'child_process';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import type { CommandOptions } from 'tsds-lib';
import docs from 'tsds-typedoc';

const root = path.resolve('.tmp', `typedoc-restoration-${process.pid}`);
let sequence = 0;

function fixture() {
  const cwd = path.join(root, String(++sequence));
  mkdirp.sync(cwd);
  const parent = path.join(cwd, 'installed');
  mkdirp.sync(parent);
  const target = path.join(parent, 'candidate');
  mkdirp.sync(target);
  fs.writeFileSync(path.join(target, 'original.txt'), 'original installation');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'restoration-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(cwd, 'index.ts'), 'export function answer(): number { return 42; }\n');
  fs.writeFileSync(path.join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2020', types: [] }, files: ['index.ts'] }));
  const options: CommandOptions = { cwd, installPath: target, config: { source: 'index.ts' }, stdio: 'pipe', encoding: 'utf8' };
  const args = ['--tsconfig', path.join(cwd, 'tsconfig.json'), '--out', path.join(cwd, 'docs')];
  return { cwd, parent, target, options, args };
}

function original(target: string): void {
  assert.strictEqual(fs.lstatSync(target).isDirectory(), true);
  assert.strictEqual(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'original installation');
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['candidate']);
}

function retainedBackup(parent: string): void {
  const moved = `${parent}-moved`;
  const backups = fs.readdirSync(moved).filter((name) => name !== 'candidate');
  assert.strictEqual(backups.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(moved, backups[0], 'original.txt'), 'utf8'), 'original installation');
}

function blockRestoration(f: ReturnType<typeof fixture>, fail: boolean): void {
  const plugin = path.join(f.cwd, 'block-restoration.cjs');
  // A real TypeDoc plugin changes the acquired target's parent before command completion.
  fs.writeFileSync(plugin, `exports.load = function () { var fs = require('fs'); fs.renameSync(${JSON.stringify(f.parent)}, ${JSON.stringify(`${f.parent}-moved`)}); ${fail ? "throw new Error('plugin operation failed');" : ''} };\n`);
  f.args.push('--plugin', plugin);
}

describe('TypeDoc installation restoration', () => {
  before(() => safeRmSync(root));
  after(() => safeRmSync(root));

  it('restores the original installation after success', (done) => {
    const f = fixture();
    let calls = 0;
    docs(f.args, f.options, (error) => {
      assert.strictEqual(++calls, 1);
      assert.ok(error === undefined || error === null, JSON.stringify(error));
      original(f.target);
      assert.strictEqual(fs.existsSync(path.join(f.cwd, 'docs', 'index.html')), true);
      done();
    });
  });

  it('preserves the operation error and restores the original installation', (done) => {
    const f = fixture();
    f.args.push('--unknown-restoration-option');
    let calls = 0;
    docs(f.args, f.options, (error) => {
      assert.strictEqual(++calls, 1);
      assert.ok(error instanceof Error);
      assert.strictEqual((error as Error & { errors?: unknown[] }).errors, undefined);
      original(f.target);
      done();
    });
  });

  it('reports a sole restoration error', (done) => {
    const f = fixture();
    blockRestoration(f, false);
    let calls = 0;
    docs(f.args, f.options, (error) => {
      assert.strictEqual(++calls, 1);
      assert.ok(error instanceof Error);
      assert.strictEqual((error as NodeJS.ErrnoException).code, 'ENOENT', JSON.stringify(error));
      assert.strictEqual((error as Error & { errors?: unknown[] }).errors, undefined);
      assert.strictEqual(fs.existsSync(path.join(f.cwd, 'docs', 'index.html')), true);
      retainedBackup(f.parent);
      done();
    });
  });

  it('reports operation and restoration errors in that order', (done) => {
    const f = fixture();
    blockRestoration(f, true);
    let calls = 0;
    docs(f.args, f.options, (error) => {
      assert.strictEqual(++calls, 1);
      assert.ok(error instanceof Error);
      const errors = (error as Error & { errors: (NodeJS.ErrnoException & { stdout?: string; stderr?: string })[] }).errors;
      assert.strictEqual(errors.length, 2);
      assert.ok(`${errors[0].stdout || ''}${errors[0].stderr || ''}`.indexOf('plugin operation failed') >= 0, JSON.stringify(errors));
      assert.ok(errors[0] instanceof Error, JSON.stringify(errors));
      assert.ok(errors[1] instanceof Error, JSON.stringify(errors));
      assert.strictEqual(errors[1].code, 'ENOENT');
      retainedBackup(f.parent);
      done();
    });
  });

  it('leaves the original installation untouched when failure precedes acquisition', (done) => {
    const f = fixture();
    fs.writeFileSync(path.join(f.cwd, 'docs'), 'not a directory');
    // A file as cwd makes docs removal fail before link can acquire the target.
    f.options.cwd = path.join(f.cwd, 'docs');
    let calls = 0;
    docs(f.args, f.options, (error) => {
      assert.strictEqual(++calls, 1);
      assert.ok(error instanceof Error);
      original(f.target);
      done();
    });
  });

  // The legacy worker serializes options, so accessor identity belongs to in-process Node >=20.
  if (+process.versions.node.split('.')[0] >= 20) {
    [false, null, undefined].forEach((failure) => {
      it(`reports a synchronous throw of ${String(failure)} after restoring the original installation`, (done) => {
        const f = fixture();
        let reads = 0;
        Object.defineProperty(f.options.config, 'source', {
          get() {
            if (++reads > 1) throw failure;
            return path.join(f.cwd, 'index.ts');
          },
        });
        let calls = 0;
        docs(f.args, f.options, (error) => {
          assert.strictEqual(++calls, 1);
          assert.ok(error instanceof Error);
          assert.deepEqual((error as Error & { errors: unknown[] }).errors, [failure]);
          original(f.target);
          done();
        });
      });
    });

    it('lets the caller callback throw once after restoration', (done) => {
      const f = fixture();
      const script = path.join(f.cwd, 'caller-throw.cjs');
      fs.writeFileSync(
        script,
        `var assert = require('assert'); var fs = require('fs'); var docs = require('tsds-typedoc');
var options = ${JSON.stringify(f.options)}; var reads = 0; var calls = 0; var callerError = new Error('caller callback failed');
Object.defineProperty(options.config, 'source', {get: function () { if (++reads > 1) throw new Error('post-link failure'); return ${JSON.stringify(path.join(f.cwd, 'index.ts'))}; }});
var timer = setTimeout(function () { throw new Error('callback deadline'); }, 15000);
process.on('uncaughtException', function (error) { assert.strictEqual(error, callerError); assert.strictEqual(calls, 1); assert.strictEqual(fs.readFileSync(${JSON.stringify(path.join(f.target, 'original.txt'))}, 'utf8'), 'original installation'); clearTimeout(timer); console.log('caller throw preserved'); });
docs([], options, function (error) { ++calls; assert.ok(error instanceof Error); throw callerError; });
`
      );
      execFile(process.execPath, [script], (error, stdout) => {
        assert.ifError(error);
        assert.strictEqual(stdout.trim(), 'caller throw preserved');
        done();
      });
    });

    it('restores after synchronous post-link argument failure, preserving error identity', (done) => {
      const f = fixture();
      const failure = new Error('source getter failed after acquisition');
      let reads = 0;
      Object.defineProperty(f.options.config, 'source', {
        get() {
          if (++reads > 1) throw failure;
          return path.join(f.cwd, 'index.ts');
        },
      });
      let calls = 0;
      docs(f.args, f.options, (error) => {
        assert.strictEqual(++calls, 1);
        assert.strictEqual(error, failure);
        original(f.target);
        done();
      });
    });
  }
});
