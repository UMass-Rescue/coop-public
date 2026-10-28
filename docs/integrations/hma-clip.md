# HMA with CLIP (semantic image matching)

[HMA](hma.md) hashes images with PDQ, which finds near-duplicates of a known image: the same picture, resized, cropped or re-encoded. [CLIP](https://github.com/mlfoundations/open_clip) embeddings instead capture what an image depicts, so visually different images of the same subject can be close to each other. Coop can run a second, optional HMA instance that hashes and matches with CLIP.

CLIP is a separate deployment. The default HMA instance is unchanged and needs no GPU. If you don't deploy the CLIP instance, nothing changes for you.

> [!NOTE]
> This page covers deploying and checking the CLIP HMA instance. Using it from Coop rules is not available yet.

## System requirements

The CLIP instance loads a vision model into memory, which is much heavier than stock HMA.

| Resource | Guidance                                                                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory   | Plan for 4 GiB or more for the CLIP container. One CPU container with a single indexed image used about 3.75 GiB (measured once, Docker Desktop on Apple silicon); treat it as a floor, not a sizing guide.                                                                                        |
| Disk     | About 1.4 GB for the model weights (as measured), downloaded from Hugging Face on first use, plus the image (PyTorch is large).                                                                                                                                                                    |
| Network  | Outbound access to GitHub and the PyTorch wheel index at build time, and to Hugging Face on first use (the model revision is not pinned). The weights are kept in a Docker volume, so later starts and rebuilds don't download them again.                                                         |
| GPU      | Optional. Hashing is much faster on an NVIDIA GPU; CPU works and is fine for development. GPU needs Linux with an NVIDIA driver and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html). macOS can't pass a GPU to Docker. |

## Deploy

From the Coop repo root, build and start the CLIP instance next to the rest of the stack:

```bash
docker compose -f docker-compose.yaml -f docker-compose.clip.yaml up -d --build hma-clip
```

This starts `hma-clip` and its own Postgres (`hma-clip-postgres`). The first build downloads PyTorch and takes several minutes. HMA is then available at `http://localhost:9877`, bound to the loopback interface only because HMA has no authentication. Put it behind your own network controls before exposing it further.

HMA fetches whatever URL it is given (including following redirects), so anything that can reach this port can make the container request internal addresses. To restrict where it may fetch from, set `HMA_ALLOWED_HOSTNAMES` to a comma-separated list of hostnames (subdomains included) before starting it, for example `HMA_ALLOWED_HOSTNAMES=images.example.com`. When empty, any http(s) URL is allowed. The list is checked against the initial URL only, so an allowed host that redirects elsewhere is still followed, and `github.com` and `raw.githubusercontent.com` are always allowed.

### Enable a GPU

1. Check your driver and CUDA version with `nvidia-smi`.
2. Uncomment the `deploy` block under `hma-clip` in `docker-compose.clip.yaml`.
3. Rebuild with the PyTorch build for your CUDA version. Each CUDA index carries different PyTorch versions, so pass all three values. These are the newest versions available on each index; GPU builds have not been tested, only the CPU default, and the CUDA wheels in this table are for x86_64 Linux:

   | CUDA      | `PYTORCH_CUDA` | `TORCH_VERSION` | `TORCHVISION_VERSION` |
   | --------- | -------------- | --------------- | --------------------- |
   | 12.8+     | `cu128`        | `2.11.0`        | `0.26.0`              |
   | 12.6-12.7 | `cu126`        | `2.14.1`        | `0.29.1`              |
   | 12.4-12.5 | `cu124`        | `2.6.0`         | `0.21.0`              |
   | 11.x      | `cu118`        | `2.7.1`         | `0.22.1`              |

   ```bash
   PYTORCH_CUDA=cu128 TORCH_VERSION=2.11.0 TORCHVISION_VERSION=0.26.0 \
     docker compose -f docker-compose.yaml -f docker-compose.clip.yaml build --no-cache hma-clip
   docker compose -f docker-compose.yaml -f docker-compose.clip.yaml up -d hma-clip
   ```

