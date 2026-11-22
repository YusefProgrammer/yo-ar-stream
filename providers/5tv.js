/**
 * 5TV - Nuvio JS Provider
 * Ported from CloudStream Kotlin (FiveTVProvider).
 * Clean HTML scraping, no Cloudflare, no API keys.
 * Handles: movies, series, multiple servers per page, Dean Edwards unpacker.
 */

var BASE_URL = "https://new61.5tv.lol";
var TMDB_KEY = "6c91e91ec97e117e446a62f4d2ace9b7";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function log() { var a = Array.prototype.slice.call(arguments); try { console.log.apply(console, ["[5TV]"].concat(a)); } catch(e){} }
function fixUrl(u, b) { if (!u) return ""; var s = String(u).trim(); if (s.indexOf("http")===0) return s; if (s.indexOf("//")===0) return "https:"+s; if (s.indexOf("/")===0) return b+s; return b+"/"+s; }
function getBaseUrl(u) { var m = String(u).match(/^(https?:\/\/[^\/]+)/); return m?m[1]:BASE_URL; }
function unescapeHtml(t) {
  return String(t||"")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\"/g, '"').replace(/\\'/g, "'");
}
function cleanUrl(u) {
  var s = String(u||"").replace(/\\\//g, "/");
  s = unescapeHtml(s);
  s = s.split('"')[0].split("'")[0].split("<")[0].split(">")[0].split(",")[0].split("\\")[0];
  return s.trim();
}

/* ---------------- HTTP ---------------- */

function fetchHtml(url, referer) {
  var h = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar-EG,ar;q=0.9" };
  h["Referer"] = referer || BASE_URL + "/";
  return fetch(url, { headers: h })
    .then(function(r){ if (!r.ok) throw new Error("HTTP "+r.status); return r.text(); })
    .catch(function(e){ log("fetch error:", url, e.message); return null; });
}

/* ---------------- TMDB ---------------- */

function tmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&append_to_response=translations,alternative_titles";
  return fetch(url).then(function(r){ return r.json(); })
    .then(function(d){
      var titles = [];
      var push = function(t){ if (t && titles.indexOf(t) === -1 && String(t).trim()) titles.push(String(t).trim()); };
      push(d.title); push(d.name); push(d.original_title); push(d.original_name);
      if (d.translations && d.translations.translations) {
        d.translations.translations.forEach(function(tr){ if (tr.iso_639_1 === "ar" && tr.data) { push(tr.data.title); push(tr.data.name); } });
      }
      return { titles: titles, year: (d.release_date || d.first_air_date || "").split("-")[0] || null };
    })
    .catch(function(e){ log("TMDB error:", e.message); return { titles: [], year: null }; });
}

/* ---------------- Dean Edwards Unpacker ---------------- */

