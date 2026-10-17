#!/usr/bin/env python3
"""Fetch popular memes from public sources, categorize them, download images,
and merge into memes.json. Safe to re-run: existing ids are kept, new ones added.

Sources:
  * Imgflip public API  (https://api.imgflip.com/get_memes) - top ~100 templates
  * Imgflip template pages (curated ids + search queries for spotlight sets)
  * Reddit r/memes top-of-week RSS feed (the .json endpoint returns 403)

Usage:  python3 scripts/fetch_memes.py [--reddit N] [--no-reddit]
"""
import argparse, datetime, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "images")
DB = os.path.join(ROOT, "memes.json")
UA = "Mozilla/5.0 (meme-library/0.1; personal project)"
TODAY = datetime.date.today().isoformat()

CATEGORIES = ["Reaction", "Classic Templates", "Animals", "Celebrities & Pop Culture",
              "Cartoons & Anime", "Work & School", "Gaming", "Relatable Life", "Wholesome", "Absurd & Surreal"]

# ---------- curated spotlight sets (imgflip template id, title, category, tags) ----------
CURATED = [
    # Harambe
    (68838750, "Harambe Rides Again", "Animals", ["harambe", "gorilla", "ape", "tribute", "2016"]),
    (68862853, "Harambe Portrait", "Animals", ["harambe", "gorilla", "tribute", "2016"]),
    (75882065, "Dicks Out (Gorilla Suit)", "Absurd & Surreal", ["harambe", "dicks out for harambe", "gorilla", "2016"]),
    (198722792, "RIP Harambe", "Animals", ["harambe", "rip", "tribute", "gorilla"]),
    (364302649, "Harambe: Come Join Us in Heaven", "Animals", ["harambe", "heaven", "tribute", "gorilla"]),
    (68902655, "Gorilla Shot, Relax, Zoo: Harambe", "Animals", ["harambe", "gorilla", "zoo", "2016"]),
    (250304572, "Melting Harambe", "Absurd & Surreal", ["harambe", "gorilla", "cursed"]),
    (328186841, "AMC Ape Moon Harambe", "Absurd & Surreal", ["harambe", "ape", "stonks", "to the moon"]),
    # Will Smith
    (380032248, "Will Smith Slapping Chris Rock", "Celebrities & Pop Culture", ["will smith", "oscars", "slap", "chris rock", "2022"]),
    (380032141, "Will Smith Oscars Slap", "Celebrities & Pop Culture", ["will smith", "oscars", "slap", "2022"]),
    (380308860, "Keep My Wife's Name Out Yo Mouth", "Reaction", ["will smith", "oscars", "keep my wife's name", "2022"]),
    (381273018, "Will Smith: Keep My Wife's Name", "Reaction", ["will smith", "oscars", "keep my wife's name"]),
    (119593553, "Fresh Prince Empty House (Will Smith Looking Around)", "Reaction", ["will smith", "fresh prince", "confused", "looking around", "lonely"]),
    (334817047, "Will Smith Confused Look", "Reaction", ["will smith", "confused"]),
    (644902800, "Will Smith Eating Spaghetti (AI Video)", "Absurd & Surreal", ["will smith", "spaghetti", "ai", "cursed", "2023"]),
    (451924059, "Will Smith Spaghetti", "Absurd & Surreal", ["will smith", "spaghetti", "ai", "cursed"]),
    (140792611, "Tada Will Smith", "Reaction", ["will smith", "tada", "ta-da"]),
    (19291216, "Crying Will Smith", "Reaction", ["will smith", "crying", "sad"]),
    (186339926, "He a Little Confused But He Got the Spirit", "Reaction", ["will smith", "fresh prince", "confused", "spirit"]),
    (108111725, "Fresh Prince Pointing", "Reaction", ["will smith", "fresh prince", "pointing"]),
    (184125312, "Will Smith Shrug", "Reaction", ["will smith", "fresh prince", "shrug"]),
    (280404301, "How Come He Don't Want Me, Man", "Wholesome", ["will smith", "fresh prince", "sad", "dad"]),
    # other classics
    (119211563, "Confused Travolta", "Reaction", ["confused", "pulp fiction", "looking around", "gif era"]),
    (129977606, "Somebody Toucha My Spaghet", "Absurd & Surreal", ["spaghetti", "italian", "classic"]),
]

# classic memes found by imgflip search (first template hit is used)
CLASSIC_QUERIES = [
    ("doge", "Doge vs Godzilla", "Animals", ["doge", "godzilla", "kong", "classic"]),
    ("grumpy cat", "Hehe / Not Hehe Cat", "Animals", ["cat", "hehe", "reaction"]),
    ("press f to pay respects", "Press F to Pay Respects", "Gaming", ["press f", "call of duty", "respects"]),
    ("minecraft", "Minecraft", "Gaming", ["minecraft", "steve", "blocks"]),  # search returns buff spongebob; see OVERRIDES
    ("arrow to the knee", "Arrow to the Knee", "Gaming", ["skyrim", "arrow", "knee", "classic"]),
    ("its dangerous to go alone", "It's Dangerous to Go Alone", "Gaming", ["zelda", "take this", "classic"]),
    ("gamer", "Gamer Moment", "Gaming", ["gamer", "gaming"]),
    ("cat hug", "Cat Hug", "Wholesome", ["cat", "hug", "love"]),
    ("keanu reeves", "Keanu Reeves", "Wholesome", ["keanu", "wholesome", "breathtaking"]),
    ("success kid", "Success Kid", "Classic Templates", ["success", "baby", "classic", "advice animal"]),
    ("trollface", "Trollface", "Classic Templates", ["troll", "rage comic", "classic"]),
    ("stonks", "Stonks", "Absurd & Surreal", ["stonks", "money", "meme man"]),
    ("but thats none of my business", "Kermit Sipping Tea", "Reaction", ["kermit", "tea", "classic"]),
    ("overly attached girlfriend", "Overly Attached Girlfriend", "Classic Templates", ["girlfriend", "classic", "advice animal"]),
    ("salt bae", "Salt Bae", "Celebrities & Pop Culture", ["salt", "chef", "2017"]),
    ("philosoraptor", "Philosoraptor", "Classic Templates", ["dinosaur", "philosophy", "advice animal"]),
    ("scumbag steve", "Scumbag Steve", "Classic Templates", ["scumbag", "advice animal", "classic"]),
    ("condescending wonka", "Condescending Wonka", "Classic Templates", ["wonka", "sarcasm", "classic"]),
    ("this is sparta", "This Is Sparta", "Celebrities & Pop Culture", ["300", "sparta", "classic"]),
    ("nyan cat", "Nyan Cat", "Absurd & Surreal", ["cat", "pop tart", "rainbow", "classic"]),
    ("rickroll", "Rickroll", "Celebrities & Pop Culture", ["rick astley", "never gonna give you up", "classic"]),
    ("arthur fist", "Arthur Fist", "Cartoons & Anime", ["arthur", "angry", "fist"]),
    ("ermahgerd", "Ermahgerd", "Classic Templates", ["ermahgerd", "goosebumps", "classic"]),
    ("kombucha girl", "Kombucha Girl", "Reaction", ["kombucha", "tiktok", "unsure"]),
    ("crying cat", "Crying Cat", "Animals", ["cat", "crying", "sad"]),
]

