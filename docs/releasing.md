# RelayHub desktop release

## One-time GitHub configuration

1. Create the Tauri updater signing key pair in a secure local environment.
2. Put the private key in the protected GitHub Actions environment secret `TAURI_SIGNING_PRIVATE_KEY`.
3. If the key has a password, save it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the same environment.
4. Verify that the matching public key is the `plugins.updater.pubkey` value in `src-tauri/tauri.conf.json`.
5. Restrict the `release` environment to authorized maintainers. Never put the private key in the repository, build logs, or a developer shell history.

## Release procedure

1. Set the same semantic version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `pnpm test`, `pnpm build`, and `cargo test` from `src-tauri`.
3. Commit the version change and push a signed tag named `v<version>`.
4. The `Release desktop app` workflow builds signed Windows NSIS/MSI updater artifacts and publishes the GitHub Release plus `latest.json`.
5. Install the prior release on a disposable Windows machine and use Settings > Desktop updates to verify discovery, signature verification, download, relaunch, and version change.

## Rollback and key rotation

- Do not delete a release that clients may already have installed. Publish a higher fixed version and mark the faulty GitHub Release as pre-release if it should no longer be offered.
- If an updater signing key is exposed, revoke access to its GitHub secret, generate a replacement key pair, update the embedded public key, and ship the next version through the controlled release workflow.
- A client that cannot check updates remains usable; the application never executes remote scripts or unsigned update packages.