function unpackDeanEdwards(scriptText) {
  try {
    var splitIdx = scriptText.lastIndexOf(".split('|')");
    if (splitIdx === -1) splitIdx = scriptText.lastIndexOf('.split("|")');
    if (splitIdx === -1) return "";

    var sub = scriptText.substring(0, splitIdx);
    var paramRe = /,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]/g;
    var matches = []; var m;
    while ((m = paramRe.exec(sub)) !== null) {
      matches.push({ a: parseInt(m[1],10), c: parseInt(m[2],10), start: m.index, end: paramRe.lastIndex });
    }
    if (!matches.length) return "";
    var last = matches[matches.length - 1];
    var a = last.a, c = last.c;
    var kStr = sub.substring(last.end);
    var k = kStr.split("|");

    var lastBrace = sub.lastIndexOf("}", last.start);
    if (lastBrace === -1) return "";
    var pStart = sub.indexOf("'", lastBrace);
    if (pStart === -1 || pStart > last.start) pStart = sub.indexOf('"', lastBrace);
    if (pStart === -1) return "";
    var p = sub.substring(pStart + 1, last.start).replace(/['"]$/, "");

    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    function toBase(num, base) {
      if (num === 0) return "0";
      var n = num, out = "";
      while (n > 0) { out = chars[n % base] + out; n = Math.floor(n / base); }
      return out || "0";
    }
    var lookup = {};
    for (var i = 0; i < c; i++) {
      var key = toBase(i, a);
      lookup[key] = (i < k.length && k[i]) ? k[i] : key;
    }
    return p.replace(/\b\w+\b/g, function(w){ return lookup[w] !== undefined ? lookup[w] : w; });
  } catch (e) { return ""; }
}

/* ---------------- Search ---------------- */

function search5tv(query) {
  var url = BASE_URL + "/search/?q=" + encodeURIComponent(query);
  log("Search:", url);
  return fetchHtml(url).then(function(html){
    if (!html) return [];
    var results = [], seen = {};

    // Try search grid first
    var gridMatch = html.match(/<div[^>]*class=["'][^"']*ftv-search-grid[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    var scope = gridMatch ? gridMatch[1] : html;

    // Parse articles
    var articleRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = articleRe.exec(scope)) !== null) {
      var block = m[1];
      // Title
      var tm = block.match(/<[^>]*class=["'][^"']*(?:ftv-home-poster-card__title|ftv-home-episode-card__title)[^"']*["'][^>]*>([\s\S]*?)<\//i)
        || block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      if (!tm) continue;
      var title = tm[1].replace(/<[^>]+>/g, "").trim();
      if (!title) continue;

      // URL
      var um = block.match(/<a[^>]+href=["']([^"']+)["']/i);
      if (!um) continue;
      var href = fixUrl(um[1], BASE_URL);
      if (seen[href]) continue;
      seen[href] = true;

      // Poster
      var pm = block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
      var poster = pm ? fixUrl(pm[1], BASE_URL) : "";

      // Is series?
      var isSeries = /\/series\//.test(href) || /مسلسل|حلقة|الحلقة/i.test(title);
      var isEpisodeLink = /\/episode\//.test(href);

      results.push({
        url: href,
        title: title,
        poster: poster,
        isSeries: isSeries,
        isEpisode: isEpisodeLink
      });
    }
    log("Search results:", results.length);
    return results;
  });
}

/* ---------------- Detail parsing ---------------- */

function parseDetailPage(html, pageUrl) {
  if (!html) return null;
  var titleM = html.match(/<h1[^>]*class=["'][^"']*ftv-content-hero__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  var title = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "";
  var posterM = html.match(/<div[^>]*class=["'][^"']*ftv-content-hero__poster[^"']*["'][^>]*>[\s\S]*?<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
  var poster = posterM ? fixUrl(posterM[1], BASE_URL) : "";
  var isMovie = /\/movie\//.test(pageUrl);
  return { title: title, poster: poster, isMovie: isMovie, html: html };
}

/* ---------------- Episode extraction ---------------- */

function extractEpisodes(html, pageUrl) {
  if (!html) return [];
  var episodes = [];
  var seen = {};

  // Pattern: .ftv-series-episodes-grid .ftv-episode-completion-item
  var itemRe = /<div[^>]*class=["'][^"']*ftv-(?:series-)?episode-completion-item[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  var m;
  while ((m = itemRe.exec(html)) !== null) {
    var block = m[1];
    var hrefM = block.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (!hrefM) continue;
    var epUrl = fixUrl(hrefM[1], BASE_URL);
    if (seen[epUrl]) continue;
    seen[epUrl] = true;

    var titleM = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var epTitle = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "حلقة";
    var numM = epTitle.match(/\d+/);
    var epNum = numM ? parseInt(numM[0], 10) : null;

    episodes.push({ url: epUrl, name: epTitle, episode: epNum, season: 1 });
  }

  // Fallback: any link that looks like an episode
  if (episodes.length === 0) {
    var linkRe = /<a[^>]+href=["']([^"']*\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = linkRe.exec(html)) !== null) {
      var eUrl = fixUrl(m[1], BASE_URL);
      if (seen[eUrl]) continue;
      seen[eUrl] = true;
      var txt = m[2].replace(/<[^>]+>/g, "").trim();
      var n = txt.match(/\d+/);
      episodes.push({ url: eUrl, name: txt || "حلقة", episode: n ? parseInt(n[0],10) : null, season: 1 });
    }
  }

  episodes.sort(function(a,b){ return (a.episode||0) - (b.episode||0); });
  log("Episodes found:", episodes.length);
  return episodes;
}

/* ---------------- Server extraction (multi-server) ---------------- */

function extractServerTargets(html, pageUrl) {
  if (!html) return [];
  var targets = [];
  var seen = {};

  // 1. Direct player iframe
  var piM = html.match(/<[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<iframe[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (piM && piM[1]) {
    var pu = fixUrl(piM[1], BASE_URL);
    if (!seen[pu]) { seen[pu] = true; targets.push({ name: "Direct Player", url: pu, isDownload: false }); }
  }

  // 2. Server tabs (data-server-url)
  var tabRe = /<button[^>]+data-server-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
  var m;
  while ((m = tabRe.exec(html)) !== null) {
    var sUrl = fixUrl(m[1], BASE_URL);
    if (seen[sUrl]) continue;
    seen[sUrl] = true;
    var nm = m[2].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var name = nm ? nm[1].replace(/<[^>]+>/g, "").trim() : ("Server " + (targets.length+1));
    targets.push({ name: name, url: sUrl, isDownload: false });
  }

  // 3. Download list
  var dlRe = /<article[^>]*class=["'][^"']*ftv-download-server[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  while ((m = dlRe.exec(html)) !== null) {
    var block = m[1];
    var aM = block.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (!aM) continue;
    var dUrl = fixUrl(aM[1], BASE_URL);
    if (seen[dUrl]) continue;
    seen[dUrl] = true;
    var sM = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var dName = sM ? sM[1].replace(/<[^>]+>/g, "").trim() : "Download";
    targets.push({ name: dName, url: dUrl, isDownload: true });
  }

  log("Server targets:", targets.length, targets.map(function(t){ return t.name; }).join(" | "));
  return targets;
}

/* ---------------- Resolve a server to direct URLs ---------------- */

function resolveServer(target, pageReferer) {
  var serverUrl = target.url;
  // dsvplay -> playmogo replacement (from Kotlin)
  if (serverUrl.indexOf("dsvplay.com") !== -1) {
    serverUrl = serverUrl.replace("dsvplay.com", "playmogo.com");
  }

  var domain = getBaseUrl(serverUrl) + "/";

  return fetchHtml(serverUrl, pageReferer).then(function(content){
    if (!content) return [];
    content = unescapeHtml(content);

    if (content.indexOf("eval(function(p,a,c,k") !== -1) {
      var unpacked = unpackDeanEdwards(content);
      if (unpacked) content += "\n" + unescapeHtml(unpacked);
    }

    var matches = [], seenUrls = {};
    function add(u) {
      var c = cleanUrl(u);
      if (c.length > 20 && !seenUrls[c] && c !== serverUrl) {
        seenUrls[c] = true;
        matches.push(c);
      }
    }

    // Extract URLs
    var m3u8Re = /(https?:[\\/]+[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
    var mm;
    while ((mm = m3u8Re.exec(content)) !== null) add(mm[1]);

    var r2Re = /(https?:[\\/]+[^\s"'<>]+cloudflarestorage[^\s"'<>]*)/gi;
    while ((mm = r2Re.exec(content)) !== null) add(mm[1]);

    var mp4Re = /(https?:[\\/]+[^\s"'<>]+\.(?:mp4|mkv)[^\s"'<>]*)/gi;
    while ((mm = mp4Re.exec(content)) !== null) add(mm[1]);

    var fileRe = /["']?file["']?\s*:\s*["']([^"']+)["']/gi;
    while ((mm = fileRe.exec(content)) !== null) {
      if (mm[1].indexOf("http") === 0) add(mm[1]);
    }

    // For download targets, also scan anchor hrefs
    if (target.isDownload) {
      var anchorRe = /<a[^>]+href=["']([^"']+)["']/gi;
      while ((mm = anchorRe.exec(content)) !== null) {
        if (/\.(mp4|mkv|m3u8)(\?|$)/i.test(mm[1])) add(mm[1]);
      }
    }

    if (matches.length === 0) return [];

    // Verify headers (without referer first, then with)
    var verifyPromises = matches.map(function(vUrl){
      return verifyUrl(vUrl, domain).then(function(headers){
        if (headers === null) return null;
        return { url: vUrl, headers: headers };
      });
    });

    return Promise.all(verifyPromises).then(function(results){
      var out = [];
      results.forEach(function(r){ if (r) out.push(r); });
      return out.map(function(r){
        return {
          url: r.url,
          headers: r.headers,
          quality: "1080p",
          label: target.name
        };
      });
    });
  });
}

/* ---------------- Verify URL & pick working headers ---------------- */

function verifyUrl(videoUrl, domain) {
  var hNoRef = { "User-Agent": UA, "Range": "bytes=0-1" };
  var hWithRef = { "User-Agent": UA, "Referer": domain, "Origin": domain.replace(/\/$/, ""), "Range": "bytes=0-1" };

  // Try without referer first
  return fetch(videoUrl, { headers: hNoRef })
    .then(function(r){
      if (r.status >= 200 && r.status < 300) return {};
      throw new Error("need referer");
    })
    .catch(function(){
      // Try with referer
      return fetch(videoUrl, { headers: hWithRef })
        .then(function(r){
          if (r.status >= 200 && r.status < 300) return { "Referer": domain, "Origin": domain.replace(/\/$/, "") };
          return null;
        })
        .catch(function(){ return null; });
    });
}

/* ---------------- Get all streams from a page ---------------- */

function getAllStreams(pageUrl) {
  return fetchHtml(pageUrl).then(function(html){
    if (!html) return [];
    var targets = extractServerTargets(html, pageUrl);
    if (targets.length === 0) return [];
    var promises = targets.map(function(t){
      return resolveServer(t, pageUrl).catch(function(e){ log(t.name, "failed:", e.message); return []; });
    });
    return Promise.all(promises).then(function(arrays){
      var flat = [], seen = {};
      arrays.forEach(function(arr){
        (arr || []).forEach(function(s){
          if (s.url && !seen[s.url]) { seen[s.url] = true; flat.push(s); }
        });
      });
      return flat;
    });
  });
}

/* ---------------- Main ---------------- */

function getStreams(tmdbId, mediaType, season, episode) {
  log("=== START:", tmdbId, mediaType, "S"+season, "E"+episode);
  var isMovie = mediaType === "movie";

  return tmdbInfo(tmdbId, mediaType).then(function(info){
    if (!info.titles.length) { log("No titles"); return []; }
    log("Titles:", info.titles.join(" | "));

    // Try first 2 titles
    return Promise.all(info.titles.slice(0, 2).map(search5tv)).then(function(arrs){
      var results = [], seen = {};
      arrs.forEach(function(arr){ (arr||[]).forEach(function(r){ if (!seen[r.url]) { seen[r.url]=true; results.push(r); } }); });

      if (!results.length) { log("No results"); return []; }

      // Pick best match
      var wanted = info.titles.map(function(t){ return t.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ""); });
      var best = null, bestScore = 0;
      results.forEach(function(r){
        var norm = r.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
        var score = 0;
        for (var i = 0; i < wanted.length; i++) {
          if (norm === wanted[i]) { score = 3000; break; }
          if (norm.indexOf(wanted[i]) !== -1) score = Math.max(score, 2000);
        }
        if (isMovie && r.isSeries) score -= 300;
        if (!isMovie && !r.isSeries && !r.isEpisode) score -= 300;
        if (score > bestScore) { bestScore = score; best = r; }
      });

      if (!bestScore) best = results[0];
      log("Selected:", best.title, best.url, "series:", best.isSeries);

      // Movie: extract streams directly
      if (isMovie || (!best.isSeries && !best.isEpisode)) {
        return getAllStreams(best.url);
      }

      // Episode link directly: fetch episode page
      if (best.isEpisode) {
        return getAllStreams(best.url);
      }

      // Series: need to find episode
      return fetchHtml(best.url).then(function(seriesHtml){
        if (!seriesHtml) return [];
        var eps = extractEpisodes(seriesHtml, best.url);
        if (!eps.length) { log("No episodes"); return []; }
        var wantE = parseInt(episode, 10) || 1;
        var target = null;
        for (var i = 0; i < eps.length; i++) {
          if (eps[i].episode === wantE) { target = eps[i]; break; }
        }
        if (!target) target = eps[Math.min(wantE - 1, eps.length - 1)];
        if (!target) return [];
        log("Episode:", target.name, target.url);
        return getAllStreams(target.url);
      });
    });
  }).then(function(streams){
    if (!streams || !streams.length) { log("No streams"); return []; }
    var final = [], seen = {};
    streams.forEach(function(s){
      if (!s.url || seen[s.url]) return;
      seen[s.url] = true;
      var isHls = s.url.indexOf(".m3u8") !== -1;
      final.push({
        name: "5TV - " + (s.label || s.quality || "HD"),
        title: "5TV \u2022 " + (s.label || "Server") + " (" + (isHls ? "HLS" : "MP4") + ")",
        url: s.url,
        quality: s.quality || "1080p",
        provider: "fivetv",
        headers: Object.assign({ "User-Agent": UA }, s.headers || {}),
        type: isHls ? "hls" : "mp4"
      });
    });
    log("=== FINAL STREAMS:", final.length);
    return final;
  }).catch(function(err){ log("FATAL:", err && err.message); return []; });
}

module.exports = { getStreams: getStreams };