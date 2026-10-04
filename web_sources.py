"""Search and fetch research sources, using guarded paid fallbacks."""

import threading
import time
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout

try:
    from ddgs import DDGS
except ImportError:
    DDGS = None

try:
    import trafilatura
    from trafilatura.settings import use_config
    _TRAF_CONFIG = use_config()
    _TRAF_CONFIG.set("DEFAULT", "DOWNLOAD_TIMEOUT", "10")
except ImportError:
    trafilatura = None
    _TRAF_CONFIG = None


BLOCKED_DOMAINS = ["facebook.com", "twitter.com", "x.com", "instagram.com",
                   "linkedin.com", "tiktok.com", "pinterest.com", "youtube.com"]

MIN_BALANCE = 100
FIRECRAWL_PER_MINUTE = 8
FETCH_WORKERS = 8
MIN_TEXT = 600
JUNK_PHRASES = ("enable javascript", "enable cookies", "accept cookies", "cookie settings",
                "access denied", "are you a robot", "verify you are human", "captcha",
                "unusual traffic", "checking your browser", "preparing to download",
                "subscribe to continue", "sign in to continue", "403 forbidden", "404 not found")
JUNK_CHECK_BELOW = 2500


class SourcesUnavailable(Exception):
    """Raised when the search libraries are not installed."""


def _blocked(url):
    return any(d in url for d in BLOCKED_DOMAINS)


def _looks_like_pdf(url):
    """Cheap checks only: the extension, then a HEAD request (no download, no credits)."""
    if url.lower().split("?")[0].endswith(".pdf"):
        return True
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return "pdf" in (resp.headers.get("Content-Type") or "").lower()
    except Exception:
        return False


class FirecrawlGuard:
    """
    Decides, page by page, whether a Firecrawl fallback is allowed.

    One instance per research run, so the per-run credit cap resets for the
    next run. Thread-safe: scouts share it from parallel threads.
    """

    def __init__(self, app, credit_cap):
        self.app = app
        self.credit_cap = credit_cap
        self.lock = threading.Lock()
        self.spent = 0
        self.window = deque()
        self.balance = None
        self.disabled_reason = None
        self.log = []
        self._check_balance()

    def _check_balance(self):
        if self.app is None:
            self.disabled_reason = "no Firecrawl client"
            return
        try:
            usage = self.app.get_credit_usage()
            self.balance = getattr(usage, "remaining_credits", None)
            if self.balance is None or self.balance < MIN_BALANCE:
                self.disabled_reason = f"credit balance {self.balance} is below {MIN_BALANCE}"
        except Exception as e:
            self.disabled_reason = f"could not read credit balance ({type(e).__name__})"
        if self.disabled_reason:
            self.log.append("Firecrawl fallback off: " + self.disabled_reason)

    def try_scrape(self, url):
        """Return page markdown via Firecrawl, or None if any guard says no."""
        with self.lock:
            if self.disabled_reason:
                return None
            if self.spent >= self.credit_cap:
                return None
            now = time.monotonic()
            while self.window and self.window[0] < now - 60:
                self.window.popleft()
            if len(self.window) >= FIRECRAWL_PER_MINUTE:
                return None
            self.window.append(now)
            self.spent += 1
        if _looks_like_pdf(url):
            with self.lock:
                self.spent -= 1
                self.log.append(f"skipped PDF (would cost a credit per page): {url}")
            return None
        try:
            doc = self.app.scrape_url(url, formats=["markdown"])
            text = doc.markdown or ""
            with self.lock:
                self.log.append(f"firecrawl fallback used: {url}")
            return text
        except Exception as e:
            with self.lock:
                self.log.append(f"firecrawl fallback failed for {url}: {type(e).__name__}: {str(e)[:120]}")
                if "Payment" in type(e).__name__ or "Insufficient credits" in str(e):
                    self.disabled_reason = "out of credits"
            return None
ENGINES = ["brave", "duckduckgo", "bing", "yahoo"]
LAST_RESORT_ENGINES = ["yandex"]
MAX_PARALLEL_SEARCHES = 3
FETCH_BUDGET_SECONDS = 20

_search_gate = threading.Semaphore(MAX_PARALLEL_SEARCHES)
_rotation = [0]
_rotation_lock = threading.Lock()


def search(query, max_results=10, retries=1):
    """
    Web search through the ddgs library. Returns (results, error) where
    results = [{"url", "title", "snippet"}] and error is None on success.

    Each call starts with the next engine in rotation (so parallel scouts do
    not all hammer one engine) and falls through the rest on failure. If every
    engine fails, it waits briefly and tries the whole chain once more.
    Measured under deep-mode load: 7 parallel searches, 5 answered in ~1.5s,
    1 fell over to bing, 1 failed on every engine -- hence the retry round.
    """
    if DDGS is None:
        raise SourcesUnavailable("The 'ddgs' package is not installed (pip install ddgs).")
    with _rotation_lock:
        first = _rotation[0] % len(ENGINES)
        _rotation[0] += 1
    order = ENGINES[first:] + ENGINES[:first] + LAST_RESORT_ENGINES

    errors = []
    with _search_gate:
        for attempt in range(retries + 1):
            for engine in order:
                try:
                    hits = DDGS().text(query, max_results=max_results, backend=engine) or []
                except Exception as e:
                    errors.append(f"{engine}: {type(e).__name__}")
                    continue
                out = []
                for h in hits:
                    url = h.get("href") or h.get("url") or ""
                    if url and not _blocked(url):
                        out.append({"url": url, "title": (h.get("title") or "").strip(),
                                    "snippet": (h.get("body") or "").strip()})
                if out:
                    return out, None
                errors.append(f"{engine}: no results")
            if attempt < retries:
                time.sleep(1.5)
    return [], "all search engines failed (" + ", ".join(errors[-6:]) + ")"


