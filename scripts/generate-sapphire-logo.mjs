/**
 * Propagates Sapphire precomposed logo assets into app / Dock / watermark targets.
 *
 * Usage: node scripts/generate-sapphire-logo.mjs
 *
 * Sources (PNG only — full app-icon art with dark squircle + crystal):
 *   sapphire_icons/logo_cube_noshadow.png   — empty-editor watermark / UI
 *   sapphire_icons/slice_of_sapphire_00b0cc.png  — Dock / taskbar (preferred when present)
 *
 * Watermark target strips the near-black squircle so only the crystal remains
 * (Cursor-style letterpress on the empty editor).
 *
 * Writes:
 *   src/.../sapphire_cube_noshadow.png (+ out/ copies) — transparent watermark
 *   resources/win32/logo_cube_noshadow.png
 *   src/.../sapphire-icon-sm.png
 *   src/.../code-icon.png
 *   resources/darwin/code.icns + Assets.car  (macOS Dock / Finder)
 *   resources/linux/code.png + sapphire_icons/cubecircled.png
 *   resources/win32/code.ico (+ tile PNGs) + sapphire_icons/code.ico
 *   resources/win32/inno-sapphire.bmp
 *   resources/server/{favicon.ico,code-192.png,code-512.png}
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
      `Missing logo PNG. Expected one of:\n${preferred.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return mark;
}

/**
 * Remove the dark squircle plate so the crystal sits on a transparent background
 * for the empty-editor watermark (like Cursor's letterpress logo).
 * Near-black opaque pixels (squircle fill) become fully transparent; the silver
 * crystal facets are kept.
 */
async function makeTransparentWatermark(markPngPath) {
  const { data, info } = await sharp(markPngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = Buffer.from(data);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    if (a < 10) {
      continue;
    }
    // Squircle plate is ~RGB 0–75 (incl. soft edge); crystal facets start ~87+.
    if (r + g + b < 220 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
      px[i + 3] = 0;
    }
  }

  return sharp(px, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Resize the precomposed logo as-is. For Linux, apply a circular alpha mask.
 * @param {'squircle'|'circle'} shape
 */
async function composeAppIcon(markPngPath, size, shape) {
  const resized = await sharp(markPngPath)
    .ensureAlpha()
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();

  if (shape !== 'circle') {
    return resized;
  }

  const r = (size / 2).toFixed(1);
  const mask = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/>
</svg>`);

  return sharp(resized)
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
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
  const staging = mkdtempSync(join(tmpdir(), 'sapphire-icon-stage-'));
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
  const iconset = mkdtempSync(join(tmpdir(), 'sapphire-iconset-'));
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
  const work = mkdtempSync(join(tmpdir(), 'sapphire-assets-car-'));
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

async function writeUiAndWebAssets(markPngPath) {
  const codeIcon = join(root, 'src/vs/workbench/browser/media/code-icon.png');
  await sharp(markPngPath).resize(1200, 1200).png().toFile(codeIcon);
  console.log('updated', codeIcon);
  try {
    copyFileSync(codeIcon, join(root, 'out/vs/workbench/browser/media/code-icon.png'));
  } catch {
    /* out may be absent */
  }

  const server192 = join(root, 'resources/server/code-192.png');
  const server512 = join(root, 'resources/server/code-512.png');
  await sharp(markPngPath).resize(192, 192).png().toFile(server192);
  await sharp(markPngPath).resize(512, 512).png().toFile(server512);
  console.log('updated', server192);
  console.log('updated', server512);

  const faviconSizes = [16, 32, 48];
  const favEntries = [];
  for (const size of faviconSizes) {
    const png = await sharp(markPngPath).resize(size, size).png().toBuffer();
    favEntries.push({ size, png });
  }
  const favicon = join(root, 'resources/server/favicon.ico');
  writeFileSync(favicon, buildIco(favEntries));
  console.log('updated', favicon);

  const innoBmp = join(root, 'resources/win32/inno-sapphire.bmp');
  const innoStaging = mkdtempSync(join(tmpdir(), 'sapphire-inno-'));
  try {
    const innoPng = join(innoStaging, 'inno-sapphire.png');
    await sharp(markPngPath).resize(1200, 1200).removeAlpha().png().toFile(innoPng);
    execFileSync('sips', ['-s', 'format', 'bmp', innoPng, '--out', innoBmp], { stdio: 'pipe' });
    console.log('updated', innoBmp);
  } finally {
    rmSync(innoStaging, { recursive: true, force: true });
  }

  const darwinCube = join(root, 'resources/darwin/code.icon/Assets/cube.png');
  if (existsSync(dirname(darwinCube))) {
    copyFileSync(markPngPath, darwinCube);
    console.log('updated', darwinCube);
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
    join(root, '.build/electron/Sapphire.app/Contents/Resources'),
    join(root, '../VSCode-darwin-arm64/Sapphire.app/Contents/Resources'),
  ];
  for (const resourcesDir of appResourceDirs) {
    if (!existsSync(resourcesDir)) {
      continue;
    }
    const builtIcns = join(resourcesDir, 'Sapphire.icns');
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

  const watermarkSource = requirePhotorealMark([
    join(root, 'sapphire_icons/logo_cube_noshadow.png'),
    join(root, 'sapphire_icons/slice_of_sapphire_00b0cc.png'),
  ]);
  console.log('watermark source:', watermarkSource);

  const watermarkPng = await makeTransparentWatermark(watermarkSource);

  const targets = [
    join(root, 'src/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png'),
    join(root, 'out/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png'),
    join(root, 'out/media/sapphire_cube_noshadow.png'),
    join(root, 'out-vscode/media/sapphire_cube_noshadow.png'),
    join(root, 'resources/win32/logo_cube_noshadow.png'),
  ];
  for (const t of targets) {
    try {
      mkdirSync(dirname(t), { recursive: true });
      writeFileSync(t, watermarkPng);
      console.log('updated', t);
    } catch (e) {
      console.warn('skip', t, e.message);
    }
  }

  // Packaged darwin app copies (empty-editor watermark) if present.
  const packagedWatermarks = [
    join(
      root,
      '../VSCode-darwin-arm64/Sapphire.app/Contents/Resources/app/out/vs/workbench/browser/parts/editor/media/sapphire_cube_noshadow.png',
    ),
    join(
      root,
      '../VSCode-darwin-arm64/Sapphire.app/Contents/Resources/app/out/media/sapphire_cube_noshadow.png',
    ),
  ];
  for (const t of packagedWatermarks) {
    if (existsSync(dirname(t))) {
      writeFileSync(t, watermarkPng);
      console.log('updated', t);
    }
  }

  const sm = join(root, 'src/vs/workbench/browser/media/sapphire-icon-sm.png');
  await sharp(watermarkSource).resize(128, 128).png().toFile(sm);
  console.log('updated', sm);
  try {
    copyFileSync(sm, join(root, 'out/vs/workbench/browser/media/sapphire-icon-sm.png'));
  } catch {
    /* out may be absent */
  }

  await writeUiAndWebAssets(watermarkSource);

  // Dock / taskbar: precomposed dark-squircle logo (resize as-is).
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
