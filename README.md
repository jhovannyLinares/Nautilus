# Nautilus

Secrets manager for Windows. It keeps your passwords and tokens encrypted in Windows Credential Manager and, for the ones you choose, publishes them as environment variables while it is unlocked. Programs and scripts work with the name of a secret, not its value.

Current version: **0.1.0**.

## What it does

### Variables and folders

- Each secret is a variable named `NAU_` + folder code + name, for example `NAU_UY_INSIS_PASS`. The General folder has no code: `NAU_AZDO_PAT`.
- Folders with their own color and a 2 to 4 letter code. Changing a code shows the renames before applying them.
- Subfolders appear by themselves: a prefix shared by two or more variables becomes a subfolder.
- Each variable can store a user, a URL and a note. These three are **not encrypted**, so they must not contain secrets.
- Built-in password generator, which by default avoids characters that break cmd, `.bat` files or PowerShell.

### Where a secret lives

| Option | Where | Who reads it |
| --- | --- | --- |
| Credential Manager only (default) | Encrypted, target `nautilus:NAU_…` | A program, by name. Works even while Nautilus is locked |
| Also published | Same, plus a user environment variable while unlocked | Any program, as `$env:NAU_…` |

While unlocked, published variables sit in the Windows registry (`HKCU\Environment`) in plain text. That is the price of letting any program read them. Locking removes them, but a program that was already open keeps its copy until it closes.

### Expiry

A variable can have an expiry date. Its row turns amber and shows **Expiring soon** 15 days before, turns red and shows **Expired** once the date passes, and the status bar counts both.

### Lock and PIN

- A 6-digit PIN protects the Nautilus window. Windows encrypts the values with your user account, so the PIN does not encrypt them.
- Asks for the PIN to show or copy a value (optional, in Settings).
- Locks after 5, 10, 30 or 60 idle minutes, when the Windows session locks and when Nautilus closes.
- A copied value is cleared from the clipboard after 30 seconds.
- "I forgot my PIN" sets a new one and keeps every value. Anyone inside your Windows session could do the same, so lock Windows when you step away (Windows+L).

### Import, export, empty

- Export in three formats: a `.nau` file encrypted with its own password, a plain-text `.env`, or names only.
- Import reads `.nau` files only and previews what will change before applying it.
- Empty the vault deletes all variables and folders; it asks for the PIN and a typed confirmation.

### Claude Code integration

Optional. It installs a skill in `%USERPROFILE%\.claude\skills\nautilus\` that teaches Claude Code to use your variables. Claude knows their names, never their values: when a task needs a password, it asks which one to use.

### Language and theme

Follows Windows: Spanish if Windows is in Spanish, English otherwise, and a light or dark theme.

## Install

Run `Nautilus Setup 0.1.0.exe`. The installer is not signed: Windows SmartScreen shows a warning the first time. To continue: **More info ▸ Run anyway**.

Requires 64-bit Windows 10 or 11.

## Build from source

You need Node.js and npm.

```powershell
git clone https://github.com/jhovannyLinares/Nautilus.git
cd Nautilus
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Opens the app with hot reload |
| `npm test` | Unit and integration tests. Integration tests use the real Credential Manager |
| `npm run typecheck` | Type check |
| `npm run dist` | Builds the installer in `dist/` |

To try it without touching your vault, set `NAUTILUS_PROFILE=name`: data goes to a separate folder and credentials use the target `nautilus-name:`.

## Architecture

```
renderer (React, no Node) → preload (window.api) → main (validates IPC with zod) → backend (vault, Win32 credentials)
```

| Folder | Contents |
| --- | --- |
| `src/shared/` | IPC contracts, naming rules, password generator, texts in both languages |
| `src/main/` | Hardened window, splash, IPC router, export and import files |
| `src/backend/` | Vault, Credential Manager (Win32 `Cred*`), environment publishing, PIN, `.nau` format, Claude Code skill |
| `src/renderer/` | Interface |
| `resources/` | Logo and the Claude Code skill |
| `tests/` | Unit, integration and end-to-end tests |

## Security

- The window runs with `contextIsolation`, sandbox, a strict CSP and no Node access.
- Each IPC message is validated with zod, and its origin is checked.
- `.nau` files use AES-256-GCM with a key derived by scrypt. The header and the scrypt parameters are authenticated, so changing them invalidates the file.
- After failed PIN attempts, Nautilus makes you wait before trying again.
- Anyone who gets into your Windows session can read Credential Manager: Nautilus depends on that session being protected.
