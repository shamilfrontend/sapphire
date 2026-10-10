/**
 * Propagates PPR Code photoreal cube assets into app / Dock / watermark targets.
 *
 * Usage: node scripts/generate-ppr-logo.mjs
 *
 * Sources (PNG only — no SVG logo variants):
 *   sapphire_icons/logo_cube_noshadow.png   — empty-editor watermark
 *   sapphire_icons/slice_of_sapphire_00b0cc.png  — Dock / taskbar (preferred when present)
 *
 * Writes:
 *   src/.../sapphire_cube_noshadow.png (+ out/ copies)
 *   resources/win32/logo_cube_noshadow.png
 *   src/.../sapphire-icon-sm.png
 *   resources/darwin/code.icns + Assets.car  (macOS Dock / Finder)
 *   resources/linux/code.png + sapphire_icons/cubecircled.png
 *   resources/win32/code.ico (+ tile PNGs) + sapphire_icons/code.ico
 */
import sharp from 'sharp';
import { writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function requirePhotorealMark(preferred) {
  const mark = preferred.find((p) => existsSync(p));
  if (!mark) {
    throw new Error(
      `Missing photoreal cube PNG. Expected one of:\n${preferred.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return mark;
}

/** Soft drop shadow under the mark (matches old Sapphire dock icon treatment). */
async function makeShadow(size, markScale = 0.62) {
  const mark = Math.round(size * markScale);
  const ellipseW = Math.round(mark * 0.72);
  const ellipseH = Math.round(mark * 0.16);
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <filter id="f" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${Math.max(2, size * 0.012).toFixed(1)}"/>
    </filter>
  </defs>
  <ellipse cx="${size / 2}" cy="${size * 0.72}" rx="${ellipseW / 2}" ry="${ellipseH / 2}"
    fill="#000000" opacity="0.18" filter="url(#f)"/>
</svg>`);
  return sharp(svg).png().toBuffer();
}

/**
 * Punch near-white opaque pixels to transparent so we can place the cube
 * on a clean Chrome/Telegram-style white plate.
 */
async function punchWhiteBackground(pngPathOrBuffer) {
  const { data, info } = await sharp(pngPathOrBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const r = out[o];
    const g = out[o + 1];
    const b = out[o + 2];
    const a = out[o + 3];
    if (a < 8) {
      continue;
    }
    // Near-white plate (keep bright cyan/neon highlights on the cube itself).
    if (r > 242 && g > 242 && b > 242) {
      out[o + 3] = 0;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Opaque white plate (Chrome / Telegram Dock style). macOS masks the squircle.
 */
async function makeIconPlate(size, shape) {
  const r = (size / 2).toFixed(1);
  // Subtle top-lit white → light gray, same family as system app icons.
  const svg =
    shape === 'circle'
      ? Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="p" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f7f7f8"/>
      <stop offset="100%" stop-color="#ececef"/>
    </radialGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r}" fill="url(#p)"/>
</svg>`)
      : Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="p" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f7f7f8"/>
      <stop offset="100%" stop-color="#ececef"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#p)"/>
</svg>`);
  return sharp(svg).png().toBuffer();
}

/**
 * Compose app icon on a white plate with a large, evenly padded cube
 * (Chrome / Telegram proportions: glyph ~72% of the canvas).
 * @param {'squircle'|'circle'} shape circle for Linux; squircle/full plate for macOS/Windows.
 */
async function composeAppIcon(markPngPath, size, shape) {
  // ~82% glyph + equal margins ≈ Chrome/Telegram look (logo fills the plate).
  const markScale = 0.82;
  const markSize = Math.round(size * markScale);
  const punched = await punchWhiteBackground(markPngPath);
  const mark = await sharp(punched)
    .ensureAlpha()
    .trim({ threshold: 8 })
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width: mw, height: mh } = await sharp(mark).metadata();
  const plate = await makeIconPlate(size, shape === 'circle' ? 'circle' : 'squircle');
  // Soft contact shadow on the white plate (same idea as Chrome/Telegram).
  const shadow = await makeShadow(size, markScale * 0.95);
  const left = Math.round((size - (mw ?? markSize)) / 2);
  const top = Math.round((size - (mh ?? markSize)) / 2);

  return sharp(plate)
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: mark, left, top },
    ])
    .png()
    .toBuffer();
}

/** Build a multi-size ICO from PNG buffers (PNG-compressed entries). */
function buildIco(entries) {
  const count = entries.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const dir = Buffer.alloc(headerSize);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const { size, png } = entries[i];
    const o = 6 + i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
    blobs.push(png);
  }
  return Buffer.concat([dir, ...blobs]);
}

