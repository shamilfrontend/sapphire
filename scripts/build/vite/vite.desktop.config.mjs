import { createViteConfig } from './shared.mjs';

export function createDesktopViteConfig({ root, input, outDir, minify, mapper }) {
  return createViteConfig({
    root,
    input,
    outDir,
    minify,
    mapper,
    define: {
      'process.env': 'process.env',
    },
  });
}
