# Release Checklist

The GitHub release workflow only creates a draft release. It first applies the Supabase migration baseline and deploys `login-with-audit`, then builds signed Windows installers and checks the draft assets. Do not publish the draft until every item below is complete.

- The release tag is `vX.Y.Z` and matches `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- The protected `release` environment contains `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `WINDOWS_CODESIGN_CERTIFICATE_BASE64`, and `WINDOWS_CODESIGN_CERTIFICATE_PASSWORD`.
- The Windows PFX belongs to the intended publisher. The workflow requires `Get-AuthenticodeSignature` to report `Valid` for both NSIS and MSI packages.
- The draft contains `latest.json`, updater `.sig` assets, an NSIS `.exe`, and an MSI. After publishing, verify the configured updater URL returns `latest.json` over HTTPS.
- Install the previous signed version on a clean Windows machine, upgrade through the updater to the published version, and verify download, signature validation, restart, and version change.
- Verify a password-recovery email opens `relayhub://auth/reset-password` and can set a new password.
- Verify member and anonymous notification delivery against the production Storage/Auth/RLS configuration, including a session past its token-refresh boundary.
- Run the credential-backed station lifecycle workflow from the protected `production-e2e` environment.

The production CSP allows only `https://vvqzkkyfwmuwmntyvbgz.supabase.co` and its Realtime WebSocket endpoint. Changing the Supabase project requires an intentional CSP and release configuration update.
