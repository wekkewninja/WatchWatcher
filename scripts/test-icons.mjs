import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repositoryRoot, 'services/watchwatcher-web');
const publicRoot = path.join(webRoot, 'public');
const iconRoot = path.join(publicRoot, 'assets/icons');
const manifest = JSON.parse(await readFile(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'));
const index = await readFile(path.join(webRoot, 'src/index.html'), 'utf8');
const serviceWorkerConfig = await readFile(path.join(webRoot, 'ngsw-config.json'), 'utf8');

for (const svgName of ['watchwatcher.svg', 'watchwatcher-light.svg']) {
  const svg = await readFile(path.join(iconRoot, svgName));
  const metadata = await sharp(svg).metadata();
  assert.equal(metadata.width, 768, `${svgName} should be 768 pixels wide`);
  assert.equal(metadata.height, 768, `${svgName} should be 768 pixels high`);
  assert.doesNotMatch(svg.toString(), /sailboat|boat/i, `${svgName} should use the approved compass-eye design`);
}

for (const [fileName, size] of [
  ['watchwatcher-180.png', 180],
  ['watchwatcher-192.png', 192],
  ['watchwatcher-512.png', 512],
  ['watchwatcher-maskable-192.png', 192],
  ['watchwatcher-maskable-512.png', 512],
]) {
  const metadata = await sharp(path.join(iconRoot, fileName)).metadata();
  assert.equal(metadata.format, 'png', `${fileName} should be PNG`);
  assert.equal(metadata.width, size, `${fileName} should be ${size} pixels wide`);
  assert.equal(metadata.height, size, `${fileName} should be ${size} pixels high`);
}

for (const purpose of ['any', 'maskable']) {
  const entries = manifest.icons.filter((icon) => icon.purpose === purpose);
  assert.deepEqual(
    entries.map((icon) => icon.sizes).sort(),
    ['192x192', '512x512'],
    `manifest should declare 192 and 512 ${purpose} icons`,
  );
  for (const icon of entries) {
    assert.equal(icon.type, 'image/png');
    await readFile(path.join(publicRoot, icon.src));
  }
}

assert.match(index, /href="favicon\.ico"/);
assert.match(index, /watchwatcher-light\.svg" media="\(prefers-color-scheme: light\)"/);
assert.match(index, /watchwatcher\.svg" media="\(prefers-color-scheme: dark\)"/);
assert.match(index, /watchwatcher-180\.png/);
assert.match(serviceWorkerConfig, /"\/assets\/\*\*"/);
assert.match(serviceWorkerConfig, /"\/favicon\.ico"/);

const ico = await readFile(path.join(publicRoot, 'favicon.ico'));
assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved field should be zero');
assert.equal(ico.readUInt16LE(2), 1, 'ICO type should be one');
assert.equal(ico.readUInt16LE(4), 3, 'ICO should contain three sizes');
const icoSizes = [];
for (let index = 0; index < 3; index += 1) {
  const entryOffset = 6 + index * 16;
  const size = ico.readUInt8(entryOffset) || 256;
  const imageLength = ico.readUInt32LE(entryOffset + 8);
  const imageOffset = ico.readUInt32LE(entryOffset + 12);
  assert.equal(ico.subarray(imageOffset, imageOffset + 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(imageOffset + imageLength <= ico.length, 'ICO image data should fit in the file');
  icoSizes.push(size);
}
assert.deepEqual(icoSizes, [16, 32, 48]);

console.log('Icon asset checks passed.');