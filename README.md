# MemeGrotto: a categorized meme library

Live at https://adimego.github.io/memegrotto/ (renamed from MemeSpire at /memespire/, and before that MemeVault at /memevault/; both old addresses redirect here via the adimego/memespire and adimego/memevault repos).

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
- GIFs & videos: Imgflip GIF templates (imgflip.com/gif-templates), Tenor public search pages (tenor.com/search/...), Reddit RSS of
  r/reactiongifs, r/HighQualityGifs, r/gifs, r/MemeVideos, r/dankvideos and r/SonicTheHedgehog (each entry keeps its source URL and credit)

All memes belong to their respective creators; each entry records its source URL.

## Community features (Supabase)

Submissions, the Community gallery, "Post to gallery" in the editor, reports, view/share/caption/download stats and the
Stats page all stay hidden until `supabase/features.sql` has been run once in the Supabase SQL editor (the site checks
for the `mv_features()` function). To moderate, open the Supabase dashboard → Table editor → `submissions`, and set
`status` to `approved` (the meme shows up in the Community gallery) or `rejected`. Reports are in the `reports`
table. `scripts/moderate.py` does the same from the command line if you ever want to use a service key (optional).

## GIFs & videos
Animated memes are stored as small H.264 MP4s in `videos/` (main profile, yuv420p, even dimensions, ≤540 px on the long side,
≤20 s, aim ≤1.5 MB, hard max 4 MB, +faststart) with a poster frame in `images/` and a 480 px thumbnail in `thumbs/`; entries
carry `video`, `duration`, `width`, `height` and the `gif` + `animated` tags (sidebar Spotlight "GIFs & Videos", `#tag=gif`).
Clips are muted unless the meme needs its sound (`"audio": true`, mostly Reddit meme videos); every player still starts muted
so it can autoplay (the lightbox has controls to unmute, audio cards show a 🔊 badge).
The grid shows the poster and plays the clip muted on hover (mouse) or while on screen (touch, at most two at once); the
lightbox plays it with controls. The caption editor captions the poster (still) frame.

Add more with `scripts/fetch_gifs.py` (nothing touches the repo until `add`; staging lives in /workspace/gifstage):
```bash
python3 scripts/fetch_gifs.py discover imgflip --pages 40                 # Imgflip GIF templates not yet in the library
python3 scripts/fetch_gifs.py discover tenor "kombucha girl" "stonks" --n 2  # Tenor public search pages (no API key)
python3 scripts/fetch_gifs.py discover reddit reactiongifs MemeVideos --t year --n 50   # Reddit RSS (i.redd.it, imgur, giphy, v.redd.it)
python3 scripts/fetch_gifs.py stage /workspace/gifstage/cands-tenor.json  # download, encode, poster/thumb, contact sheet, dedupe
python3 scripts/fetch_gifs.py review                                       # labelled review grids (4 frames per clip): LOOK at them
python3 scripts/fetch_gifs.py add picks.json        # [{"cid": ..., optional "title"/"category"/"tags"/"nsfw"}] -> repo
```
Dedupe is by title, Imgflip template id, source URL and a dHash of 3 frames against the existing clips; it misses re-crops of the
same clip, so the review step matters. Content rules are the same as for stills (`BLOCK_RX` / `CRUDE_RX` / Epstein + minors are
applied to titles and tags; crude = `nsfw: true`). v.redd.it videos are read from the DASH playlist and video + audio are merged
with ffmpeg. Run `scripts/stamp_assets.py` (and `build_similar.py`) before committing. `match_templates.py` skips animated entries.

## Battles, leaderboards, moderation (supabase/features2.sql)
`#battle` shows two memes side by side; picks update Elo ratings through `battle_vote()`. `#leaderboard` has Today / This week /
All time (votes), Creators and Battles tabs. `moderate.html` (not linked from the site) is the moderation page: log in with the
passphrase set via `select public.mod_set_passphrase('…');` in the SQL editor.
