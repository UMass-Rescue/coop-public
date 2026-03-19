# CLIP Image Similarity in Coop

Coop supports CLIP-based image similarity matching via the HMA (Hasher-Matcher-Actioner)
service. CLIP support is built into the HMA Docker image — no patches required.

## Prerequisites

Complete the standard Coop setup from the [main README](./README.md) first (backing
services, dependencies, migrations, server, client).

## 1. Start HMA with CLIP

```bash
docker compose up --build -d hma
```

First build takes several minutes (clones and installs `tx-extension-clip` with
torch, faiss, etc.). Monitor progress:

```bash
docker logs -f coop-hma-1
```

HMA is ready when the Flask server starts. Verify CLIP loaded — you should see **no** line:
```
WARNING: CLIP extension not available. CLIP signals will not be enabled.
```

Open `http://localhost:5000` — `CLIPFloatSignal` should appear as a signal type.

## 2. Create a Hash Bank and Add Reference Images

1. In Coop, go to **Automated Enforcement → Matching Banks → Hash Banks** and create a
   bank (e.g. "My Bank").

2. Coop creates a corresponding bank in HMA with a prefixed name:
   `COOP_<orgId>_MY_BANK`. You can confirm this in the HMA UI at `http://localhost:5000`.

3. **Add reference images to the Coop-prefixed bank in HMA.** Open the HMA UI, find
   `COOP_<orgId>_MY_BANK`, and upload or link the images you want to match against.

   > **Important:** You must add content to the bank that Coop created
   > (`COOP_<orgId>_...`), not a bank you create directly in HMA. Coop only
   > checks its own prefixed banks — content in other banks will not trigger rules.

4. Wait ~2 minutes for HMA's background indexer to pick up the new content before
   testing. You can check the HMA UI to verify the content count updates.

**Your content type must have a field named `images` of type `IMAGE`.** Check in
**Settings → Item Types → [your type] → Schema**. If no such content type exists,
create one: **Settings → Item Types → Create**, add a field with name `images` and
type `IMAGE`, then save.

## 3. Create a Rule

1. Go to **Automated Enforcement → Proactive Rules** (or **Review Console → Routing**).
2. Add a condition using the **Image matches hash bank** signal.
3. Select your bank(s) as matching values.
4. Add an action (e.g. **Send to Manual Review**).

Coop checks all hash types HMA returns (PDQ, CLIPFloat, etc.) automatically.

## 4. Submit Content via API

Use your org's API key and content type ID (visible in the Coop UI under
**Settings → Item Types**):

```bash
curl -X POST http://localhost:8080/api/v1/items/async \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d '{
    "items": [{
      "id": "test-01",
      "typeId": "<your-content-type-id>",
      "data": {
        "images": "https://raw.githubusercontent.com/facebook/ThreatExchange/main/pdq/data/reg-test-input/dih/bridge-1-original.jpg"
      }
    }]
  }'
```

If the image matches content in your hash bank, the rule fires and the configured
action runs (e.g. the item appears in the Manual Review Queue).

Check results in **Automated Enforcement → [your rule] → Insights**.

For a diagram of how the full pipeline works (submit → hash → match → rule → action),
see [HMA Image Matching Workflow](./docs/HMA_IMAGE_MATCHING.md).

## Notes

- **Hugging Face token** — Some CLIP model requests require authentication. Create a
  [Hugging Face token](https://huggingface.co/settings/tokens), then add `HF_TOKEN=your_token`
  to a `.env` file in the repo root. The `hma` service in `docker-compose.yaml` already
  passes it through. Without it you may see download failures or rate-limit errors.
- **Image URLs must be reachable by the HMA container.** For local images, use
  `host.docker.internal:<port>` instead of `localhost` (add to `/etc/hosts` if needed).
- **Use raw GitHub URLs** — `raw.githubusercontent.com/...` not `github.com/.../blob/...`.
- **First CLIP request is slow** — model weights (~400 MB) download on first use.
