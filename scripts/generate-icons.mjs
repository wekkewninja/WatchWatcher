import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDirectory = path.join(repositoryRoot, 'services/watchwatcher-web/public/assets/icons');
const darkSvg = await readFile(path.join(iconDirectory, 'watchwatcher.svg'));
const icoSizes = [16, 32, 48];

async function renderPng(size, maskable = false) {
  if (!maskable) {
    return sharp(darkSvg).resize(size, size).png().toBuffer();
  }

  const contentSize = Math.round(size * 0.8);
  const padding = Math.floor((size - contentSize) / 2);
  const remainder = size - contentSize - padding;

  return sharp(darkSvg)
    .resize(contentSize, contentSize)
    .extend({
      top: padding,
      bottom: remainder,
      left: padding,
      right: remainder,
      background: '#0b1c34',
    })
    .png()
    .toBuffer();
}

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
}

await mkdir(iconDirectory, { recursive: true });
await writeFile(path.join(iconDirectory, 'watchwatcher-180.png'), await renderPng(180));
await writeFile(path.join(iconDirectory, 'watchwatcher-192.png'), await renderPng(192));
await writeFile(path.join(iconDirectory, 'watchwatcher-512.png'), await renderPng(512));
await writeFile(path.join(iconDirectory, 'watchwatcher-maskable-192.png'), await renderPng(192, true));
await writeFile(path.join(iconDirectory, 'watchwatcher-maskable-512.png'), await renderPng(512, true));

const faviconImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await renderPng(size) })),
);
await writeFile(
  path.join(repositoryRoot, 'services/watchwatcher-web/public/favicon.ico'),
  createIco(faviconImages),
);

console.log('Generated 180, 192, and 512 PNG icons, maskable PNGs, and a 16/32/48 ICO favicon.');
