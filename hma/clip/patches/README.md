# Patches

`hma-clip-lookup.patch` is applied to [ThreatExchange](https://github.com/facebook/ThreatExchange)
at the commit pinned by `THREATEXCHANGE_COMMIT` in `../Dockerfile`.

It is a subset of the patch used by
[UMass-Rescue/2025-project-roost-evaluation](https://github.com/UMass-Rescue/2025-project-roost-evaluation),
limited to the runtime changes Coop needs. It touches two files under
`hasher-matcher-actioner/src/OpenMediaMatch/`:

- `blueprints/matching.py`: `POST /m/lookup` accepts `{"signal_type", "signal"}`
  (and an optional `banks` list or comma-separated string) as JSON; stock HMA only
  accepts a file upload. Also adds `/m/lookup_threshold` and `/m/lookup_topk`,
  which are diagnostic: they return content ids without bank names and ignore a
  bank's enabled ratio. Use POST for them, since a CLIP hash is too long for a GET.
- `utils/flask_utils.py`: `require_param_from_dict`, used by the above.

A CLIP hash is about 4 KB of hex, which exceeds the web server's request-line
limit as a GET query string, so lookups must be POSTs.

The pinned commit `aff3f3b803a99196009f5abaf47fdc2cdbce81c8` reports
`hasher-matcher-actioner/version.txt` 1.0.21; that is a source version, not the
`hma:1.2.x` container tag the stock instance uses.

When changing the ThreatExchange commit, confirm the patch still applies:

```bash
git clone https://github.com/facebook/ThreatExchange.git && cd ThreatExchange
git checkout <commit> && git apply --check /path/to/hma-clip-lookup.patch
```
