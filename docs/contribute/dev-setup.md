# Dev setup

Актуальная инструкция по локальной разработке Sapphire (форк Sapphire / VS Code).

## Node

Используйте версию из `.nvmrc` в корне репозитория (обычно **20.18.2**):

```bash
nvm install
nvm use
```

Путь к репозиторию **без пробелов**.

## Prerequisites

### macOS

Python и Xcode Command Line Tools.

### Windows

[Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community) (или [Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools)).

Workloads:

- Desktop development with C++
- Node.js build tools

Individual Components:

- MSVC v143 — VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)
- C++ ATL for latest build tools with Spectre Mitigations
- C++ MFC for latest build tools with Spectre Mitigations

### Linux

Сначала `npm install -g node-gyp`, затем пакеты под дистрибутив:

- Debian (Ubuntu и др.): `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`
- Red Hat (Fedora и др.): `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`
- SUSE (openSUSE и др.): `sudo zypper install patterns-devel-C-C++-devel_C_C++ krb5-devel libsecret-devel libxkbfile-devel libX11-devel`
- Остальные: [VS Code How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute)

## Запуск Developer Mode

Одной командой (рекомендуется):

```bash
npm install
npm run dev
```

`npm run dev` параллельно поднимает `watch` (client + extensions) и `watchvue`, ждёт появления `out/main.js` при холодном старте и запускает приложение. Аргументы пробрасываются в `code.sh`, например:

```bash
npm run dev -- --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions
```

По закрытии приложения watchers останавливаются (Ctrl+C тоже).

Вручную (как раньше):

```bash
npm run watch          # или Cmd/Ctrl+Shift+B в IDE — сначала build-react, потом TS watch
npm run watchvue     # нужен для инкрементальных правок Vue UI
./scripts/code.sh      # macOS / Linux  (или npm run code)
# Windows: .\scripts\code.bat
```

`npm run compile` / packaging тоже сами вызывают `build-react` перед компиляцией клиента.
Сборка готова, когда watch-client и watch-extensions завершили компиляцию без ошибок.

После правок в renderer: <kbd>Cmd/Ctrl</kbd>+<kbd>R</kbd> (Reload Window).

## Документация сайта

```bash
cd docs && npm install && npm run docs:dev
# или из корня: npm run docs:dev
```
