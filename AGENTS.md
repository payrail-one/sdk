# Payrail SDK agent rules

- Public SDK surfaces live here. Canonical Ethereum USDT evidence, conversion
  quotes, connector orchestration/recovery, HTTP contracts, and the authorized
  R1 funding client live in the private repository
  `https://github.com/payrail-one/asset-connectors`, shared with Richard.
- Do not independently change or copy the connector client. Consume and
  re-export an exact authorized release. If GitHub Packages credentials are not
  available, keep the existing compatibility surface unchanged and update the
  canonical repository first; never publish the private implementation through
  this public repository.
- R1 owns only native R1 transfer and finality. Do not add USDT, Ethereum,
  ERC-20, custody, bridge, or external-asset concepts to R1-facing types.
- Push exact candidates before building and test on Richard's Linux servers.
  Do not build release artifacts locally or deploy from this repository.
