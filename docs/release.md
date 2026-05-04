# Release process

New releases produce amd64 and arm64 `.deb` packages that update existing
installations via apt. The self-update path on deployed daemons only works once
the deb has been published to the apt repository at `https://my.tenbox.ai/repo`,
so every step in the dance below must complete before the release is functional.

## Steps

1. **Bump `VERSION`.** A single line, e.g. `0.7.6`. The GitHub Actions release
   workflow refuses to run if `v$(cat VERSION)` does not match the pushed tag.

2. **Update changelog.** The GitHub Release body is auto-generated from commits
   by default — this is sufficient for most releases. To customise the entry,
   edit the Release body in the GitHub UI after the workflow creates the release.

3. **Commit the bump.**
   ```sh
   git commit -am "chore: release 0.7.6"
   git push
   ```

4. **Tag and push.**
   ```sh
   git tag v0.7.6
   git push origin v0.7.6
   ```
   **Always push the commit before pushing the tag** — CI looks up the commit
   by tag and will fail if it has not arrived yet.

5. **Watch [`.github/workflows/release.yml`](../.github/workflows/release.yml).**
   It builds amd64 + arm64 debs, attaches them to the matching GitHub Release
   alongside `install-linux.sh`. Verify both `.deb` assets appear; the workflow
   runs on `ubuntu-22.04` / `ubuntu-22.04-arm` (NOT `ubuntu-latest` — see
   workflow header for why).

6. **Wait for apt repo sync.** The upstream apt repository syncs automatically
   within ~10 minutes of the GitHub Release appearing. Deployed daemons pick up
   the new version on their next self-update check.

## Rollback

Operators can stay on or revert to a known-good version with:

```sh
sudo apt-get install tenbox=0.7.5
```

Older debs remain in the apt repo's `pool/` until manually removed.

## Repository signing

The `dists/stable/Release` file at `https://my.tenbox.ai/repo/` is GPG
signed; clients verify it via `signed-by=` in their
`/etc/apt/sources.list.d/tenbox.list`. The public keyring lives at:

- Download: <https://my.tenbox.ai/repo/tenbox-archive-keyring.gpg>
- In-tree (source of truth): [`scripts/keys/tenbox-archive-keyring.gpg`](../scripts/keys/tenbox-archive-keyring.gpg)
- Sha256: hard-coded in [`scripts/install-linux.sh`](../scripts/install-linux.sh) (`expected_sha256`)

Verifying a downloaded keyring out of band:

```sh
gpg --show-keys --with-fingerprint \
    /etc/apt/keyrings/tenbox-archive-keyring.gpg
```
