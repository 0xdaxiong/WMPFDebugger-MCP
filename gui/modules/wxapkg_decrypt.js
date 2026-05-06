'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { findWxapkgDir, isWindows, isMac } = require('./platform');

const MAGIC = Buffer.from('V1MMWX', 'ascii');
const SALT = Buffer.from('saltiest', 'utf8');
const IV = Buffer.from('the iv: 16 bytes', 'utf8');
const PBKDF2_ITER = 1000;
const KEY_LEN = 32;

function deriveKey(appId) {
  return crypto.pbkdf2Sync(appId, SALT, PBKDF2_ITER, KEY_LEN, 'sha1');
}

function decrypt(data, appId) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);

  if (data.length < 1030) {
    throw new Error('File too small, not a valid encrypted wxapkg');
  }

  if (!data.slice(0, 6).equals(MAGIC)) {
    if (data[0] === 0xBE) {
      return data;
    }
    throw new Error(`Unknown file format (magic: ${data.slice(0, 6).toString('hex')})`);
  }

  const key = deriveKey(appId);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
  decipher.setAutoPadding(false);
  const encryptedHeader = data.slice(6, 1030);
  const decryptedHeader = Buffer.concat([decipher.update(encryptedHeader), decipher.final()]);
  const header = decryptedHeader.slice(0, 1023);

  const xorKey = appId.length >= 2 ? appId.charCodeAt(appId.length - 2) : 0;
  const tail = data.slice(1030);
  const xorDecrypted = Buffer.alloc(tail.length);
  for (let i = 0; i < tail.length; i++) {
    xorDecrypted[i] = tail[i] ^ xorKey;
  }

  return Buffer.concat([header, xorDecrypted]);
}

function unpack(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 14) {
    throw new Error('Data too short, not a valid wxapkg');
  }

  let pos = 0;

  const marker1 = data[pos];
  if (marker1 !== 0xBE) {
    throw new Error(`Invalid wxapkg format (marker1: 0x${marker1.toString(16)}, expected 0xBE)`);
  }
  pos += 1;

  pos += 4; // info1

  const indexInfoLength = data.readUInt32BE(pos);
  pos += 4;

  pos += 4; // bodyInfoLength

  const marker2 = data[pos];
  if (marker2 !== 0xED) {
    throw new Error(`Invalid wxapkg format (marker2: 0x${marker2.toString(16)}, expected 0xED)`);
  }
  pos += 1;

  const fileCount = data.readUInt32BE(pos);
  pos += 4;

  const fileIndex = [];
  for (let i = 0; i < fileCount; i++) {
    if (pos + 4 > data.length) break;

    const nameLen = data.readUInt32BE(pos);
    pos += 4;

    if (pos + nameLen > data.length) break;

    const name = data.slice(pos, pos + nameLen).toString('utf8');
    pos += nameLen;

    if (pos + 8 > data.length) break;

    const offset = data.readUInt32BE(pos);
    pos += 4;

    const size = data.readUInt32BE(pos);
    pos += 4;

    fileIndex.push({ name, offset, size });
  }

  const files = [];
  for (const { name, offset, size } of fileIndex) {
    if (offset + size <= data.length) {
      files.push({ name, content: data.slice(offset, offset + size) });
    }
  }

  return files;
}

function extractToDir(wxapkgPath, outputDir, appId) {
  const raw = fs.readFileSync(wxapkgPath);
  const decrypted = decrypt(raw, appId);
  const files = unpack(decrypted);

  const extracted = [];
  for (const { name, content } of files) {
    let safeName = name.replace(/^\/+/, '').replace(/\\/g, '/');
    if (safeName.includes('..')) continue;

    const outPath = path.join(outputDir, safeName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
    extracted.push({ path: outPath, name: safeName, size: content.length });
  }

  return extracted;
}

function findPackages(baseDir) {
  if (!baseDir) baseDir = findWxapkgDir();
  if (!baseDir || !fs.existsSync(baseDir)) return [];

  const results = [];

  if (isMac) {
    const userDirs = fs.readdirSync(baseDir)
      .filter(d => !d.startsWith('.') && fs.statSync(path.join(baseDir, d)).isDirectory())
      .map(d => path.join(baseDir, d))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    for (const ud of userDirs) {
      const pkgDir = path.join(ud, 'applet', 'packages');
      if (fs.existsSync(pkgDir)) {
        scanPackageDir(pkgDir, results);
        break;
      }
    }
  } else {
    scanPackageDir(baseDir, results);
  }

  return results;
}

function scanPackageDir(dir, results) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const appDir = path.join(dir, entry);
    if (!fs.statSync(appDir).isDirectory()) continue;

    const appId = entry;
    walkForWxapkg(appDir, appId, results);
  }
}

function walkForWxapkg(dir, appId, results) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForWxapkg(fullPath, appId, results);
    } else if (entry.name.endsWith('.wxapkg')) {
      results.push({
        appId,
        path: fullPath,
        name: entry.name,
        size: fs.statSync(fullPath).size,
      });
    }
  }
}

module.exports = {
  decrypt,
  unpack,
  extractToDir,
  findPackages,
  findWxapkgDir,
};
