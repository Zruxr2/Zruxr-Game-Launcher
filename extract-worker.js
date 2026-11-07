'use strict';
// Runs in a worker thread so unpacking a multi-GB archive never freezes the launcher.
// workerData: { archive, target, kind: 'rar' | 'zip' }
// Posts { type: 'progress', pct } while working, then { type: 'done' } or { type: 'error', message }.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { safeEntryName } = require('./postprocess');

let lastPct = -1;
function progress(done, total) {
  if (!total) return;
  const pct = Math.min(99, Math.floor((done / total) * 100));
  if (pct !== lastPct) {
    lastPct = pct;
    parentPort.postMessage({ type: 'progress', pct });
  }
}

function friendly(err) {
  const reason = String((err && (err.reason || err.message)) || err || '');
  if (/PASSWORD/i.test(reason)) return 'This archive is password protected.';
  if (/BAD_DATA|CORRUPT|CRC|Unexpected end|end of central directory/i.test(reason)) return 'The archive looks damaged or incomplete. Try downloading it again.';
  if (/ENOSPC/i.test(reason)) return 'Not enough free disk space to unpack this.';
  if (/EACCES|EPERM/i.test(reason)) return 'Windows would not let Zruxr write to that folder.';
  return reason || 'Unknown error.';
}

async function extractRar({ archive, target }) {
  const { createExtractorFromFile } = require('node-unrar-js');
  const extractor = await createExtractorFromFile({
    filepath: archive,
    targetPath: target,
    filenameTransform: safeEntryName,
  });
  let total = 0;
  for (const h of extractor.getFileList().fileHeaders) total += h.unpSize || 0;
  let done = 0;
  for (const file of extractor.extract().files) {
    done += (file.fileHeader && file.fileHeader.unpSize) || 0;
    progress(done, total);
  }
}

async function extractZip({ archive, target }) {
  const extract = require('extract-zip');
  let seen = 0;
  await extract(archive, {
    dir: target,
    onEntry: (_entry, zipfile) => {
      seen += 1;
      progress(seen, zipfile.entryCount);
    },
  });
}

(async () => {
  try {
    fs.mkdirSync(workerData.target, { recursive: true });
    if (workerData.kind === 'rar') await extractRar(workerData);
    else if (workerData.kind === 'zip') await extractZip(workerData);
    else throw new Error('Unsupported archive type.');
    parentPort.postMessage({ type: 'done' });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: friendly(err) });
  }
})();