def is_real_content(text):
    """True for an actual article; False for empty pages, cookie walls and bot checks."""
    if not text or len(text) < MIN_TEXT:
        return False
    if len(text) < JUNK_CHECK_BELOW:
        low = text.lower()
        if any(p in low for p in JUNK_PHRASES):
            return False
    return True


def fetch_text(url):
    """Download a page directly and extract its readable text. Free. None on failure."""
    if trafilatura is None:
        raise SourcesUnavailable("The 'trafilatura' package is not installed (pip install trafilatura).")
    try:
        html = trafilatura.fetch_url(url, config=_TRAF_CONFIG)
        if not html:
            return None
        text = trafilatura.extract(html, include_comments=False, include_tables=True, config=_TRAF_CONFIG)
        return text if is_real_content(text) else None
    except Exception:
        return None


def gather(query, want, guard=None, on_page=None, scholarly=False):
    """
    Find up to `want` readable pages for a search query.

    Searches for about twice as many results as needed (roughly half of sites
    block direct downloads), fetches them in parallel, and uses the Firecrawl
    guard for blocked pages. Returns as soon as `want` pages are readable.

    on_page(done, total, url, ok) is called as each page finishes, so the UI
    can show real reading progress.

    scholarly=True also rescues blocked publisher pages through their DOI
    (free Europe PMC abstract) before any Firecrawl credit is considered.

    Returns (pages, problems) where pages = [{"url", "title", "text", "via"}].
    """
    problems = []
    hits, err = search(query, max_results=max(want * 2, 8))
    if err:
        problems.append(f"search failed for {query!r}: {err}")
    if not hits:
        return [], problems
    pages, fetch_problems = _fetch_hits(hits, want, guard, on_page, scholarly=scholarly)
    return pages, problems + fetch_problems


def gather_urls(urls, want, guard=None, on_page=None):
    """Like gather(), for a list of URLs you already have (normal mode searches first)."""
    hits = [{"url": u, "title": ""} for u in urls if u and not _blocked(u)]
    if not hits:
        return [], []
    return _fetch_hits(hits, want, guard, on_page)


def _fetch_hits(hits, want, guard, on_page, budget=FETCH_BUDGET_SECONDS, scholarly=False):
    """
    Fetch pages in parallel and return AS SOON AS `want` are readable.

    The first version only stopped *starting* new downloads once it had
    enough, then still waited for every download already in flight -- one slow
    site held a scout for 40s (measured). Now we collect results as they
    finish, stop listening once we have enough or the time budget runs out,
    and let any stragglers finish in the background, ignored.
    """
    problems = []
    results = [None] * len(hits)
    enough = threading.Event()

    def fetch_one(i):
        hit = hits[i]
        text = fetch_text(hit["url"])
        if text:
            return text, "direct"
        if scholarly:
            rescued = doi_abstract(hit["url"])
            if rescued:
                if not hit["title"]:
                    hit["title"] = rescued["title"]
                return rescued["text"], rescued["via"]
        if guard is not None and not enough.is_set():
            text = guard.try_scrape(hit["url"])
            if is_real_content(text):
                return text, "firecrawl"
        return None, None

    ex = ThreadPoolExecutor(max_workers=min(FETCH_WORKERS, len(hits)))
    futures = {ex.submit(fetch_one, i): i for i in range(len(hits))}
    done = 0
    try:
        for fut in as_completed(futures, timeout=budget):
            i = futures[fut]
            try:
                text, via = fut.result()
            except Exception as e:
                text, via = None, None
                problems.append(f"fetch error {hits[i]['url']}: {type(e).__name__}")
            done += 1
            if text:
                results[i] = {"url": hits[i]["url"], "title": hits[i]["title"], "text": text, "via": via}
            else:
                problems.append(f"unreadable: {hits[i]['url']}")
            if on_page:
                on_page(done, len(hits), hits[i]["url"], bool(text))
            if sum(1 for r in results if r) >= want:
                enough.set()
                break
    except FuturesTimeout:
        problems.append(f"fetch budget of {budget:.0f}s reached with {done}/{len(hits)} pages finished")
    finally:
        enough.set()
        ex.shutdown(wait=False, cancel_futures=True)
    pages = [r for r in results if r][:want]
    return pages, problems

import json as _json
import re as _re
import urllib.parse as _urlparse

EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"
EPMC_HEADERS = {"User-Agent": "ResearchGuild/1.0 (personal research tool)"}
_epmc_gate = threading.Semaphore(4)

_STOP = set("the a an and or of in on for to with by from is are was were be how what why "
            "which who does do their its this that these those human humans effect effects".split())


def _terms(text):
    return {w for w in _re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 3 and w not in _STOP}


def _epmc_get(path, timeout=20):
    with _epmc_gate:
        req = urllib.request.Request(EPMC_BASE + path, headers=EPMC_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")


def _strip_xml(xml):
    text = _re.sub(r"<[^>]+>", " ", xml)
    return _re.sub(r"\s+", " ", text).strip()


def _relevant(question, title, abstract):
    """
    A paper counts as relevant only if BOTH hold:
      - at least half of the question's key words (minimum 2) appear in its
        title or abstract, and
      - at least one of them appears in the title itself.
    The first version needed just 2 matching words, and a finance question
    matched "Paracetamol in pregnancy" on generic words (caused, crisis,
    failures). Requiring a title match stops abstract-only coincidences.
    """
    q = _terms(question)
    if not q:
        return False
    needed = max(2, (len(q) + 1) // 2)
    return len(q & _terms(f"{title} {abstract}")) >= needed and bool(q & _terms(title))


def europepmc_papers(question, want=2, budget=15.0):
    """
    Open-access papers relevant to `question`: full text where available,
    otherwise the abstract. Returns (pages, problems) in the same shape as
    gather(): [{"url", "title", "text", "via"}].
    """
    problems = []
    query = f"({question}) AND OPEN_ACCESS:y"
    try:
        data = _json.loads(_epmc_get(
            f"/search?query={_urlparse.quote(query)}&format=json&resultType=core&pageSize={want * 4}"))
        rows = data.get("resultList", {}).get("result", [])
    except Exception as e:
        return [], [f"europepmc search failed: {type(e).__name__}: {str(e)[:120]}"]

    candidates = []
    for r in rows:
        title = r.get("title") or ""
        abstract = _strip_xml(r.get("abstractText") or "")
        if not _relevant(question, title, abstract):
            continue
        pmcid = r.get("pmcid")
        url = (f"https://europepmc.org/article/PMC/{pmcid}" if pmcid
               else f"https://doi.org/{r['doi']}" if r.get("doi") else None)
        if url:
            candidates.append({"pmcid": pmcid, "title": title, "abstract": abstract, "url": url,
                               "year": r.get("pubYear")})
        if len(candidates) >= want:
            break

    def full(c):
        if c["pmcid"]:
            try:
                xml = _epmc_get(f"/{c['pmcid']}/fullTextXML")
                body = _strip_xml(xml.split("<body>", 1)[1]) if "<body>" in xml else ""
                if is_real_content(body):
                    return {"url": c["url"], "title": c["title"], "text": body, "via": "europepmc-fulltext"}
            except Exception as e:
                problems.append(f"europepmc full text failed for {c['pmcid']}: {type(e).__name__}")
        if is_real_content(c["abstract"]):
            return {"url": c["url"], "title": c["title"], "text": c["abstract"], "via": "europepmc-abstract"}
        return None

    pages = []
    finished = set()
    if candidates:
        ex = ThreadPoolExecutor(max_workers=min(4, len(candidates)))
        futures = {ex.submit(full, c): i for i, c in enumerate(candidates)}
        try:
            for fut in as_completed(futures, timeout=budget):
                finished.add(futures[fut])
                page = fut.result()
                if page:
                    pages.append(page)
        except FuturesTimeout:
            problems.append(f"europepmc budget of {budget:.0f}s reached; using abstracts for the rest")
            for i, c in enumerate(candidates):
                if i not in finished and is_real_content(c["abstract"]):
                    pages.append({"url": c["url"], "title": c["title"], "text": c["abstract"],
                                  "via": "europepmc-abstract"})
        finally:
            ex.shutdown(wait=False, cancel_futures=True)
    return pages[:want], problems


_DOI_RE = _re.compile(r"(10\.\d{4,9}/[^\s?#]+)")


def doi_abstract(url):
    """
    Rescue a paper whose publisher page blocked us: if its URL contains a DOI,
    look up the abstract on Europe PMC. Returns a page dict or None.
    """
    m = _DOI_RE.search(_urlparse.unquote(url or ""))
    if not m:
        return None
    doi = m.group(1).rstrip(".,;)")
    for suffix in ("/full", "/abstract", "/pdf", "/epdf"):
        if doi.endswith(suffix):
            doi = doi[: -len(suffix)]
    try:
        data = _json.loads(_epmc_get(
            f"/search?query={_urlparse.quote('DOI:' + chr(34) + doi + chr(34))}&format=json&resultType=core&pageSize=1",
            timeout=10))
        rows = data.get("resultList", {}).get("result", [])
    except Exception:
        return None
    if not rows:
        return None
    abstract = _strip_xml(rows[0].get("abstractText") or "")
    if not is_real_content(abstract):
        return None
    return {"url": url, "title": rows[0].get("title") or "", "text": abstract, "via": "europepmc-doi-abstract"}
