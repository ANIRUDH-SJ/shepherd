# Chapter 15 — Packaging & Distribution

> **What you'll learn**
> - The difference between *bundling* (Chapter 14) and *packaging* (this chapter), and why you need both to hand your app to a stranger
> - What **electron-builder** is, and the `build` config block it reads from `package.json` (`appId`, `productName`, `files`, `directories`)
> - The three Linux delivery formats — **AppImage**, **.deb**, **Flatpak** — compared honestly, and which two to ship first (AppImage + .deb)
> - The single hardest packaging problem in this whole app: getting the **node-pty native module** into the package so terminals actually work (`asarUnpack` + rebuilding against Electron's ABI)
> - How to make it *feel* like a real installed app: an **icon**, a **`.desktop`** launcher entry, and the right **categories**
> - The exact **build commands**, where the **artifacts** land, and how to **test on a clean Ubuntu** where nothing is installed
> - A brief, deferred look at **auto-update** (electron-updater + GitHub Releases — the Linux stand-in for cmux's Sparkle)
>
> **Prerequisites:** Chapter 14 (`14-build-tooling-and-vite.md`). That chapter turned your TypeScript and React *source* into bundled JavaScript in `out/`. This chapter turns that `out/` into files a stranger can install. If Chapter 14 was "make the code runnable," this is "make the app *shippable*." A passing memory of Chapter 06 (node-pty is a native module) and Chapter 03 (Electron ships its own Node runtime) will pay off in §15.5.

---

## 15.1 The goal: from "works on my machine" to "a stranger double-clicks it"

Everything so far has assumed *your* machine: you have Node installed, you cloned the repo, you ran `npm install`, you type `npm run dev` and a window appears. That is a fabulous developer experience and a **useless distribution story.** The person you want to use cmux-linux — a Linux dev who saw a screenshot and wants to try it — has none of that. They have Ubuntu and a mouse. They will not clone your repo. They will not install Node. They want **one file they can run**, or **one thing `apt` understands.**

Packaging is the act of crossing that gap. Concretely, the goal of this chapter is to produce, from your source tree, artifacts like these:

```
cmux-linux-0.1.0-x64.AppImage       ← download, chmod +x, double-click. No install. It runs.
cmux-linux_0.1.0_amd64.deb          ← "apt install ./this.deb" — shows up in the app menu.
```

and to have them work on a machine that has **never seen your project** — no Node, no `node_modules`, no build tools, possibly not even the libraries you take for granted. That "clean machine" is the entire test of whether you got this chapter right (§15.9), because it is the only machine that matters: it's every user's machine.

`ROADMAP.md` puts this in **M6** ("it looks finished and other people can install it"), and it is genuinely the *last* thing you do — you cannot package an app that doesn't work yet. But it is not optional polish. An app nobody can install is a private hobby, not a product.

> **🔧 In cmux-linux:** the north-star screenshot in the repo root is worthless to anyone but you until this chapter is done. Everything from Chapters 1–14 makes the app *good*; this chapter makes it *exist for other people.* That's why M6 exists and why `FEATURES.md` #30 explicitly swaps cmux's Mac-only Sparkle updater for a Linux delivery story.

---

## 15.2 Two tools, two jobs: the bundler vs the packager

The single most common confusion here is thinking Vite (Chapter 14) and electron-builder do the same job. They don't. They're two stages of an assembly line, and each is useless without the other.

```
   CHAPTER 14 — the BUNDLER                     CHAPTER 15 — the PACKAGER
   ─────────────────────────                    ─────────────────────────────
   your TS + React + CSS source                 out/  +  the Electron runtime  +  node_modules
        │                                             │
        │  electron-vite build                        │  electron-builder --linux
        ▼                                             ▼
   out/main/index.js                            dist/cmux-linux-0.1.0-x64.AppImage
   out/preload/index.js                         dist/cmux-linux_0.1.0_amd64.deb
   out/renderer/…                               dist/latest-linux.yml
   "COMPILED"                                    "PACKAGED — a stranger can install this"
   (plain JS, but needs Node + Electron          (Electron is baked in; needs nothing
    installed to run)                             on the target machine)
```

**The bundler (electron-vite / Vite)** takes your TypeScript, React, and CSS and produces plain, optimized JavaScript in `out/`. But `out/` is *not* an app — it's a pile of `.js` files that still need an Electron binary and a `node_modules` folder to run. It assumes a developer environment.

**The packager (electron-builder)** takes that `out/`, **adds the entire Electron runtime** (a private copy of Chromium + Node, ~150 MB of it), pulls in your runtime `node_modules`, compresses the whole thing, and wraps it in an installer format the target OS understands. The output needs *nothing* pre-installed — the Node and Chromium your app runs on are *inside* the artifact.

That "Electron is baked in" fact is why the files are big (§15.10) and why they work on a machine with no Node. You're not shipping your app; you're shipping your app *plus a browser plus a Node runtime*, fused into one blob.

> **⚠️ Gotcha:** you must run the bundler **before** the packager, every time. electron-builder packages whatever is in `out/` — if you edited source and forgot to re-run `electron-vite build`, you'll ship *stale* JavaScript and spend an hour debugging a bug you already fixed. §15.8 wires them into one `npm run dist` script so you can't forget.

### What electron-builder actually is

electron-builder is a Node dev-dependency (`npm i -D electron-builder`) that reads a **config block** — either a `build` key in `package.json` or a standalone `electron-builder.yml` — and produces installers for Linux, macOS, and Windows from it. It's the de-facto standard for Electron packaging (the main alternative is Electron Forge; we use electron-builder because its Linux target support is the most complete). For this project it's the whole of "distribution": one tool, one config block, three output formats.

---

## 15.3 The `build` config block: naming the app

Let's start the config from the top and grow it through the chapter. Everything electron-builder does is driven by a `build` object in `package.json`:

```jsonc
// package.json
{
  "name": "cmux-linux",
  "version": "0.1.0",
  "main": "out/main/index.js",         // the compiled main entry from Chapter 14

  "dependencies": {
    "node-pty": "^1.0.0"               // NATIVE, runtime — MUST be here, not in devDependencies (§15.5)
  },
  "devDependencies": {
    "electron": "^31.0.0",             // the runtime electron-builder will bake in
    "electron-builder": "^25.0.0",     // the packager (this chapter)
    "electron-vite": "^2.0.0"          // the bundler (Chapter 14)
  },

  "build": {
    "appId": "dev.cmux.linux",         // reverse-DNS unique ID for the app
    "productName": "cmux-linux",       // the human-facing name (and lots more — see below)
    "directories": {
      "output": "dist",                // where finished installers land (§15.8)
      "buildResources": "build"        // where the icon + build assets live (NOT shipped)
    },
    "files": [
      "out/**/*",                      // the bundled JS from electron-vite
      "package.json"
    ],
    "linux": {
      "target": ["AppImage", "deb"]    // the two formats we ship first (§15.4)
    }
  }
}
```

**Walkthrough, field by field, because each one has a consequence you'll hit later:**

- **`appId`** — a reverse-DNS string that uniquely identifies your app to the OS (`dev.cmux.linux`). On macOS it's the bundle identifier; on Linux it's used to name the `.desktop` file and — importantly — as the window's application ID for taskbar grouping (§15.6). Pick one and never change it; changing it orphans desktop integration.

- **`productName`** — the human-readable name. This is *not* cosmetic. It becomes the AppImage filename, the `.desktop` `Name`, the window title, **and the name of the per-user config directory**. Remember Chapter 13's `~/.config/cmux-linux/session.json`? That `cmux-linux` folder name *is* your `productName` — Electron's `app.getPath('userData')` resolves to `~/.config/<productName>` on Linux. Set it here and you've named the folder your saved sessions live in.

  > **⚠️ Gotcha:** rename `productName` in a later release and every existing user's `~/.config/cmux-linux/` becomes an orphan — the new build looks in `~/.config/cmux-terminal/` (or whatever) and finds nothing, so **everyone's saved sessions silently vanish** (Chapter 13). `productName` is a permanent decision. Choose it once.

- **`directories.output`** — where the finished installers are written. Defaults to `dist/`. Add it to `.gitignore`; these are big binary build products, not source.

- **`directories.buildResources`** — the `build/` folder holds inputs *to* the build (your icon, a `.desktop` template if you override it) that are **not** copied into the app. Don't confuse it with `directories.output`.

- **`files`** — the allowlist of what goes *inside* the packaged app. `out/**/*` is your compiled code; `package.json` is needed at runtime (Electron reads `main` from it). Note what's absent: your `src/`, your tests, your `.ts` source — none of it ships. electron-builder also **automatically excludes `devDependencies`** and includes only `dependencies`, which is both a size win (§15.10) and the reason node-pty must be a real dependency (§15.5).

> **🔧 In cmux-linux:** `appId` and `productName` are the two identity fields the rest of the OS integration hangs off. Get them right first, because §15.5's native-module work and §15.6's desktop integration both assume they're stable.

---

## 15.4 The three Linux formats: AppImage vs .deb vs Flatpak

Linux has no single "installer" the way macOS has `.dmg`/`.pkg` or Windows has `.exe`/`.msi`. It has *several* competing packaging cultures, and you choose which to support. electron-builder can produce all three that matter. Here they are, compared for **our** app — a terminal that spawns the user's shells and AI agents.

| | **AppImage** | **.deb** | **Flatpak** |
|---|---|---|---|
| **What the user does** | Download one file, `chmod +x`, run it | `apt install ./file.deb` (or double-click) | `flatpak install flathub <id>` |
| **Installs anything?** | **No** — portable, self-contained, runs in place | Yes — into `/opt`, adds a menu entry | Yes — into a sandboxed runtime |
| **Shows in app menu?** | Only if the user integrates it manually | **Yes**, automatically | Yes, automatically |
| **Auto-updates?** | Yes, via electron-updater (§15.11) | No — updates come from `apt`/your repo | Yes, via Flathub |
| **Sandboxed?** | No — full access to the user's system | No | **Yes** — heavily, via portals |
| **Dependencies** | Bundled; needs **FUSE** on the host (§15.9) | Declared via `depends:`; apt resolves them | Provided by the Flatpak runtime |
| **Distro reach** | Any Linux (Ubuntu, Fedora, Arch…) | Debian/Ubuntu family only | Any distro with Flatpak |
| **Build friction** | Low (electron-builder does it all) | Low | **High** — needs `flatpak-builder` + a manifest |

**How to read this for cmux-linux:**

**AppImage — ship this first.** One file, no install, runs on *any* distro. It's the fastest possible "try my app" story: you attach it to a GitHub Release, someone downloads it, marks it executable, and it runs. It's also the only Linux format electron-updater can auto-update (§15.11). Its one wart is the FUSE dependency (§15.9), which is a known, one-line fix.

**.deb — ship this second, alongside.** Our target OS is Ubuntu (`ROADMAP.md`), and `.deb` is Ubuntu's native package. It gives users the "proper install" they expect: it lands in the app menu with an icon, `apt` manages the missing system libraries for you (§15.9), and it uninstalls cleanly. Between them, **AppImage + .deb cover the "portable" and "installed" mental models** that account for nearly everyone on Ubuntu.

**Flatpak — defer it.** Flatpak is excellent for GUI apps and it's how you'd eventually reach Flathub. But its whole value proposition is a **sandbox**, and a sandbox is *actively hostile to what a terminal does.* Our app must spawn the user's real shells, run `git`, launch `claude`/`codex`/arbitrary agents, read the user's project directories, and open a unix socket in `/tmp` (Chapter 11). Inside a Flatpak sandbox, every one of those needs an explicit portal permission or a `flatpak-spawn --host` dance, and spawning arbitrary *host* processes from inside the sandbox is the exact thing Flatpak is designed to prevent. You'd spend the permissions budget fighting your own runtime. So Flatpak is a **later** target (it's in `ROADMAP.md` M6's list, but as the third format, not the first), once the app is stable and you're ready to invest in a proper sandbox permission set.

> **🔧 In cmux-linux:** `FEATURES.md` #30 already made this call — it retires cmux's macOS **Sparkle** updater in favor of "AppImage self-update or GitHub Releases." That decision *is* "ship AppImage + .deb first, wire AppImage auto-update later, treat Flatpak as a stretch." This section is just the reasoning behind that line.

> **⚠️ Gotcha:** don't try to ship all three on day one to look thorough. Each format is a support surface — its own bug reports, its own "it won't launch" threads. Two well-tested formats beat three half-tested ones. AppImage + .deb, tested on a clean VM, is a complete v1 distribution story.

---

## 15.5 The hard part: bundling the node-pty native module

This is the section that will actually cost you an afternoon, so it gets the most space. Everything else in this chapter is config; *this* is the part where the app runs perfectly in `npm run dev` and then ships a build with **blank, dead terminals** — and you have no idea why.

The root cause is one fact from Chapter 06 and Chapter 01: **node-pty is a *native* module.** It's not JavaScript. It's C++ compiled into a binary file — `build/Release/pty.node` — that Node loads with `dlopen` at runtime. That single fact creates *two* independent packaging problems, and you must solve both.

### Problem 1: the ABI mismatch — you must rebuild against Electron

Native modules are compiled against a specific Node.js **ABI** (Application Binary Interface, identified by a `NODE_MODULE_VERSION` number). Here's the trap: **Electron ships its own copy of Node, with a *different* ABI than the Node you have installed system-wide** (Chapter 03 — Electron's main process is Node, but a *specific, embedded* Node). So when `npm install` compiles node-pty, it compiles it against your *system* Node's ABI by default — and Electron then refuses to load it:

```
Error: The module '/…/pty.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires
NODE_MODULE_VERSION 125. Please try re-compiling or re-installing the module.
```

The fix is to **rebuild node-pty against Electron's ABI**, not your system's. electron-builder ships a command that does exactly this:

```jsonc
// package.json — run the rebuild automatically after every install
{
  "scripts": {
    "postinstall": "electron-builder install-app-deps"
  }
}
```

**Walkthrough.** `electron-builder install-app-deps` looks up which Electron version your `devDependencies` pin, downloads the matching Node headers, and recompiles every native module in `dependencies` (here, node-pty) against *Electron's* ABI. Putting it in `postinstall` means it runs automatically after every `npm install`, so both your dev app **and** your packaged app get a correctly-compiled binary. During packaging, electron-builder also re-runs this rebuild by default (`npmRebuild: true`), so the binary in the shipped artifact matches the Electron it's baked next to.

> **🔧 In cmux-linux:** you'll actually hit this in Chapter 06 / M1, long before packaging — a freshly-installed node-pty won't even load in `npm run dev` until it's rebuilt for Electron. The `postinstall` hook is what makes `npm install && npm run dev` "just work." It's a development fix *and* a packaging fix; the same rebuild serves both. (The standalone tool `@electron/rebuild` does the same job if you ever need it outside electron-builder.)

### Problem 2: the asar archive — a .node file can't live inside it

Even with a correctly-compiled binary, there's a second wall. By default, electron-builder packs your entire app into a single archive called **`app.asar`** — think of it as a tar file that Electron can `require()` out of directly. It's great for JS: fewer files, slightly faster startup, a tidy package.

But you **cannot `dlopen` a native binary that lives inside an asar archive.** The OS loader that loads `pty.node` needs a *real file on a real filesystem* with a real path — it has no idea how to reach inside a virtual `app.asar` blob. So a node-pty packed into the asar fails at load time, and every terminal in your shipped app is dead on arrival.

The fix is `asarUnpack`: tell electron-builder to keep node-pty's files **outside** the archive, on the real filesystem, in a sibling folder called `app.asar.unpacked/`. Electron's `require()` transparently redirects to the unpacked copy.

```jsonc
// package.json → build
{
  "asar": true,
  "asarUnpack": [
    "**/node_modules/node-pty/**"     // keep ALL of node-pty on the real filesystem
  ]
}
```

Here's what that produces inside the packaged app:

```
resources/
├─ app.asar                            ← all your JS (main, preload, renderer) — packed, fast
└─ app.asar.unpacked/
   └─ node_modules/node-pty/
      ├─ build/Release/pty.node        ← the native binary — a REAL file, dlopen-able ✔
      └─ build/Release/spawn-helper    ← node-pty's helper EXECUTABLE (not a .node!) ✔
```

> **⚠️ Gotcha (why the explicit pattern, not just auto-detect):** electron-builder *does* auto-detect files ending in `.node` and unpacks them for you — so you might think `asarUnpack` is unnecessary. It isn't, **because of that second file: `spawn-helper`.** node-pty on Linux ships a small helper *executable* (not a `.node` library) that it `exec`s to allocate the pty. The auto-detector only catches `.node` files, so it leaves `spawn-helper` trapped inside the asar, and node-pty fails to spawn shells at runtime. Unpacking the *whole* `node-pty` directory catches both. This is the difference between "terminals work" and a subtle, maddening "shells won't start in the packaged build only."

### The symptom that names this whole section

Commit this pattern to memory, because you *will* see it:

```
   npm run dev  (Chapter 14)                 the PACKAGED app (this chapter)
   ────────────────────────                  ─────────────────────────────
   node-pty loads from                        node-pty loads from
   ./node_modules/node-pty/       ✔  vs       app.asar/…/pty.node          ✗
   (a real folder on disk)                    (a virtual archive — can't dlopen)
   → you type `ls`, it works                  → blank pane / "Cannot find pty.node"
                                                 / "was compiled against a different
                                                    Node.js version"
```

**"It works in dev but the packaged build has dead terminals"** is *the* native-module signature. When you see it, you have exactly three things to check, in order: (1) is node-pty in `dependencies`, not `devDependencies`? (2) did it get rebuilt against Electron's ABI (`postinstall`)? (3) is it in `asarUnpack`? Ninety-nine percent of the time it's one of those three.

> **⚠️ Gotcha:** if node-pty is in `devDependencies`, electron-builder prunes it *entirely* (§15.3) and your packaged app has **no node-pty at all** — not a broken one, a *missing* one. The error is a bare "Cannot find module 'node-pty'." Native runtime modules always go in `dependencies`.

---

## 15.6 Looking like a real app: icon, `.desktop`, and categories

A packaged app that launches but has a generic gear icon and doesn't appear in the applications menu *feels* broken even when it works. Three pieces of metadata fix that: an **icon**, a **`.desktop` entry**, and the right **categories**.

### The icon

Linux wants a PNG (no `.ico`/`.icns` here). The simplest setup: drop a single **512×512** `icon.png` into your `build/` folder (the `buildResources` dir from §15.3), and electron-builder finds it by convention and generates every size the system needs.

```
build/
└─ icon.png        ← 512×512 PNG; electron-builder resizes it into the icon theme
```

For the `.deb`, electron-builder installs those sizes into the standard **hicolor icon theme** so the launcher and dock show your icon. For the AppImage, it embeds the icon directly. You point at it explicitly with `linux.icon` if it's not at the default path (§15.7).

### The `.desktop` entry

A `.desktop` file is the freedesktop.org standard "launcher" descriptor — the little text file that tells GNOME/KDE "here is an app named X, with icon Y, in category Z, launched by command W." It's what makes your app appear in the applications grid and the taskbar. **electron-builder generates one for you automatically** from `productName`, `linux.category`, and the icon — you only *override* the fields you care about, via `linux.desktop.entry`:

```jsonc
// package.json → build → linux
{
  "desktop": {
    "entry": {
      "Name": "cmux-linux",
      "Comment": "A terminal built for multitasking with AI agents",
      "Categories": "Development;Utility;System;",
      "Keywords": "terminal;shell;tmux;agents;ai;claude;",
      "StartupWMClass": "cmux-linux"
    }
  },
  "syncDesktopName": true
}
```

**Walkthrough.** `Name` and `Comment` are what the user reads in the launcher. `Categories` decides *which menu section* it files under (below). `Keywords` improves search hits ("type 'terminal', find cmux-linux"). The two subtle ones:

- **`StartupWMClass`** — this is the fix for the classic "my taskbar shows a generic Electron icon instead of mine" bug. The desktop environment groups a *running* window under a `.desktop` entry by matching the window's `WM_CLASS` to `StartupWMClass`. If they don't match, GNOME can't connect your running window to your launcher, so it falls back to a generic icon and won't highlight your app in the dock. Setting `StartupWMClass` (and, better, `syncDesktopName: true`, which makes electron-builder keep the `.desktop` filename, the app ID, and the WM_CLASS all in agreement) makes the running window and its launcher icon line up.

- **What you should *not* override:** leave `Exec`, `Icon`, `Type`, and `Terminal` to electron-builder. It computes the correct `Exec` path to the installed binary — hardcode it and your menu entry launches nothing. (And yes, `Terminal=false` — counterintuitive for a terminal *emulator*, but it means "don't run *this app itself* inside a terminal," which is correct; the terminals are *inside* the window.)

### Categories

`Categories` is a `;`-terminated list from the freedesktop registered set. It controls where the app files in the menu. For a developer terminal, the honest categorization is:

```
Categories=Development;Utility;System;
```

`Development` is the primary bucket (it's a tool for building software); `Utility` and `System` are reasonable secondaries for a terminal. `linux.category` in the config sets the single *main* category electron-builder uses for the package metadata; the `Categories` line in the desktop entry is the full list the menu reads.

> **🔧 In cmux-linux:** the icon + `.desktop` + categories are exactly the M6 line items "app icon" and "window title/branding." They're the difference between "an executable that opens a window" and "an app that lives in your applications menu like Firefox does." Small config, large perceived-quality payoff.

---

## 15.7 Worked example: the complete `build.linux` block

Now assemble everything from §15.3–§15.6 into one config you could actually ship. This is the payoff — a full, commented `build` block for **AppImage + .deb**, with node-pty handled correctly.

```jsonc
// package.json → "build"
{
  "appId": "dev.cmux.linux",
  "productName": "cmux-linux",

  "directories": {
    "output": "dist",
    "buildResources": "build"
  },

  "files": [
    "out/**/*",
    "package.json"
  ],

  // --- native module handling (§15.5) ---
  "asar": true,
  "asarUnpack": [
    "**/node_modules/node-pty/**"          // node-pty's pty.node AND spawn-helper stay on disk
  ],
  "npmRebuild": true,                       // rebuild native deps against Electron's ABI (default)

  // --- the Linux targets + desktop integration ---
  "linux": {
    "target": [
      { "target": "AppImage", "arch": ["x64"] },
      { "target": "deb",      "arch": ["x64"] }
    ],
    "category": "Development",
    "icon": "build/icon.png",
    "maintainer": "Ani <you@example.com>",
    "vendor": "cmux-linux",
    "synopsis": "A terminal for running AI coding agents side by side",
    "description": "cmux-linux is a Linux terminal built for multitasking across AI coding agents: a named workspace sidebar with live status, split panes, notification rings, and a socket automation API.",
    "desktop": {
      "entry": {
        "Name": "cmux-linux",
        "Comment": "A terminal built for multitasking with AI agents",
        "Categories": "Development;Utility;System;",
        "Keywords": "terminal;shell;tmux;agents;ai;claude;",
        "StartupWMClass": "cmux-linux"
      }
    },
    "syncDesktopName": true
  },

  // --- .deb-specific: declare the system libraries Chromium needs (§15.9) ---
  "deb": {
    "depends": [
      "libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6",
      "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0",
      "libgbm1", "libasound2"
    ]
  },

  // --- AppImage-specific: nice, predictable output filename ---
  "appImage": {
    "artifactName": "${productName}-${version}-${arch}.${ext}"
  }
}
```

**Walkthrough of the parts we haven't met yet:**

- **`linux.target` as objects, not strings** — writing each target as `{ "target": "AppImage", "arch": ["x64"] }` instead of just `"AppImage"` lets you pin the **architecture**. `x64` is the right call for a first Ubuntu release; you can add `"arm64"` later when you're ready to build and *test* on ARM (don't ship an arch you haven't run).

- **`maintainer` / `vendor` / `synopsis` / `description`** — package metadata that lands in the `.deb` control file (what `apt show cmux-linux` prints). `maintainer` is *required* for `.deb` and the build errors without it.

- **`deb.depends`** — the list of shared libraries Chromium needs at runtime (GTK, NSS for crypto, GBM for graphics, ALSA for audio, etc.). This is the single most important line for `.deb` reliability: it's how `apt install ./cmux-linux.deb` **automatically pulls in** any of these the user is missing (§15.9). electron-builder seeds a sensible default set; the list above is a safe, slightly-expanded superset. If §15.9's clean-VM test reveals a missing `libSomething.so`, you add its package here.

- **`appImage.artifactName`** — a template for the output filename. `${productName}-${version}-${arch}.${ext}` gives `cmux-linux-0.1.0-x64.AppImage` — clean, versioned, and it sorts nicely on a releases page.

> **🔧 In cmux-linux:** notice `asarUnpack` and `deb.depends` are the two lines doing the real, hard-won work here — one keeps node-pty *loadable* (§15.5), the other keeps Chromium *launchable* on a machine that isn't yours (§15.9). Everything else is identity and cosmetics. If you only proofread two lines of this config, proofread those.

---

## 15.8 Running the build: the commands and where things land

With the config in place, wire up the two-stage pipeline (§15.2) as npm scripts so you never run them out of order:

```jsonc
// package.json → scripts
{
  "scripts": {
    "dev":   "electron-vite dev",                        // Chapter 14 — the hot-reload loop
    "build": "electron-vite build",                      // COMPILE: source → out/
    "pack":  "npm run build && electron-builder --dir",  // fast: unpacked app, no installers
    "dist":  "npm run build && electron-builder --linux" // full: build AppImage + .deb
  }
}
```

**The two commands you'll actually use:**

- **`npm run dist`** — the real thing. Compiles, then builds every `linux.target` into `dist/`. This is what you run to produce release artifacts. It's *slow* (compressing an AppImage and assembling a `.deb` takes a minute or two), because it's doing real work.

- **`npm run pack`** — `electron-builder --dir` skips the slow installer step and just produces the **unpacked app** in `dist/linux-unpacked/`. This is your *fast inner loop* for debugging packaging itself — especially the node-pty problem from §15.5. You can launch the raw binary directly:

  ```bash
  ./dist/linux-unpacked/cmux-linux
  ```

  If terminals work *here*, your `asarUnpack`/rebuild is correct and you can trust the full AppImage. If they're dead here, fix §15.5 before wasting two minutes on a full `dist`.

**Other flags worth knowing:**

```bash
electron-builder --linux AppImage      # build ONLY the AppImage (faster iteration)
electron-builder --linux deb           # build ONLY the .deb
electron-builder --linux --publish never   # never upload (the safe default; see §15.11)
```

**Where the artifacts land** — after `npm run dist`, your `dist/` looks like:

```
dist/
├─ cmux-linux-0.1.0-x64.AppImage           ← the portable single file
├─ cmux-linux-0.1.0-x64.AppImage.blockmap  ← delta-update helper (for §15.11)
├─ cmux-linux_0.1.0_amd64.deb              ← the Debian/Ubuntu package
├─ latest-linux.yml                        ← the auto-update manifest (§15.11)
└─ linux-unpacked/                         ← the raw app (from --dir); runnable directly
   └─ cmux-linux                            ← the executable
```

**Walkthrough.** The two files you hand to users are the `.AppImage` and the `.deb`. The `.blockmap` and `latest-linux.yml` are for auto-update (§15.11) — harmless to ignore until then, but *do* upload them alongside the AppImage when you release, because that's how updates find each other. `linux-unpacked/` is a build artifact, not something you distribute — it's just the AppImage's contents laid out on disk for you to poke at.

> **⚠️ Gotcha:** the first `npm run dist` on a fresh machine is *extra* slow and needs network, because electron-builder downloads the Electron binary and the AppImage/deb build tooling into a cache (`~/.cache/electron` and `~/.cache/electron-builder`). That's normal and one-time. If you're building in CI, cache those directories or every run re-downloads ~200 MB.

---

## 15.9 Testing on a clean Ubuntu (the only test that counts)

Here is the trap that catches every first-time desktop shipper: **you test the build on your own machine, it works, you ship it, and it explodes for everyone else.** It works for *you* because your machine is contaminated with everything the app needs — Node, build tools, and, crucially, dozens of shared libraries that came in with your dev setup. A stranger's fresh Ubuntu has none of that.

```
   YOUR DEV MACHINE (contaminated)         A STRANGER'S FRESH UBUNTU (clean)
   ──────────────────────────────         ─────────────────────────────────
   ✔ Node, build tools, headers            ✗ none of it
   ✔ libnss3, libgbm1, libasound2 …        ✗ maybe missing → app won't start
   ✔ libfuse2 (you installed it once)      ✗ absent by default → AppImage won't mount
   → "works on my machine" ✔               → "it just closes instantly" ✗
```

So the real test is a **clean environment** with nothing installed. Two ways, for two purposes:

### A throwaway desktop VM (the realistic test)

Spin up a fresh **Ubuntu Desktop** VM in GNOME Boxes, VirtualBox, or `multipass` — with a GUI, and *nothing* dev installed. Copy over your two artifacts and actually use them:

```bash
# in the clean VM
sudo apt install ./cmux-linux_0.1.0_amd64.deb   # watch apt pull in the depends (§15.7)
cmux-linux                                        # launch it; open a terminal; run `ls`

chmod +x cmux-linux-0.1.0-x64.AppImage
./cmux-linux-0.1.0-x64.AppImage                   # the portable path
```

This is the gold-standard test because it exercises the exact path a user walks: install, launch, type a command, see output. If a terminal runs `ls` here, node-pty is packaged correctly (§15.5) end-to-end.

### A container (the fast dependency check)

A Docker container is quicker for one specific question: *does the `.deb` declare all its dependencies?* Because a container starts truly minimal, it surfaces missing libraries immediately:

```bash
docker run --rm -it -v "$PWD/dist:/dist" ubuntu:24.04 bash
# inside:
apt-get update && apt-get install -y /dist/cmux-linux_0.1.0_amd64.deb
# apt now resolves and installs everything in deb.depends. If you FORGOT a lib,
# the app installs but crashes on launch with "error while loading shared
# libraries: libXXX.so" — that's your cue to add libXXX's package to deb.depends.
```

A container has no display, so to see the app *try* to start (and prove it finds its libraries) you fake one with `xvfb`:

```bash
apt-get install -y xvfb
xvfb-run -a cmux-linux --no-sandbox        # boots headless just to check it loads
```

Now the three gotchas this testing exists to catch:

> **⚠️ Gotcha 1 — AppImage needs FUSE, and modern Ubuntu doesn't ship it.** An AppImage is a compressed filesystem that mounts *itself* at runtime using **FUSE**. Ubuntu 22.04+ dropped the `libfuse2` that AppImages need (it ships FUSE 3; AppImage's runtime wants FUSE 2). So on a clean 24.04 the user double-clicks your AppImage and gets:
> ```
> dlopen(): error loading libfuse.so.2
> AppImages require FUSE to run.
> ```
> The fix is one line — `sudo apt install libfuse2` (on Ubuntu 24.04 the package was renamed `libfuse2t64`) — or run with `./cmux-linux.AppImage --appimage-extract-and-run`, which unpacks to a temp dir instead of FUSE-mounting. **Put this in your README's install instructions**, because it's the #1 "your app doesn't work" report for *every* AppImage, not just yours.

> **⚠️ Gotcha 2 — missing shared libraries on minimal systems.** Chromium (inside Electron) needs a pile of system `.so` files — `libgbm1`, `libnss3`, `libasound2`, GTK, and friends. On a full Ubuntu Desktop they're present; on a minimal/server/container image they're not, and the app dies instantly with `error while loading shared libraries: libgbm.so.1` (or, worse, just closes with no message). For the **.deb**, `deb.depends` (§15.7) makes `apt` install them automatically — that's the *entire point* of declaring them. For the **AppImage**, there's no dependency mechanism, so you're relying on the target having them; a desktop Ubuntu does, a stripped-down one may not. This asymmetry is a real reason to ship *both* formats: `.deb` for the "just works via apt" path, AppImage for the "no install" path.

> **⚠️ Gotcha 3 — `--no-sandbox` is a test crutch, never a shipped default.** Chromium's security sandbox needs kernel features (unprivileged user namespaces or a setuid helper) that containers and some hardened setups don't provide, so you'll reach for `--no-sandbox` to get the app to boot in a container. That's fine *for a smoke test.* Never ship it or bake it in — it disables a real security boundary around code that runs the user's shells and agents. On a normal Ubuntu the sandbox works out of the box; if it doesn't, fix the environment, don't disable the sandbox.

> **🔧 In cmux-linux:** this is also where Chapter 13's "an AppImage is read-only" caveat becomes concrete. The AppImage is a *read-only* mounted filesystem — your app **cannot** write next to its own executable. Every bit of user data (sessions, config, the socket) must go to `app.getPath('userData')` = `~/.config/cmux-linux/` (Chapter 13) or `/tmp` (Chapter 11), never beside the binary. Test this: if session persistence works from the packaged AppImage, you got the paths right.

---

## 15.10 The size question, honestly

The first time you see a **~90 MB** AppImage for what feels like a small terminal app, you'll wonder what went wrong. Nothing did. Recall §15.2: you're not shipping *your app* (a few hundred KB of JS), you're shipping **your app + an entire Chromium + an entire Node runtime**, fused together. That floor is ~80–100 MB compressed, 200+ MB unpacked, and it's the *same* floor for every Electron app — VS Code, Slack, Discord, Obsidian all pay it. It is the price of "runs on any Linux with nothing pre-installed."

What you *can* control is not making it *worse*:

- **Keep build tooling in `devDependencies`.** electron-builder ships only `dependencies` (§15.3). If TypeScript, Vite, or electron-builder itself leak into `dependencies`, they get packaged for no reason. For this app, `dependencies` should be a *very* short list — basically node-pty and any tiny runtime helper. Everything else is a devDependency.
- **Let Vite tree-shake the renderer** (Chapter 14). Dead code eliminated before packaging is bytes never shipped.
- **Ship one architecture per artifact.** Building `x64` *and* `arm64` into universal outputs doubles size; ship separate per-arch files instead (§15.7).
- **Don't over-optimize.** Squeezing 90 MB to 85 MB is not worth your afternoon. The only *real* size lever is leaving Electron entirely.

> **🔧 In cmux-linux:** that "leave Electron" lever is already written down. `ROADMAP.md`'s stretch list — "Port the React UI to **Tauri** for lean binaries (~10× smaller, less RAM)" — is the honest answer to the size question. Tauri uses the *system* webview instead of bundling Chromium, so the same React UI ships as a ~10 MB binary. We chose Electron for v1 deliberately (bundled Chromium renders xterm.js's WebGL more reliably across Linux than WebKitGTK, and it's the fastest path on our skill set), and accepted the size. Don't fight the 90 MB; it's a known, deliberate trade, revisitable later near-free.

---

## 15.11 Auto-update, later: the Sparkle stand-in

cmux (macOS) updates itself with **Sparkle**, the standard Mac auto-update framework: the app quietly checks a feed, downloads a new version, and installs it on relaunch. Linux has no single equivalent, but the Electron ecosystem has one for the AppImage path: **electron-updater** (a sibling of electron-builder) pointed at **GitHub Releases**.

**This is deliberately a later concern** — `FEATURES.md` #30 tiers it as ⚪, and you should ship v1 with *manual* updates (users re-download from your releases page). But here's the shape so you know where it slots in:

```ts
// main — the whole auto-update wiring, for when you're ready (LATER)
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();   // check GitHub Releases; prompt on relaunch
});
```

```jsonc
// package.json → build — tell electron-builder where releases live
{
  "publish": {
    "provider": "github",
    "owner": "your-username",
    "repo": "cmux-linux"
  }
}
```

**Walkthrough of how the pieces connect:**

1. You release with `electron-builder --linux --publish always`, which uploads the `.AppImage`, its `.blockmap`, and `latest-linux.yml` (§15.8) to a GitHub Release.
2. `latest-linux.yml` is the *manifest* — it names the newest version and where to fetch it. `autoUpdater` downloads *that tiny file*, compares versions, and if there's a newer one, pulls the new AppImage (using the `.blockmap` for a delta download so it only fetches the changed chunks).
3. It swaps the AppImage in place and installs on next launch.

**The critical caveat:** on Linux, electron-updater only auto-updates the **AppImage** (and pacman). It **cannot** auto-update a **`.deb`** — those updates come from the system package manager (`apt`), which is *by design*; you don't want an app silently reaching around apt to modify a system-installed package. Flatpak self-updates via Flathub. So the update story per format is: **AppImage → in-app auto-update; .deb → apt (or manual re-download); Flatpak → Flathub.** This is *another* reason AppImage earns its "ship first" slot (§15.4): it's the one format where you can offer the Sparkle-like experience cmux users expect.

> **⚠️ Gotcha:** don't wire `--publish always` into your default `dist` script, or a routine local build will try (and fail, or worse, succeed) to upload to GitHub. Keep the default at `--publish never` (§15.8) and make publishing an explicit, separate action — ideally a CI job triggered by a version tag, not something you can fat-finger from your laptop.

---

## 🧪 Checkpoint

Answer these before moving on (everything is in this chapter):

1. Vite and electron-builder both run during a release build. In one sentence each, what does each one *do*, and why is the app un-shippable if you run only one?
2. Your packaged app launches, but every terminal pane is blank and dead — yet `npm run dev` works perfectly. Name the three things you'd check, in order, and why this symptom points at node-pty specifically.
3. Why does node-pty need `asarUnpack` even though electron-builder auto-detects `.node` files? (Name the specific file the auto-detector misses.)
4. A user on a fresh Ubuntu 24.04 double-clicks your AppImage and gets "AppImages require FUSE to run." What happened, and what are the two ways to fix it?
5. You forgot to list `libgbm1` in `deb.depends`. What's the difference in behavior between a user who installs the **.deb** and a user who runs the **AppImage** on a minimal system?
6. Why is `productName` a permanent decision? What breaks (from Chapter 13) if you change it in v0.2?
7. Why is Flatpak a poor *first* target for **this** app specifically — not Electron apps in general, but a terminal?
8. Which Linux package format can electron-updater auto-update, which can't, and why is that split intentional?

---

## Summary

Packaging turns the bundled `out/` from Chapter 14 into artifacts a stranger installs. It's a **two-tool pipeline**: **electron-vite** *compiles* your source to `out/`, then **electron-builder** *packages* `out/` plus a baked-in Electron runtime into installers — which is why the artifacts are ~90 MB and why they run on a machine with no Node. electron-builder reads a **`build` block** in `package.json`; `appId` and `productName` are its permanent identity fields (`productName` also names `~/.config/cmux-linux/`, so it's the same string Chapter 13's saved sessions live under). For Linux you ship **AppImage** (portable, no install, auto-updatable) and **.deb** (native Ubuntu package, apt-managed deps) first, and defer **Flatpak** because its sandbox fights a terminal's need to spawn the user's shells. The hardest part is the **node-pty native module**: it must be a real `dependency`, **rebuilt against Electron's ABI** (`electron-builder install-app-deps` in `postinstall`), and kept **outside the asar** via `asarUnpack` (because of node-pty's non-`.node` `spawn-helper`) — get any of those wrong and terminals work in dev but die in the package. You make it feel real with an **icon**, a generated **`.desktop`** entry (set `StartupWMClass`/`syncDesktopName` so the taskbar icon matches), and **Development** categories. You build with `npm run dist` (artifacts land in `dist/`), debug packaging fast with `--dir`, and — the only test that counts — verify on a **clean Ubuntu VM/container** where FUSE and Chromium's shared libraries aren't guaranteed. **Auto-update** (electron-updater + GitHub Releases, the Linux stand-in for cmux's Sparkle) is a later concern, and works for the AppImage only.

## Where this shows up next
- The `out/` you package here, and why node-pty stays *external* to the bundle → `14-build-tooling-and-vite.md`
- Why `~/.config/cmux-linux/` (from `productName`) and the read-only-AppImage rule matter → `13-session-persistence.md`
- The socket in `/tmp` that must survive a read-only, sandbox-averse package → `11-the-socket-api.md`
- The native module you fought to package, first spawned → `06-node-pty.md`
- Why Electron ships its own Node (the ABI you rebuilt against) → `03-electron-architecture.md`
- Every packaging term in one place (asar, AppImage, ABI, FUSE, `.desktop`) → `16-glossary.md`
- The capstone that traces the whole app, now that it's a thing you can install → `17-how-it-all-connects.md`

## Further reading
- electron-builder — Linux target configuration — https://www.electron.build/docs/linux/
- electron-builder — Application Contents (asar & `asarUnpack`) — https://www.electron.build/docs/contents/
- Electron — Using Native Node Modules (the ABI/rebuild story) — https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- AppImage — the FUSE troubleshooting guide — https://docs.appimage.org/user-guide/troubleshooting/fuse.html
- electron-updater — auto-update on Linux (AppImage) — https://www.electron.build/auto-update
- freedesktop.org — Desktop Entry & registered Categories — https://specifications.freedesktop.org/menu-spec/latest/apas02.html
- Our own `FEATURES.md` (#30, the Sparkle → AppImage/GitHub decision) and `ROADMAP.md` (M6, and the Tauri size note)
