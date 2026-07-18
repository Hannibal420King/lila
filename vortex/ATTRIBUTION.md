# Lila for Vortex attribution

This repository is a fork of [Lila](https://github.com/lichess-org/lila), the
free and open-source chess server. Lila is licensed under the GNU Affero General
Public License, version 3 or later. The complete corresponding source, license,
and upstream notices remain in this repository; see `LICENSE`, `COPYING.md`, and
the Git history.

The deployment also runs these unmodified, digest-pinned sidecars:

- [lila-ws](https://github.com/lichess-org/lila-ws), AGPL-3.0-or-later,
  `ghcr.io/lichess-org/lila-ws@sha256:64cc112993a4f6e764249e13487ae19c4e06e96705984fc25e5f0e3c1950b43d`.
- [MongoDB](https://github.com/mongodb/mongo), Server Side Public License,
  packaged by Chainguard at
  `cgr.dev/chainguard/mongodb@sha256:97010cebe00fa41880dfa1dbe4f2c93a4793f24dd803aa4b8cc6e83fa71d6fa3`.
- [Redis](https://github.com/redis/redis), under its upstream licensing terms,
  packaged by Chainguard at
  `cgr.dev/chainguard/redis@sha256:ade64e9abd4954dd2656f19c9e75c8409a4f2f2557333f334c6f71d1edd5a0e9`.

The original Vortex catalog artwork under `vortex/assets/catalog/` is separate
from upstream Lila artwork. Its provenance and license metadata are recorded in
`vortex/assets/catalog/asset-manifest.json`.

The running Vortex fork exposes its source repository through the normal Vortex
catalog/source link. Operators who modify and serve this software must continue
to provide complete corresponding source as required by the AGPL.
