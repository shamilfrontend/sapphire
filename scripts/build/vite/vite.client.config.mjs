import { createViteConfig } from './shared.mjs';

export function createClientViteConfig({ root, input, outDir, minify = false, mapper }) {
  return createViteConfig({
    root,
    input,
    outDir,
    minify,
    mapper,
  });
}