# ---------- round 2: captioned / crude / community memes ----------
# Hand-picked captioned images (vetted by eye). nsfw=True marks crude/profane humour.
CURATED_URLS = [
    # Dicks out for Harambe + Harambe tributes
    dict(id="kym-dicks-out-tweet", url="https://i.kym-cdn.com/photos/images/newsfeed/001/146/073/040.jpg",
         src="https://knowyourmeme.com/memes/harambe-the-gorilla", source="Know Your Meme",
         title="'dicks out for harambe' (Brandon Wardell's original tweet)", cat="Animals",
         tags=["harambe", "dicks out for harambe", "origin", "twitter", "2016"], nsfw=True),
    dict(id="kym-harambe-11000-votes", url="https://i.kym-cdn.com/photos/images/newsfeed/001/189/279/395.jpg",
         src="https://knowyourmeme.com/memes/harambe-the-gorilla", source="Know Your Meme",
         title="11,000 People Voted for Harambe", cat="Animals", tags=["harambe", "election", "2016", "twitter"]),
    dict(id="reddit-dicksout-dank1", url="https://i.redd.it/000h4gz9ixr31.jpg", src="https://www.reddit.com/r/dank_meme/comments/dggmjf/dicks_out_for_harambe/",
         source="Reddit r/dank_meme", title="Dicks Out for Harambe: Man Dressed as Harambe at Football Game",
         cat="Animals", tags=["harambe", "dicks out for harambe", "lotr"], nsfw=True),
    dict(id="reddit-dicksout-simpsons", url="https://i.redd.it/iyzlqlc4tju91.jpg", src="https://www.reddit.com/r/dankmemes/comments/y74970/dicks_out_for_harambe/",
         source="Reddit r/dankmemes", title="Dicks Out for Harambe (Simpsons Edition)", cat="Cartoons & Anime",
         tags=["harambe", "dicks out for harambe", "simpsons", "homer"], nsfw=True),
    dict(id="reddit-dicksout-ape", url="https://i.redd.it/opy9opl5gml71.png", src="https://www.reddit.com/r/ape/comments/pi7af9/dicks_out_for_harambe_you_know_what_the_fuck_it_is/",
         source="Reddit r/ape", title="Dicks Out for Harambe, You Know What the Fuck It Is", cat="Absurd & Surreal",
         tags=["harambe", "dicks out for harambe", "breaking news", "ape"], nsfw=True),
    dict(id="reddit-dicksout-oprah", url="https://i.redd.it/8sfbbwib9xp61.jpg", src="https://www.reddit.com/r/Harambe/comments/mfkbbj/dicks_out_for_harambe/",
         source="Reddit r/Harambe", title="Oprah Asks About Harambe", cat="Animals",
         tags=["harambe", "oprah", "meghan", "interview"]),
    dict(id="reddit-harambe-spongebob", url="https://i.redd.it/x0afl4nk67fx.png", src="https://www.reddit.com/r/BikiniBottomTwitter/comments/4xkgxo/for_harambe/",
         source="Reddit r/BikiniBottomTwitter", title="Patrick, For Harambe", cat="Cartoons & Anime",
         tags=["harambe", "spongebob", "patrick", "dicks out for harambe"], nsfw=True),
    dict(id="reddit-harambe-10-years", url="https://i.redd.it/6taa1kphys3h1.jpeg", src="https://www.reddit.com/r/OlderGenZ/comments/1tpshww/10_years_ago_rip_harambe/",
         source="Reddit r/OlderGenZ", title="10 Years Ago: R.I.P. Harambe", cat="Wholesome",
         tags=["harambe", "rip", "tribute", "anniversary"]),
    dict(id="reddit-harambe-peanut", url="https://i.redd.it/ugs65c61plyd1.png", src="https://www.reddit.com/r/memes/comments/1gideah/rest_it_peace_you_two_we_miss_yall/",
         source="Reddit r/memes", title="Dicks Out for Harambe / Nuts Out for Peanut", cat="Animals",
         tags=["harambe", "peanut the squirrel", "dicks out for harambe", "rip"], nsfw=True),
    dict(id="reddit-harambe-compass", url="https://i.redd.it/ahrwf6hgrs3h1.jpeg", src="https://www.reddit.com/r/PoliticalCompassMemes/comments/1tprpki/whether_youre_centrist_right_or_left_auth_or_lib/",
         source="Reddit r/PoliticalCompassMemes", title="Never Forget Harambe (Political Compass)", cat="Animals",
         tags=["harambe", "political compass", "tribute"]),
    dict(id="imgflip-i-1bt5ak", url="https://i.imgflip.com/1bt5ak.jpg", src="https://imgflip.com/i/1bt5ak", source="Imgflip",
         title="#DicksOut4Harambe: What If You're Female?", cat="Classic Templates",
         tags=["harambe", "dicks out for harambe", "philosoraptor"], nsfw=True),
    dict(id="imgflip-i-19ykyc", url="https://i.imgflip.com/19ykyc.jpg", src="https://imgflip.com/i/19ykyc", source="Imgflip",
         title="Just Kickin Back on a Friday #DicksOutForHarambe", cat="Animals",
         tags=["harambe", "dicks out for harambe", "gorilla", "friday"], nsfw=True),
    dict(id="imgflip-i-156q4t", url="https://i.imgflip.com/156q4t.jpg", src="https://imgflip.com/i/156q4t", source="Imgflip",
         title="Another Great Musician Taken Too Soon", cat="Animals", tags=["harambe", "rip", "2016", "drums"]),
    dict(id="imgflip-i-1a9645", url="https://i.imgflip.com/1a9645.jpg", src="https://imgflip.com/i/1a9645", source="Imgflip",
         title="Bricks Out for Harambe", cat="Animals", tags=["harambe", "lego", "dicks out for harambe"]),
    dict(id="imgflip-i-19kyry", url="https://i.imgflip.com/19kyry.jpg", src="https://imgflip.com/i/19kyry", source="Imgflip",
         title="All I Said Was I Don't Give a Shit About Harambe", cat="Celebrities & Pop Culture",
         tags=["harambe", "jack sparrow", "chased"], nsfw=True),
    dict(id="imgflip-i-19s3bz", url="https://i.imgflip.com/19s3bz.jpg", src="https://imgflip.com/i/19s3bz", source="Imgflip",
         title="What Would Harambe Do?", cat="Animals", tags=["harambe", "wwhd", "advice"]),
    dict(id="imgflip-i-1az4dw", url="https://i.imgflip.com/1az4dw.jpg", src="https://imgflip.com/i/1az4dw", source="Imgflip",
         title="The Simpsons Predicted Harambe", cat="Cartoons & Anime", tags=["harambe", "simpsons", "predictions"]),
    dict(id="imgflip-i-1azojq", url="https://i.imgflip.com/1azojq.jpg", src="https://imgflip.com/i/1azojq", source="Imgflip",
         title="The Amount of Harambe Jokes Are Too Damn Die", cat="Celebrities & Pop Culture",
         tags=["harambe", "too damn high", "rent"], nsfw=True),
    dict(id="imgflip-i-1by5ay", url="https://i.imgflip.com/1by5ay.jpg", src="https://imgflip.com/i/1by5ay", source="Imgflip",
         title="No Scary Clowns When Harambe Was Around", cat="Animals", tags=["harambe", "clowns", "2016"]),
    dict(id="imgflip-i-1by5oh", url="https://i.imgflip.com/1by5oh.jpg", src="https://imgflip.com/i/1by5oh", source="Imgflip",
         title="Hurricane Matthew Is the Ghost of Harambe", cat="Absurd & Surreal", tags=["harambe", "hurricane", "ghost"]),
    dict(id="imgflip-i-1cf7of", url="https://i.imgflip.com/1cf7of.jpg", src="https://imgflip.com/i/1cf7of", source="Imgflip",
         title="Pawn Stars: The Stuffed Body of Harambe", cat="Celebrities & Pop Culture", tags=["harambe", "pawn stars", "best i can do"]),
    dict(id="imgflip-i-1d7iuh", url="https://i.imgflip.com/1d7iuh.jpg", src="https://imgflip.com/i/1d7iuh", source="Imgflip",
         title="Roses Are Red, Clowns Are Near", cat="Animals", tags=["harambe", "poem", "clowns"]),
    dict(id="imgflip-i-1azcsx", url="https://i.imgflip.com/1azcsx.jpg", src="https://imgflip.com/i/1azcsx", source="Imgflip",
         title="Harambe: Some Memes Last Forever", cat="Wholesome", tags=["harambe", "tribute", "demotivational"]),
]

