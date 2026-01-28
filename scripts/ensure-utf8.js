#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.html', '.css', '.scss', '.yml', '.yaml', '.txt'];
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build'];

async function walk(dir, callback) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip user_data* and known skip dirs
      if (e.name.startsWith('user_data') || SKIP_DIRS.includes(e.name)) continue;
      await walk(full, callback);
    } else if (e.isFile()) {
      await callback(full);
    }
  }
}

function looksLikeText(ext) {
  return EXTS.includes(ext.toLowerCase());
}

function hasReplacementChar(str) {
  return str.indexOf('\uFFFD') !== -1;
}

(async () => {
  const problemFiles = [];
  await walk(ROOT, async (file) => {
    try {
      const ext = path.extname(file);
      if (!looksLikeText(ext)) return;
      // skip files in paths that include user_data
      if (file.split(path.sep).some(p => p.startsWith('user_data'))) return;
      const buf = await fs.readFile(file);
      const decoded = buf.toString('utf8');
      if (hasReplacementChar(decoded)) {
        problemFiles.push(file);
      }
    } catch (err) {
      // ignore
    }
  });

  if (problemFiles.length === 0) {
    console.log('No non-UTF8 issues detected in checked file types (excluded user_data, node_modules, .git).');
    process.exit(0);
  }

  console.log('Detected files likely not UTF-8 (contains replacement chars after utf8 decode):');
  problemFiles.forEach(f => console.log(' -', path.relative(ROOT, f)));

  // attempt to auto-convert if iconv-lite is available
  let iconv;
  try {
    iconv = require('iconv-lite');
  } catch (e) {
    console.log('\n`iconv-lite` not installed. To attempt automatic conversion, run:');
    console.log('  cd', ROOT);
    console.log('  npm install iconv-lite --no-save');
    console.log('Then re-run this script to attempt auto-conversion.\n');
    process.exit(0);
  }

  console.log('\nAttempting to convert using common encodings (cp949/euc-kr/latin1). Backups will be created with .bak extension.');
  const encCandidates = ['cp949', 'euc-kr', 'latin1', 'win1252'];
  for (const file of problemFiles) {
    const buf = await fs.readFile(file);
    let converted = false;
    for (const enc of encCandidates) {
      try {
        const str = iconv.decode(buf, enc);
        if (!hasReplacementChar(str)) {
          // write backup then rewrite as utf8
          await fs.copyFile(file, file + '.bak');
          await fs.writeFile(file, Buffer.from(str, 'utf8'));
          console.log(`Converted ${path.relative(ROOT, file)} from ${enc} -> utf8 (backup saved .bak)`);
          converted = true;
          break;
        }
      } catch (e) {
        // try next
      }
    }
    if (!converted) console.log(`Could not safely convert: ${path.relative(ROOT, file)} (manual review needed)`);
  }

  console.log('\nDone. Review .bak files if you need to restore originals.');
})();
