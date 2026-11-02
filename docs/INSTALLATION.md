# Installation and Verification

Shepherd v0.2.0 is an early x86-64 Linux release. The release provides an
AppImage for portable use and a Debian package for system installation.

## Download

Download the three v0.2.0 files from the
[GitHub release](https://github.com/ANIRUDH-SJ/shepherd/releases/tag/v0.2.0):

- `Shepherd-0.2.0-x86_64.AppImage`
- `Shepherd_0.2.0_amd64.deb`
- `SHA256SUMS.txt`

Use files from the official `ANIRUDH-SJ/shepherd` release page. The checksum file
detects a damaged or incomplete download; it is not a substitute for checking
the download source.

## Verify the download

Keep `SHA256SUMS.txt` beside the package you downloaded, then run:

```bash
sha256sum --ignore-missing -c SHA256SUMS.txt
```

The selected package must report `OK`. The published v0.2.0 checksums are:

```text
a04e1ae88c892bd281120db3a49323035ecc3bb014289dbefbdfd21676a4128a  Shepherd-0.2.0-x86_64.AppImage
5d9b03cabd3bc9eb5e06b86c23f115cb2a88d219db9fccb4c09104f4ccf4fc2e  Shepherd_0.2.0_amd64.deb
```

## Run the AppImage

The AppImage runs without installing Shepherd system-wide:

```bash
chmod +x Shepherd-0.2.0-x86_64.AppImage
./Shepherd-0.2.0-x86_64.AppImage
```

If the system does not provide FUSE support, use the AppImage extraction mode:

```bash
./Shepherd-0.2.0-x86_64.AppImage --appimage-extract-and-run
```

Shepherd stores its application state in the normal per-user configuration
location. Running the AppImage does not add a system package.

## Install the Debian package

On Debian or Ubuntu, install with `apt` so package dependencies are resolved:

```bash
sudo apt install ./Shepherd_0.2.0_amd64.deb
```

Launch Shepherd from the desktop application menu or a terminal:

```bash
shepherd
```

Remove the installed package with:

```bash
sudo apt remove shepherd
```

Removing the package does not automatically erase per-user Shepherd state.

## Build from source

With Node.js, npm, and the native build prerequisites available on Linux:

```bash
npm install
npm run build
npm run dev
```

`node-pty` is a native dependency. Systems that cannot use its prebuilt binary
need a working C/C++ compiler toolchain and Python for the Node.js build process.

## Release validation

Before publication, both v0.2.0 packages were rebuilt from the tagged commit,
launched on an isolated Linux display, and exercised through Shepherd's Unix
socket. The uploaded assets were then downloaded from GitHub and checked against
the published SHA-256 file.