# Reddit community feeds (RSS; JSON is 403). (sub, period, max posts, default category, sub-category is authoritative?)
REDDIT_FEEDS = [
    ("memes", "week", 20, None, False),
    ("wholesomememes", "month", 25, "Wholesome", True),
    ("ProgrammerHumor", "month", 18, "Work & School", True),
    ("gamingmemes", "month", 16, "Gaming", True),
    ("me_irl", "month", 14, "Relatable Life", True),
    ("2meirl4meirl", "month", 12, "Relatable Life", True),
    ("dankmemes", "month", 22, None, False),
    ("antiwork", "month", 8, "Work & School", True),
    ("gaming", "month", 10, "Gaming", True),
]
SUB_TAGS = {"ProgrammerHumor": ["programming", "dev"], "wholesomememes": ["wholesome"], "gamingmemes": ["gaming"],
            "me_irl": ["me_irl", "relatable"], "2meirl4meirl": ["2meirl4meirl", "relatable"], "dankmemes": ["dank"],
            "antiwork": ["work", "antiwork"], "gaming": ["gaming", "video games"]}

# Imgflip captioned memes scraped from tag pages (title + caption text are filtered for slurs; eyeballed after)
IMGFLIP_TAG_FEEDS = [
    ("will smith slap", "top-2022", 6, "Celebrities & Pop Culture", ["will smith", "oscars", "slap"]),
    ("wholesome", "top-365d", 8, "Wholesome", ["wholesome"]),
    ("work", "top-365d", 8, "Work & School", ["work"]),
    ("school", "top-365d", 8, "Work & School", ["school"]),
    ("monday", "top-2024", 4, "Work & School", ["monday"]),
    ("gaming", "top-365d", 8, "Gaming", ["gaming"]),
    ("relatable", "top-365d", 8, "Relatable Life", ["relatable"]),
    ("savage", "top-365d", 6, "Reaction", ["savage"]),
    ("video games", "top-365d", 8, "Gaming", ["video games"]),
    ("minecraft", "top-365d", 4, "Gaming", ["minecraft"]),
    ("teachers", "top-365d", 4, "Work & School", ["teachers", "school"]),
    ("harambe", "top-2016", 0, "Animals", ["harambe"]),  # placeholder (curated list covers it)
]