const DARWIN_ICONSET_FILES = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' },
];

async function writeDarwinIconsetPngs(squircle1024, setDir) {
  mkdirSync(setDir, { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), 'ppr-icon-stage-'));
  // sharp resize + sips re-encode: iconutil/actool reject many sharp-only PNGs as invalid
  for (const { size, name } of DARWIN_ICONSET_FILES) {
    const staged = join(staging, `staged-${name}`);
    await sharp(squircle1024).resize(size, size).png().toFile(staged);
    execFileSync('sips', ['-s', 'format', 'png', staged, '--out', join(setDir, name)], {
      stdio: 'pipe',
    });
  }
  rmSync(staging, { recursive: true, force: true });
}

async function writeIcns(squircle1024, icnsPath) {
  const iconset = mkdtempSync(join(tmpdir(), 'ppr-iconset-'));
  const setDir = join(iconset, 'code.iconset');
  await writeDarwinIconsetPngs(squircle1024, setDir);
  execFileSync('iconutil', ['-c', 'icns', setDir, '-o', icnsPath], { stdio: 'pipe' });
  rmSync(iconset, { recursive: true, force: true });
}

/**
 * macOS Dock / Finder prefer Assets.car when Info.plist has CFBundleIconName.
 * gulp copies resources/darwin/Assets.car into the .app; regenerating only .icns is not enough.
 */
