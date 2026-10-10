Run `node build.js` to compile the Vue UI into `out/`.

A couple things to remember:

- Make sure to add .js at the end of any external imports used in here, e.g. ../../../../../my_file.js. Vue single-file components are imported as `.vue`. If you don't do this, you will get untraceable errors.

- src/ needs to be shallow (1 folder deep) so the detection of externals works properly (see tsup.config.js).

- Tailwind classes in `.vue` templates are prefixed with `void-` during the build (`prefixVueClasses.js`). Write unprefixed classes in source. A class that starts with `@@` is left unprefixed.