# Never ingest: matched against title + caption. Hateful slurs are a hard reject.
BLOCK_RX = re.compile(r"\b(n[i1]gg|f[a@]gg?ots?\b|f[a@]g\b|retard|tranny|trannies|k[i1]ke|sp[i1]c\b|ch[i1]nk|wetback|"
                      r"raghead|towelhead|gook|dyke|shemale|rape|porn|hentai|onlyfans|nude|naked|cp\b|loli|pedo|"
                      r"suicide|kill yourself|kys\b|gore|school shoot|shoot the black|black kid|jews?\b|holocaust|hitler|nazi)", re.I)
# Crude / NSFW-language humour (kept, but flagged so the UI can hide it)
CRUDE_RX = re.compile(r"(fuck|shit|bitch|\bass\b|asshole|dick|cock|\bcum\b|pussy|\bdamn|piss|horny|\bsex|boob|tits|"
                      r"\bwtf\b|bastard|\bcrap|balls\b|penis|\bnsfw|thot|\bhoe\b|bullshit|motherf|stfu|lmfao|\bdie\b)", re.I)

# Ids that were eyeballed and rejected (explicit, gore, minors, hateful, low quality, not a meme). Removed on every run.
EXCLUDE = {
    "imgflip-i-6zfay5",   # low quality
    "imgflip-i-b3k0py",   # schoolgirl-outfit image
    "reddit-1wqov63",     # possibly a minor
    "reddit-1x309ut",     # execution / political violence
    "reddit-1x3buh2",     # explicit sex-act text
    "reddit-1x3nf7i",     # duplicate of an existing Harambe post
    "reddit-1wxn7e1",     # porn still
    "reddit-1x2evjv",     # sexual imagery
    "reddit-1x1n2im",     # likely transphobic
    "reddit-1wmjutb",     # sexual
    "reddit-1ww1uuv",     # execution / murder reference
    "imgflip-i-56dre4",   # photo of a small child
    # trimmed for quality / to keep the library ~300 (weak, repetitive, or news posts rather than memes)
    "imgflip-i-60m40t",
    "imgflip-i-60hzdx",
    "imgflip-i-610guo",
    "imgflip-i-5xvpke",
    "imgflip-i-60qfyr",
    "imgflip-i-6je456",
    "imgflip-i-6b6d68",
    "imgflip-i-6icbga",
    "imgflip-i-awwpdo",
    "imgflip-i-az3e0x",
    "imgflip-i-7b3c73",
    "imgflip-i-b33nd0",
    "imgflip-i-b1d1fb",
    "imgflip-i-b0jtpp",
    "imgflip-i-b3m2xw",
    "imgflip-i-b30qv0",
    "imgflip-i-93c3lk",
    "imgflip-i-ap0t5j",
    "imgflip-i-b0an4e",
    "imgflip-i-ai0jta",
    "imgflip-i-b3khss",
    "reddit-1x7f9ru",
    "reddit-1x6h3lf",
    "reddit-1x5ih33",
    "reddit-1x3lpjg",
    "reddit-1x4cag5",
    "reddit-1x5lbk0",
    "reddit-1x5ebzi",
    "reddit-1x5p1r0",
    "reddit-1x11n3t",
    "reddit-1wwcdle",
    "reddit-1x413co",
    "reddit-1wlwyul",
    "reddit-1wuo12r",
    "reddit-1wllpfc",
    "reddit-1wmv4r8",
    "reddit-1wzb2sg",
    "reddit-1x1huhg",
    "reddit-1wrrynt",
    "reddit-1wylqe0",
    "reddit-1x72c1d",
    "reddit-1x418rr",
    "reddit-1x5u7ym",
    "reddit-1wyvpf3",
    "reddit-1x1rpwu",
    "reddit-1wkof5u",
    "reddit-1wrkhx9",
    "reddit-1ww8229",
    "reddit-1wn1ben",
    "reddit-1wpw10f",
    "reddit-1x7hua5",
    "reddit-1wz6d23",
    "reddit-1wxibxd",
    "reddit-1wyyqql",
    "reddit-1wse9p6",
    "reddit-1wjphmh",
    "reddit-1wzgeiw",
    "reddit-1wlrbdj",
    "reddit-1x3mugk",
    "reddit-1x01y78",
    "reddit-1wqap9j",
    "reddit-1wqq7ti",
    "imgflip-i-6daj9c",
    "imgflip-i-6bknh8",
    "imgflip-i-6amo2s",
    "imgflip-i-5v1jbl",
    "imgflip-i-azzpbn",
    "imgflip-i-5ma1ci",
    "imgflip-i-b3de2w",
    "imgflip-i-7jz8ub",
    "imgflip-i-8eqpe2",
    "imgflip-i-8b9340",
    "imgflip-i-8j6lx0",
    "imgflip-i-950o22",
    "imgflip-i-8bn34s",
    "imgflip-i-60u3cn",
    "imgflip-i-60qjg7",
    "imgflip-i-61muun",
    "imgflip-i-6603ia",
    "imgflip-i-60ewgg",
    "imgflip-i-9aibuj",
    "imgflip-i-b0kk8a",
    "imgflip-i-b2d26x",
    "imgflip-i-ayqhqi",
    "imgflip-i-azrtp9",
    "imgflip-i-b22igt",
    "reddit-1ws2jjo",
    "reddit-1wpzvcw",
    "reddit-1x5a5ym",
    "reddit-1wmf43x",
    "reddit-1wkdroa",
    "reddit-1wkmmoc",
    "reddit-1wtqbiq",
    "reddit-1wr6ouw",
    "reddit-1x3f9vk",
}