async function writeAssetsCar(squircle1024, carPath) {
  const work = mkdtempSync(join(tmpdir(), 'ppr-assets-car-'));
  try {
    const appIconset = join(work, 'code.xcassets', 'code.appiconset');
    await writeDarwinIconsetPngs(squircle1024, appIconset);
    writeFileSync(
      join(appIconset, 'Contents.json'),
      JSON.stringify(
        {
          images: [
            { filename: 'icon_16x16.png', idiom: 'mac', scale: '1x', size: '16x16' },
            { filename: 'icon_16x16@2x.png', idiom: 'mac', scale: '2x', size: '16x16' },
            { filename: 'icon_32x32.png', idiom: 'mac', scale: '1x', size: '32x32' },
            { filename: 'icon_32x32@2x.png', idiom: 'mac', scale: '2x', size: '32x32' },
            { filename: 'icon_128x128.png', idiom: 'mac', scale: '1x', size: '128x128' },
            { filename: 'icon_128x128@2x.png', idiom: 'mac', scale: '2x', size: '128x128' },
            { filename: 'icon_256x256.png', idiom: 'mac', scale: '1x', size: '256x256' },
            { filename: 'icon_256x256@2x.png', idiom: 'mac', scale: '2x', size: '256x256' },
            { filename: 'icon_512x512.png', idiom: 'mac', scale: '1x', size: '512x512' },
            { filename: 'icon_512x512@2x.png', idiom: 'mac', scale: '2x', size: '512x512' },
          ],
          info: { author: 'xcode', version: 1 },
        },
        null,
        2,
      ),
    );

    const outDir = join(work, 'out');
    mkdirSync(outDir);
    const actoolCandidates = [
      '/Applications/Xcode.app/Contents/Developer/usr/bin/actool',
      'actool',
    ];
    let lastErr;
    for (const actool of actoolCandidates) {
      try {
        execFileSync(
          actool,
          [
            '--compile',
            outDir,
            '--platform',
            'macosx',
            '--minimum-deployment-target',
            '11.0',
            '--app-icon',
            'code',
            '--output-partial-info-plist',
            join(outDir, 'partial.plist'),
            join(work, 'code.xcassets'),
          ],
          {
            stdio: 'pipe',
            env: {
              ...process.env,
              DEVELOPER_DIR:
                process.env.DEVELOPER_DIR ||
                '/Applications/Xcode.app/Contents/Developer',
            },
          },
        );
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) {
      throw lastErr;
    }

    const compiled = join(outDir, 'Assets.car');
    if (!existsSync(compiled)) {
      throw new Error('actool did not produce Assets.car');
    }
    mkdirSync(dirname(carPath), { recursive: true });
    copyFileSync(compiled, carPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function writePlatformIcons(markPngPath) {
  const squircle = await composeAppIcon(markPngPath, 1024, 'squircle');
  const circle = await composeAppIcon(markPngPath, 1024, 'circle');

  const darwinIcns = join(root, 'resources/darwin/code.icns');
  await writeIcns(squircle, darwinIcns);
  console.log('updated', darwinIcns);

  const darwinCar = join(root, 'resources/darwin/Assets.car');
  try {
    await writeAssetsCar(squircle, darwinCar);
    console.log('updated', darwinCar);
  } catch (e) {
    console.warn(
      'skip Assets.car (install Xcode / accept license; Dock may keep old icon):',
      e?.stderr?.toString?.() || e.message,
    );
  }

  const linuxPng = join(root, 'resources/linux/code.png');
  writeFileSync(linuxPng, circle);
  console.log('updated', linuxPng);
  copyFileSync(linuxPng, join(root, 'sapphire_icons/cubecircled.png'));
  console.log('updated', join(root, 'sapphire_icons/cubecircled.png'));

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const size of icoSizes) {
    const png = await sharp(squircle).resize(size, size).png().toBuffer();
    icoEntries.push({ size, png });
  }
  const ico = buildIco(icoEntries);
  const winIco = join(root, 'resources/win32/code.ico');
  writeFileSync(winIco, ico);
  copyFileSync(winIco, join(root, 'sapphire_icons/code.ico'));
  console.log('updated', winIco);

  await sharp(squircle).resize(70, 70).png().toFile(join(root, 'resources/win32/code_70x70.png'));
  await sharp(squircle)
    .resize(150, 150)
    .png()
    .toFile(join(root, 'resources/win32/code_150x150.png'));
  console.log('updated win32 tile pngs');

  // Refresh packaged Electron / gulp app icons if present (Dock / Finder).
  const appResourceDirs = [
    join(root, '.build/electron/PPR Code.app/Contents/Resources'),
    join(root, '../VSCode-darwin-arm64/PPR Code.app/Contents/Resources'),
  ];
  for (const resourcesDir of appResourceDirs) {
    if (!existsSync(resourcesDir)) {
      continue;
    }
    const builtIcns = join(resourcesDir, 'PPR Code.icns');
    copyFileSync(darwinIcns, builtIcns);
    console.log('updated', builtIcns);
    const appIcon = join(resourcesDir, 'AppIcon.icns');
    if (existsSync(appIcon)) {
      copyFileSync(darwinIcns, appIcon);
      console.log('updated', appIcon);
    }
    const builtCar = join(resourcesDir, 'Assets.car');
    if (existsSync(darwinCar)) {
      copyFileSync(darwinCar, builtCar);
      console.log('updated', builtCar);
    }
  }
}

async function main() {
  // Drop old SVG / generated tesseract leftovers so they are never picked up again.
  for (const stale of [
    join(root, 'sapphire_icons/ppr-tesseract.png'),
    join(root, 'sapphire_icons/ppr-tesseract.svg'),
  ]) {
    if (existsSync(stale)) {
      rmSync(stale);
      console.log('removed', stale);
    }
  }

  const watermarkMark = requirePhotorealMark([
    join(root, 'sapphire_icons/logo_cube_noshadow.png'),
    join(root, 'sapphire_icons/slice_of_sapphire_00b0cc.png'),
  ]);
  console.log('watermark mark:', watermarkMark);

  const targets = [
    join(root, 'src/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png'),
    join(root, 'out/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png'),
    join(root, 'out/media/sapphire_cube_noshadow.png'),
    join(root, 'resources/win32/logo_cube_noshadow.png'),
  ];
  for (const t of targets) {
    try {
      mkdirSync(dirname(t), { recursive: true });
      copyFileSync(watermarkMark, t);
      console.log('updated', t);
    } catch (e) {
      console.warn('skip', t, e.message);
    }
  }

  // Packaged gulp app copies (empty-editor watermark) if present.
  const packagedWatermarks = [
    join(
      root,
      '../VSCode-darwin-arm64/PPR Code.app/Contents/Resources/app/out/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png',
    ),
    join(
      root,
      '../VSCode-darwin-arm64/PPR Code.app/Contents/Resources/app/out/media/sapphire_cube_noshadow.png',
    ),
  ];
  for (const t of packagedWatermarks) {
    if (existsSync(dirname(t))) {
      copyFileSync(watermarkMark, t);
      console.log('updated', t);
    }
  }

  const sm = join(root, 'src/vs/workbench/browser/media/sapphire-icon-sm.png');
  await sharp(watermarkMark).resize(128, 128).png().toFile(sm);
  try {
    copyFileSync(sm, join(root, 'out/vs/workbench/browser/media/sapphire-icon-sm.png'));
  } catch {
    /* out may be absent */
  }

  // Dock / taskbar: photoreal cube only (transparent bg after punch).
  const platformMark = requirePhotorealMark([
    join(root, 'sapphire_icons/slice_of_sapphire_00b0cc.png'),
    join(root, 'sapphire_icons/logo_cube_noshadow.png'),
  ]);
  console.log('platform icon mark:', platformMark);

  await writePlatformIcons(platformMark);
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
