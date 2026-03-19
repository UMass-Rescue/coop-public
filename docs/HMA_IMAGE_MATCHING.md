# HMA Image Matching Workflow

For setup instructions, see [CLIP_SETUP.md](../CLIP_SETUP.md).

```
POST /api/v1/items/async
  │  data.images = "https://example.com/photo.jpg"
  │
  ▼
HMA Hashing & Matching
  │  Image → hashes (CLIP, PDQ, etc.) → checked against hash banks
  │
  ▼
Rule Engine
  │  Runs "Image matches hash bank" conditions
  │
  ▼
Action
    Fires configured action (webhook, enqueue to review, etc.)
```

## Key Points

- The image field must be named `images` and be of type `IMAGE`.
- Image URLs must be directly accessible by the HMA container (use raw URLs, not GitHub blob URLs).
- `matchedValue` in rule insights shows the matched **bank name(s)** and **content ID(s)**
  from HMA. You can look up content IDs in the HMA UI at `http://localhost:5000`.
- Coop prefixes bank names with `COOP_<orgId>_`. Content must be added to the
  Coop-prefixed bank in HMA for rules to match.
- After adding content to a bank, wait ~2 minutes for HMA's background indexer
  to process it before matches will work.
