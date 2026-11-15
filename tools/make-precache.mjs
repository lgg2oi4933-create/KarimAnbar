// فهرست فایل‌های برنامه را برای کش آفلاین میسازد. بعد از هر تغییر اجرا شود: node tools/make-precache.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const include = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons'];
const files = [];
function walk(p) {
  const s = statSync(p);
  if (s.isDirectory()) readdirSync(p).sort().forEach((f) => walk(join(p, f)));
  else files.push(relative(root, p));
}
include.forEach((i) => walk(join(root, i)));
const hash = createHash('sha1');
files.forEach((f) => hash.update(f).update(readFileSync(join(root, f))));
const version = hash.digest('hex').slice(0, 10);
writeFileSync(join(root, 'precache.json'), JSON.stringify({ version, files: ['./', ...files.map((f) => './' + f)] }, null, 2));
const swPath = join(root, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
console.log('precache', version, files.length, 'files');