4. Confirm the container sees the GPU:

   ```bash
   docker compose -f docker-compose.yaml -f docker-compose.clip.yaml exec hma-clip python -c "import torch; print(torch.cuda.is_available())"
   ```

   To go back to CPU, comment the `deploy` block out again and rebuild without those three variables.

## Check that it works

The first hash request downloads the model weights, so it can take a minute or two. Use any publicly reachable image URL.

1. **Hash an image.** The response has one key, `clip_float`, a 4096-character hex string:

   ```bash
   curl -s "http://localhost:9877/h/hash?url=https://httpbin.org/image/jpeg" | head -c 120
   ```

2. **Create a bank and add the image:**

   ```bash
   curl -s -X POST http://localhost:9877/c/banks -H 'Content-Type: application/json' \
     -d '{"name":"CLIP_TEST_BANK","enabled_ratio":"1.0"}'
   curl -s -X POST "http://localhost:9877/c/bank/CLIP_TEST_BANK/content?url=https://httpbin.org/image/jpeg"
   ```

3. **Look it up.** HMA builds its search index on timers (up to about 3 minutes), so a lookup right after adding content can return `{}`, or a 503 "index not yet ready" right after a restart. Retry until the bank appears. A CLIP hash is too long for a GET query string, so lookups are JSON POSTs:

   ```bash
   HASH=$(curl -s "http://localhost:9877/h/hash?url=https://httpbin.org/image/jpeg" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip_float'])")
   curl -s -X POST http://localhost:9877/m/lookup -H 'Content-Type: application/json' \
     -d "{\"signal_type\":\"clip_float\",\"signal\":\"$HASH\"}"
   ```

   Expected, on a fresh database: `{"CLIP_TEST_BANK":[{"bank_content_id":1,"distance":"1.1920928955078125e-07"}]}`. A distance near 0 is an identical image. A different image returns `{}`.

4. **Inspect distances.** To see how close a different image is, ask for the nearest `k` matches (`/m/lookup_topk` and `/m/lookup_threshold` are diagnostic: they return content ids without bank names and ignore a bank's enabled ratio). The distance is lower for more similar images:

   ```bash
   curl -s -X POST http://localhost:9877/m/lookup_topk -H 'Content-Type: application/json' \
     -d "{\"signal_type\":\"clip_float\",\"signal\":\"$HASH\",\"k\":3}"
   ```

The HMA web UI at `http://localhost:9877/ui/` can also add images to a bank.

To run the same checks automatically, use the smoke test. It prints each command, exits nonzero on failure, and deletes its temporary bank:

```bash
hma/clip/smoke-test.sh
```

## Clean up

Stop the CLIP instance and its database, naming the services so the rest of the stack keeps running:

```bash
docker compose -f docker-compose.yaml -f docker-compose.clip.yaml rm -sf hma-clip hma-clip-postgres
```

This keeps the data. To also delete the database and the cached model weights, find the volumes (their names are prefixed with your Compose project name) and remove them:

```bash
docker volume ls --filter name=hma_clip
docker volume rm <the two volumes listed>
```

Keep the model cache volume to avoid downloading the weights again next time.

## How it's built

The image in `hma/clip/` builds HMA from a pinned [ThreatExchange](https://github.com/facebook/ThreatExchange) commit and applies a small patch, `hma/clip/patches/hma-clip-lookup.patch`, that lets a signal be looked up with a JSON POST and adds threshold and top-k lookups. Stock HMA only accepts a file upload on that endpoint. It also installs the [tx-extension-clip](https://github.com/UMass-Rescue/tx-extension-clip) extension, pinned to a commit. The HMA source and the extension are pinned; Python dependencies, including the `threatexchange` library and the extension's own requirements, are installed from PyPI at build time and can differ between builds. See `hma/clip/patches/README.md` for how to update the pinned commit.

## See also

- [Hasher-Matcher-Actioner (HMA)](hma.md)
