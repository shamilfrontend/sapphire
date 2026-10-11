import path from 'node:path';

function normalizeId(id) {
  return id.split(path.sep).join('/');
}

export function createMapperPlugin(mapper) {
  return {
    name: 'sapphire-build-mapper',
    transform(code, id) {
      if (!mapper) {
        return null;
      }
      const normalized = normalizeId(id);
      const replacement = mapper(normalized);
      if (!replacement) {
        return null;
      }
      return {
        code: replacement(code),
        map: null,
      };
    },
  };
}

export function createViteConfig({
  input,
  outDir,
  minify,
  mapper,
  root,
}) {
  return {
    root,
    logLevel: 'info',
    build: {
      emptyOutDir: true,
      outDir,
      sourcemap: true,
      target: 'es2022',
      minify: minify ? 'esbuild' : false,
      rollupOptions: {
        input,
        external: (id) =>
          !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'media/[name][extname]',
        },
      },
    },
    plugins: [createMapperPlugin(mapper)],
  };
}