# manual corrections applied every run (key: imgflip template id or reddit post id)
OVERRIDES = {
    "222403160": {"category": "Celebrities & Pop Culture"}, "188390779": {"category": "Reaction"},
    "84341851": {"category": "Reaction"}, "148909805": {"category": "Reaction"},
    "187102311": {"category": "Absurd & Surreal"}, "247113703": {"category": "Absurd & Surreal"},
    "61556": {"category": "Classic Templates"}, "5496396": {"category": "Celebrities & Pop Culture"},
    "4087833": {"category": "Reaction"}, "438680": {"category": "Cartoons & Anime"},
    "1x6o35b": {"category": "Celebrities & Pop Culture", "add_tags": ["hulk", "barber"]},
    "1x64rcq": {"category": "Absurd & Surreal"}, "1x6h1fy": {"category": "Gaming", "add_tags": ["steam", "epic games"]},
    "1x4rk8e": {"category": "Absurd & Surreal"}, "1x6zw8x": {"category": "Celebrities & Pop Culture", "add_tags": ["ai"]},
    "186985046": {"title": "Increasingly Buff Spongebob", "category": "Cartoons & Anime",
                  "tags": ["spongebob", "buff", "escalation", "cartoons"]},
    # round 2: titles for me_irl-style posts, category fixes, crude flags
    "1wz6d23": {"title": "Play Some Music for Me"}, "1x2hy01": {"title": "I Don't Remember 60% of My Life"},
    "1wr1l9m": {"title": "Watching Society Get Less Intelligent"}, "1x4x5jh": {"title": "Hidden Talent: Sleeping Through Alarms"},
    "1ws81qd": {"title": "When You Start Buying Your Own Food"}, "1wxibxd": {"title": "Grandma Says I'm Supposed to Be Cold"},
    "1wrg9h1": {"title": "29 and Still Calling Mom When I Land"},
    "1x79v6h": {"title": "We're Moving On From Epstein / The Fuck You Are", "nsfw": True},
    "1wwtz8c": {"title": "The Economy Is So Bad Right Now"}, "1wpimbn": {"title": "Dream Job: Mysterious Source of Income", "category": "Animals"},
    "1wo0nm5": {"title": "Compostable Billionaire Bones"}, "1wyyqql": {"title": "The Letter G Is Just a Spinning Arrow", "category": "Absurd & Surreal"},
    "1wu26u0": {"title": "No Immigrant Has Taken Your Job", "category": "Work & School"},
    "1wp5evn": {"title": "Time Off to Work on Myself"}, "1wse9p6": {"title": "Stick Figure Existential Crisis"},
    "1x0zcnu": {"title": "Never Forget Who Was There at Your Lowest"}, "1wjphmh": {"title": "You Can Return to the Past, But No One Is There"},
    "1wmtyxf": {"title": "Me at 15 vs Me Now"}, "1wq4fhj": {"title": "When I Win the Lottery There Will Be Signs"},
    "1x3wp09": {"title": "Mom vs Alcohol and Sugar"}, "1wlbodz": {"title": "Stop Saying 'I Wish', Start Saying 'I Will'"},
    "1wzgeiw": {"title": "Sheltering Romantic Delusions"}, "1ws3j6i": {"title": "2027 Is in 3 Months, WTF Did I Do This Year", "nsfw": True},
    "1wtufc2": {"title": "Me With No Job vs Me With a Job", "category": "Work & School"},
    "1wlrbdj": {"title": "Relieving Stress by Lashing Out"},
    "1x7f9ru": {"category": "Relatable Life"}, "1x2sh3o": {"category": "Relatable Life"}, "1x4ji06": {"category": "Animals"},
    "1x4fcu1": {"category": "Celebrities & Pop Culture"}, "1x5ebzi": {"category": "Relatable Life"},
    "1x37h65": {"category": "Cartoons & Anime"}, "1x4lqq7": {"category": "Cartoons & Anime", "nsfw": True},
    "1x7uud8": {"category": "Cartoons & Anime"}, "1wllpfc": {"category": "Gaming"}, "1x6naxp": {"category": "Cartoons & Anime"},
    "1x4sivx": {"category": "Cartoons & Anime"}, "1x3lpjg": {"category": "Animals"}, "1x11n3t": {"category": "Celebrities & Pop Culture"},
    "1x87d3x": {"category": "Reaction", "nsfw": True}, "1wjwmzv": {"nsfw": True}, "1wt10gu": {"nsfw": True},
    "1x5no3t": {"category": "Animals"}, "1x72x3b": {"category": "Work & School", "add_tags": ["ai", "bubble"]},
    "1wn6gvk": {"nsfw": True}, "1x4ji06": {"category": "Animals", "nsfw": True}, "1x5no3t": {"category": "Animals", "nsfw": True},
    "1x40mh3": {"category": "Cartoons & Anime", "add_tags": ["anime"]},
    "1x8ebuq": {"category": "Animals", "add_tags": ["harambe", "gorilla", "zoo", "tiger"]},
    "1x41tlp": {"category": "Cartoons & Anime", "add_tags": ["anime", "dead internet"]},
    "1x7k6dd": {"category": "Work & School", "add_tags": ["commute", "flying cars"]},
    "1x7ha47": {"category": "Cartoons & Anime", "add_tags": ["toy story", "buzz lightyear", "tesla"]},
    "1x856d2": {"category": "Animals", "add_tags": ["cats"]},
    "1x5akbp": {"category": "Cartoons & Anime", "add_tags": ["spongebob", "banned"]},
    "1x35ael": {"category": "Cartoons & Anime", "add_tags": ["cartoon", "dog"]},
}
REDDIT_RULES = [  # applied to reddit titles before generic rules
    ("Animals", r"harambe|cats?\b|dogs?\b"), ("Gaming", r"\bgames?\b|gamer"),
    ("Work & School", r"commute|work|boss|school"), ("Celebrities & Pop Culture", r"harry potter|tesla|movie"),
    ("Relatable Life", r"sleep|aging|overthought|alarm|period|innocent|wild side|exceeded"),
]

