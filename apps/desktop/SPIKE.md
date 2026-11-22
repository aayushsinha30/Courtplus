# Windows portable packaging spike

## Results

Windows x64 (build 26300), Electron 45.4.1, electron-builder 26.18.0. The portable launcher returned exit code 0 after the sandboxed renderer invoked `diag`. The startup log reported `packaged: true` and `portable: true`.

The tested executable was 135,520,149 bytes. Its SHA-256 was `7ff83297cb3cd974ef16fdc75ba53c2f2390cc6daafb3209ceafd242448da5c4`.

| Check | Observed result |
| --- | --- |
| SQLCipher and Windows DPAPI | Wrapped the 32-byte key, wrote a probe row, reopened the database, and read the row back. A keyless query returned `SQLITE_NOTADB`. The audit chain verified and its delete trigger rejected deletion. |
| Native ONNX | `onnxruntime-node` loaded the bundled identity model and returned 23 on the CPU. |
| Devanagari PDF | Chromium `printToPDF` produced a 9,935-byte PDF. `pdftotext -enc UTF-8` extracted `देवनागरी न्याय परीक्षण` intact. |

The unpacked Windows build also passed the WASM fallback check. With the native binding temporarily withheld, ONNX Runtime reported `The specified module could not be found.` for `onnxruntime_binding.node` and `onnxruntime-web` ran the same model locally, returning 23. The native binding was restored after the check.

`npm run build` passed. Vitest reported **Test Files 3 passed (3)** and **Tests 10 passed (10)**.

## Run from the repository root

```powershell
npm install
npm run build
npm test
npm run dev -w @courtplus/desktop
npm run dist -w @courtplus/desktop
```

Set `COURTPLUS_RENDERER_URL` to the loopback Vite server URL for live development. The packaged app loads the built `apps/ui/dist` from its resources. This worktree used the placeholder because the UI workspace was absent. The packages are unsigned. SQLite and ONNX ship Node-API prebuilds. The rebuild script uses `@electron/rebuild` for ABI-dependent addons and keeps those two prebuilds.

The distribution command produces `apps/desktop/release/CourtPlus-0.0.0-x64-portable.exe` and `apps/desktop/release/win-unpacked/CourtPlus.exe`. Run the portable executable with an isolated profile to repeat the startup checks.

```powershell
$desktop = (Resolve-Path 'apps/desktop').Path
$exe = Join-Path $desktop 'release/CourtPlus-0.0.0-x64-portable.exe'
$profile = Join-Path $desktop ('out/portable-spike-' + [guid]::NewGuid())
$process = Start-Process -FilePath $exe -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
  '--courtplus-diagnostics',
  ('"--courtplus-diagnostics-profile={0}"' -f $profile)
)
$process.ExitCode
Get-Content -LiteralPath (Join-Path $profile 'diagnostics.json')
pdftotext -enc UTF-8 (Join-Path $profile 'diagnostics-devanagari.pdf') -
```

The launcher extracts the application to Windows' temporary directory. On the verification host, the system drive ran out of space during the first launch. Setting `TEMP` and `TMP` for the test process to a directory on the workspace drive resolved it.

A regular packaged launch writes the report and PDF in Electron's `userData` directory. Diagnostic mode also enables the hidden `diag` IPC and exits after reading the result through the preload bridge.
