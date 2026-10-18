# MemeSpire: a categorized meme library

Live at https://adimego.github.io/memespire/ (formerly MemeVault at /memevault/, which now redirects here).

A static site (plain HTML/CSS/JS, no build step) that stores and browses popular internet memes.

## Run it
```bash
cd /workspace/meme-library
python3 -m http.server 8080      # then open http://localhost:8080
```

## Features
- Category sidebar with counts, "Spotlight" collections (Harambe, Will Smith, spaghetti, advice animals, fresh r/memes) and a popular-tag cloud
- Masonry grid with lazy-loaded thumbnails, sort (popular / A–Z / recent / shuffle)
- Instant search over titles, tags and categories (press `/` to focus)
- Lightbox with category, tags (clickable), source link, credit, date, size, download/copy link; ←/→/Esc keys
- Shareable URLs: `#cat=Animals`, `#tag=harambe`, `#q=will+smith`, `#open=<meme id>`
- **🌶️ Crude toggle** in the header: show or hide memes flagged `nsfw` (profanity or crude humour). It defaults to shown and the choice is saved in localStorage. NSFW cards get a badge.
- Captions from Imgflip are searchable and shown in the lightbox
- Responsive layout (sidebar turns into a slide-out menu on mobile)

## Layout
```
index.html  style.css  app.js     the site
memes.json                        metadata: id, title, category, tags, image, thumb, source, source_url, attribution, date_added...
images/                           full-size images (downloaded locally, no hotlinking)
thumbs/                           480px JPEG thumbnails for the grid
scripts/fetch_memes.py            fetch + categorize + download + thumbnail
```

## Content policy
Crude, profane and edgy humour is allowed and gets flagged `nsfw: true`. This happens automatically via `CRUDE_RX` or by hand in `OVERRIDES`.
Hateful or slur-based content, sexually explicit imagery, gore and anything involving minors is excluded:
`BLOCK_RX` rejects matching titles and captions automatically. Anything that gets past it goes into `EXCLUDE` after a look at the images.
Reddit RSS doesn't expose NSFW flags, so **look over new Reddit/Imgflip additions** (e.g. contact-sheet the `thumbs/`) after each run.

## Adding more memes
```bash
python3 scripts/fetch_memes.py              # Imgflip top 100 + curated + r/memes top-of-week (20)
python3 scripts/fetch_memes.py --reddit 40  # take more Reddit posts
python3 scripts/fetch_memes.py --no-reddit
python3 scripts/fetch_memes.py --more 10      # up to 10 NEW memes from every feed
python3 scripts/fetch_memes.py --reddit-only wholesomememes gaming --more 5
```
Feeds are configured in `REDDIT_FEEDS` (subreddit, period, size, default category) and `IMGFLIP_TAG_FEEDS`
(captioned memes from imgflip.com/tag/...). Hand-picked images go in `CURATED_URLS`.
Without `--more`, each feed only tops up to its configured size. Duplicates are skipped by URL and by a perceptual hash.
The script merges into `memes.json`. Existing entries are kept and new ones get today's `date_added`.
To add specific memes, append `(imgflip_template_id, title, category, tags)` to `CURATED` or a search
query to `CLASSIC_QUERIES`. Fix a category, title or tags in `OVERRIDES`, which the script re-applies on every run.
Categorization uses keyword rules (`RULES`, `REDDIT_RULES`) plus those manual overrides.
Thumbnails need Pillow (`pip install pillow`).

## Sources
- Imgflip API: https://api.imgflip.com/get_memes (top 100 templates)
- Imgflip template pages and search (https://imgflip.com/memesearch?q=...) for the curated sets
- Imgflip captioned memes (imgflip.com/i/...) from tag pages
- Reddit RSS (`/r/<sub>/top/.rss?t=...`) for r/memes, r/dankmemes, r/wholesomememes, r/ProgrammerHumor, r/gaming,
  r/me_irl, r/2meirl4meirl and r/antiwork, plus a Reddit search for "dicks out for harambe". The `.json` endpoints return
  HTTP 403, and RSS rate-limits (429), so the script sleeps 8s between subreddits
- Know Your Meme (Harambe entry images)

All memes belong to their respective creators; each entry records its source URL.

## Community features (Supabase)

Submissions, the Community gallery, "Post to gallery" in the editor, reports, view/share/caption/download stats and the
Stats page all stay hidden until `supabase/features.sql` has been run once in the Supabase SQL editor (the site checks
for the `mv_features()` function). To moderate, open the Supabase dashboard → Table editor → `submissions`, and set
`status` to `approved` (the meme shows up in the Community gallery) or `rejected`. Reports are in the `reports`
table. `scripts/moderate.py` does the same from the command line if you ever want to use a service key (optional).