# ---------- heuristics for API / reddit items ----------
RULES = [
    ("Gaming", r"\b(game|gamer|gaming|uno|minecraft|fortnite|xbox|playstation|nintendo|steam|gta|zelda|mario|pokemon|controller|console|wwe|undertaker|aj styles)\b"),
    ("Work & School", r"\b(boss|work|office|meeting|boardroom|school|teacher|exam|homework|college|paid|job|monday|salary|scroll of truth|student|class)\b"),
    ("Animals", r"\b(cat|dog|doge|cheems|pigeon|monkey|seagull|bird|gorilla|harambe|butterfly|frog|kermit|animal|dragon|pets?|puppy)\b"),
    ("Cartoons & Anime", r"\b(spongebob|squidward|simpsons|lenny|bart|futurama|fry|pikachu|winnie|pooh|gru|megamind|scooby|anime|spider ?man|cartoon|arthur)\b"),
    ("Wholesome", r"\b(wholesome|handshake|protecting|friend|support|hug|love|proud|cheers|mom|dad|grandma)\b"),
    ("Absurd & Surreal", r"\b(aliens?|skeleton|brain|clown|grim reaper|cursed|surreal|train hitting|three-headed|flex tape|domino|bell curve|panik|nut button)\b"),
    ("Celebrities & Pop Culture", r"\b(drake|bernie|pablo|batman|oprah|bush|shaq|leo|dicaprio|rock|yoda|star wars|anakin|padme|pawn stars|harold|escobar|gus fring|always sunny|captain|grant gustin|roll safe|scientist|travolta|absolute cinema|hannibal|will smith)\b"),
    ("Reaction", r"\b(yelling|mocking|surprised|laughing|hide the pain|this is fine|waiting|crying|look at me|change my mind|no - yes|they don't know|disaster girl|evil|peeking|side eye|sad|confused|whisper)\b"),
]
TAG_WORDS = r"[a-z][a-z']{2,}"
STOP = set("the a an and of for you your are with this that its is in on to my me i im meme memes when what have has had any more one their they there out off".split())

def categorize(title, box_count=None):
    t = title.lower()
    for cat, rx in RULES:
        if re.search(rx, t):
            return cat
    if box_count and box_count >= 3:
        return "Classic Templates"
    return "Classic Templates" if box_count else "Absurd & Surreal"

def make_tags(title, cat, extra=()):
    words = [w for w in re.findall(TAG_WORDS, title.lower()) if w not in STOP]
    tags = list(dict.fromkeys(list(extra) + words[:4]))
    tags.append(cat.split(" ")[0].lower())
    return list(dict.fromkeys(tags))[:7]

def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (403, 404): break
            time.sleep(20 * (i + 1) if e.code == 429 else 1 + i)
        except Exception as e:
            err = e; time.sleep(1 + i)
    raise err

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "meme"

def download(url, mid):
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or ".jpg"
    if ext == ".jpeg": ext = ".jpg"
    fn = f"{mid}{ext}"
    path = os.path.join(IMG_DIR, fn)
    if not os.path.exists(path):
        data = get(url, binary=True)
        if len(data) < 1000:
            raise ValueError("image too small / blocked")
        with open(path, "wb") as f: f.write(data)
    return f"images/{fn}"

def imgflip_template_image(tid):
    page = get(f"https://imgflip.com/meme/{tid}")
    m = re.search(r"i\.imgflip\.com/([a-z0-9]+\.(?:jpg|png|gif))", page)
    if not m: raise ValueError("no image on template page")
    return "https://i.imgflip.com/" + m.group(1), f"https://imgflip.com/meme/{tid}"

def imgflip_search_first(q):
    page = get("https://imgflip.com/memesearch?q=" + urllib.parse.quote_plus(q))
    m = re.search(r'href="/meme/(\d+)/', page)
    if not m: raise ValueError("no search result")
    return int(m.group(1))

def imgflip_tag_page(tag, sort, page=1):
    """Yield captioned memes from an imgflip tag page: (img_id, ext, title, caption, tags)."""
    url = f"https://imgflip.com/tag/{urllib.parse.quote_plus(tag)}?sort={sort}" + (f"&page={page}" if page > 1 else "")
    s = get(url)
    for u in s.split("class='base-unit clearfix'")[1:]:
        t = re.search(r"base-unit-title'><a href='/i/(\w+)'>([^<]*)", u)
        img = re.search(r"src='//i\.imgflip\.com/(\w+)\.(jpg|png)'", u)  # static images only (gifs are <video>)
        alt = re.search(r"alt='([^']*)'", u)
        if not (t and img): continue
        parts = html.unescape(alt.group(1)).split(" | ") if alt else []
        caption = parts[1] if len(parts) > 2 else ""
        itags = []
        for p in parts:
            if p.startswith("image tagged in "): itags = [x.strip() for x in p[16:].split(",")]
        yield img.group(1), img.group(2), html.unescape(t.group(2)).strip(), caption.replace(";", " /"), itags

def reddit_feed(sub, period, limit=100):
    rss = get(f"https://www.reddit.com/r/{sub}/top/.rss?t={period}&limit={limit}")
    for e in re.findall(r"<entry>(.*?)</entry>", rss, re.S):
        img = re.findall(r"https://i\.redd\.it/\w+\.(?:jpe?g|png|gif)", e)
        if not img: continue
        title = html.unescape(html.unescape(re.search(r"<title>(.*?)</title>", e, re.S).group(1))).strip()
        link = re.search(r'<link href="([^"]+)"', e).group(1)
        author = re.search(r"<name>(.*?)</name>", e)
        pid = re.search(r"/comments/(\w+)/", link).group(1)
        yield pid, title, link, img[0], author.group(1) if author else "unknown"

def dhash(path, n=16):
    from PIL import Image
    im = Image.open(path).convert("L").resize((n + 1, n))
    px = list(im.getdata())
    return sum(1 << i for i in range(n * n) if px[(i // n) * (n + 1) + i % n] > px[(i // n) * (n + 1) + i % n + 1])

def make_thumbs(memes, size=480):
    """Create small JPEG thumbnails in thumbs/ for fast grid loading (needs Pillow)."""
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not installed; grid will use full images"); return
    os.makedirs(os.path.join(ROOT, "thumbs"), exist_ok=True)
    for m in memes:
        rel = f"thumbs/{m['id']}.jpg"; out = os.path.join(ROOT, rel)
        try:
            if not os.path.exists(out):
                im = Image.open(os.path.join(ROOT, m["image"]))
                m["width"], m["height"] = im.size
                im = im.convert("RGB"); im.thumbnail((size, size * 3))
                im.save(out, "JPEG", quality=82, optimize=True)
            elif not m.get("width"):
                m["width"], m["height"] = Image.open(os.path.join(ROOT, m["image"])).size
            m["thumb"] = rel
        except Exception as e:
            print("thumb failed", m["id"], e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reddit", type=int, default=20, help="max reddit posts to add")
    ap.add_argument("--no-reddit", action="store_true")
    ap.add_argument("--no-imgflip-tags", action="store_true")
    ap.add_argument("--reddit-only", nargs="*", help="only fetch these subreddits")
    ap.add_argument("--more", type=int, default=None,
                    help="add up to K NEW memes per feed (default: just top each feed up to its configured size)")
    a = ap.parse_args()
    os.makedirs(IMG_DIR, exist_ok=True)
    db = json.load(open(DB)) if os.path.exists(DB) else {"categories": CATEGORIES, "memes": []}
    have = {m["id"] for m in db["memes"]}
    seen_tpl = {m.get("template_id") for m in db["memes"]}
    added, problems = 0, []

    hashes = {}
    try:
        for m in db["memes"]:
            if os.path.exists(os.path.join(ROOT, m["image"])): hashes[dhash(os.path.join(ROOT, m["image"]))] = m["id"]
    except ImportError:
        pass
    urls = {m.get("image_url") for m in db["memes"]}

    def add(entry, img_url):
        nonlocal added
        if entry["id"] in have or entry["id"] in EXCLUDE or img_url in urls: return
        text = entry["title"] + " " + entry.get("caption", "")
        if BLOCK_RX.search(text):
            problems.append(f"blocked by filter: {entry['id']} {entry['title'][:50]}"); return
        if CRUDE_RX.search(text): entry["nsfw"] = True
        if entry.get("nsfw") and "nsfw" not in entry["tags"]: entry["tags"].append("nsfw")
        try:
            entry["image"] = download(img_url, entry["id"])
        except Exception as e:
            problems.append(f"{entry['title']}: {e}"); return
        try:
            h = dhash(os.path.join(ROOT, entry["image"]))
            dup = next((v for k, v in hashes.items() if bin(k ^ h).count("1") <= 8), None)
            if dup:
                os.remove(os.path.join(ROOT, entry["image"])); print("  = dup of", dup, "|", entry["title"][:50]); return
            hashes[h] = entry["id"]
        except ImportError:
            pass
        except Exception as e:
            os.remove(os.path.join(ROOT, entry["image"])); problems.append(f"bad image {entry['id']}: {e}"); return
        urls.add(img_url)
        entry.setdefault("date_added", TODAY)
        db["memes"].append(entry); have.add(entry["id"]); added += 1
        print("  +", entry["category"], "|", entry["title"])

    print("Imgflip API top templates...")
    try:
        api = json.loads(get("https://api.imgflip.com/get_memes"))["data"]["memes"]
        for m in api:
            name = html.unescape(m["name"]); cat = categorize(name, m.get("box_count"))
            seen_tpl.add(int(m["id"]))
            add({"id": f"imgflip-{m['id']}-{slug(name)}", "template_id": int(m["id"]), "title": name,
                 "category": cat, "tags": make_tags(name, cat, ["template"]),
                 "source": "Imgflip API", "source_url": f"https://imgflip.com/meme/{m['id']}",
                 "image_url": m["url"], "width": m.get("width"), "height": m.get("height"),
                 "attribution": "Template via Imgflip (imgflip.com)"}, m["url"])
    except Exception as e:
        problems.append(f"Imgflip API: {e}")

    print("Curated spotlight + classic searches...")
    items = list(CURATED)
    for q, title, cat, tags in CLASSIC_QUERIES:
        try: items.append((imgflip_search_first(q), title, cat, tags))
        except Exception as e: problems.append(f"search '{q}': {e}")
        time.sleep(0.3)
    for tid, title, cat, tags in items:
        if tid in seen_tpl: continue
        mid = f"imgflip-{tid}-{slug(title)}"
        if mid in have: continue
        try:
            img, src = imgflip_template_image(tid)
        except Exception as e:
            problems.append(f"{title}: {e}"); continue
        seen_tpl.add(tid)
        add({"id": mid, "template_id": tid, "title": title, "category": cat,
             "tags": list(dict.fromkeys(tags + [cat.split(" ")[0].lower()])),
             "source": "Imgflip", "source_url": src, "image_url": img,
             "attribution": "Template via Imgflip (imgflip.com)"}, img)
        time.sleep(0.3)

    print("Curated captioned memes (Harambe etc.)...")
    for c in CURATED_URLS:
        add({"id": c["id"], "title": c["title"], "category": c["cat"],
             "tags": list(dict.fromkeys(c["tags"] + [c["cat"].split(" ")[0].lower()])),
             "source": c["source"], "source_url": c["src"], "image_url": c["url"], "nsfw": c.get("nsfw", False),
             "attribution": f"Via {c['source']}", "captioned": True}, c["url"])

    if not a.no_imgflip_tags:
        print("Imgflip captioned memes from tag pages...")
        for tag, sort, n, cat, tags in IMGFLIP_TAG_FEEDS:
            existing = sum(1 for m in db["memes"] if m.get("feed") == f"imgflip-tag:{tag}")
            n = a.more if a.more is not None else max(0, n - existing)
            got = 0
            for page in (1, 2, 3):
                if got >= n: break
                try: units = list(imgflip_tag_page(tag, sort, page))
                except Exception as e: problems.append(f"imgflip tag {tag}: {e}"); break
                for iid, ext, title, caption, itags in units:
                    if got >= n: break
                    mid = f"imgflip-i-{iid}"
                    if mid in have or mid in EXCLUDE: continue
                    extra = [t.lower() for t in itags if t.lower() not in ("memes", "funny", "funny memes", "meme", "imgflip")][:3]
                    before = added
                    add({"id": mid, "title": title, "caption": caption, "category": cat, "feed": f"imgflip-tag:{tag}",
                         "tags": list(dict.fromkeys(tags + extra + ["captioned", cat.split(" ")[0].lower()]))[:8],
                         "source": "Imgflip", "source_url": f"https://imgflip.com/i/{iid}",
                         "image_url": f"https://i.imgflip.com/{iid}.{ext}", "captioned": True,
                         "attribution": f"User-made caption on Imgflip (tag: {tag})"}, f"https://i.imgflip.com/{iid}.{ext}")
                    got += added - before
                time.sleep(0.5)

    if not a.no_reddit:
        for sub, period, n, dcat, strong in REDDIT_FEEDS:
            if a.reddit_only and sub not in a.reddit_only: continue
            existing = sum(1 for m in db["memes"] if m.get("feed") == f"reddit:{sub}")
            n = a.more if a.more is not None else max(0, n - existing)
            if n == 0: continue
            print(f"Reddit r/{sub} top of {period} (RSS)...")
            try:
                got = 0
                for pid, title, link, img, author in reddit_feed(sub, period):
                    if got >= n: break
                    mid = f"reddit-{pid}"
                    if mid in have or mid in EXCLUDE: continue
                    rule = next((c for c, rx in REDDIT_RULES if re.search(rx, title.lower())), None)
                    cat = dcat if (strong and dcat) else (rule or dcat or categorize(title))
                    before = added
                    add({"id": mid, "title": title, "category": cat, "feed": f"reddit:{sub}",
                         "tags": make_tags(title, cat, ["reddit", f"r/{sub}"] + SUB_TAGS.get(sub, [])),
                         "source": f"Reddit r/{sub}", "source_url": link, "image_url": img, "captioned": True,
                         "attribution": f"Posted by {author} on r/{sub}"}, img)
                    got += added - before
            except Exception as e:
                problems.append(f"Reddit r/{sub}: {e}")
            time.sleep(8)  # reddit rate-limits RSS hard (429)

    for m in db["memes"]:
        key = str(m.get("template_id") or m["id"].replace("reddit-", ""))
        o = OVERRIDES.get(key)
        if "harambe" in m["title"].lower() and "harambe" not in m["tags"]: m["tags"].insert(0, "harambe")
        if not o: continue
        if o.get("nsfw"): m["nsfw"] = True
        for f in ("category", "title", "tags"):
            if f in o: m[f] = list(o[f]) if f == "tags" else o[f]
        for t in o.get("add_tags", []):
            if t not in m["tags"]: m["tags"].append(t)
    keep = []
    for m in db["memes"]:
        if "feed" not in m:
            t = re.search(r"\(tag: (.+)\)$", m.get("attribution", ""))
            if t: m["feed"] = f"imgflip-tag:{t.group(1)}"
            elif m["id"].startswith("reddit-1") and m["source"].startswith("Reddit r/"): m["feed"] = "reddit:" + m["source"][9:]
        if m.get("template_id") in (150731632, 380031887) or m["id"] in EXCLUDE:  # dupes / pre-captioned / rejected
            for f in (m.get("image"), m.get("thumb")):
                if f and os.path.exists(os.path.join(ROOT, f)): os.remove(os.path.join(ROOT, f))
            continue
        if "nsfw" in m["tags"]: m["nsfw"] = True
        if m.get("nsfw") and "nsfw" not in m["tags"]: m["tags"].append("nsfw")
        keep.append(m)
    db["memes"] = keep
    make_thumbs(db["memes"])
    db["categories"] = CATEGORIES
    db["generated"] = datetime.datetime.now().isoformat(timespec="seconds")
    json.dump(db, open(DB, "w"), indent=2, ensure_ascii=False)
    print(f"\nAdded {added}; total {len(db['memes'])}")
    from collections import Counter
    for c, n in Counter(m["category"] for m in db["memes"]).most_common(): print(f"  {c}: {n}")
    print(f"  (nsfw/crude flagged: {sum(bool(m.get('nsfw')) for m in db['memes'])})")
    if problems: print("Problems:\n  " + "\n  ".join(problems))

if __name__ == "__main__":
    main()
