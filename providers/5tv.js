/**
 * 5TV - Nuvio JS Provider (Episode Selection FIXED)
 */

var BASE_URL = "https://new61.5tv.lol";
var TMDB_KEY = "6c91e91ec97e117e446a62f4d2ace9b7";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function log() { var a = Array.prototype.slice.call(arguments); try { console.log.apply(console, ["[5TV]"].concat(a)); } catch(e){} }
function fixUrl(u, b) { if (!u) return ""; var s = String(u).trim(); if (s.indexOf("http")===0) return s; if (s.indexOf("//")===0) return "https:"+s; if (s.indexOf("/")===0) return b+s; return b+"/"+s; }
function getBaseUrl(u) { var m = String(u).match(/^(https?:\/\/[^\/]+)/); return m?m[1]:BASE_URL; }
function unescapeHtml(t) {
  return String(t||"").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#160;/g, " ")
    .replace(/\\"/g, '"').replace(/\\'/g, "'");
}
function cleanUrl(u) {
  var s = String(u||"").replace(/\\\//g, "/"); s = unescapeHtml(s);
  s = s.split('"')[0].split("'")[0].split("<")[0].split(">")[0].split(",")[0].split("\\")[0];
  return s.trim();
}

/* ---------------- Episode number extraction (AGGRESSIVE) ---------------- */

function extractEpisodeNum(text, url) {
  var t = unescapeHtml(String(text || ""));
  var u = String(url || "");
  var combo = t + " ||| " + u;

  // Priority 1: Arabic / English keywords followed by number
  var patterns = [
    /الحلقة\s*0*(\d{1,4})(?!\d)/i,
    /حلقة\s*0*(\d{1,4})(?!\d)/i,
    /episode\s*0*(\d{1,4})(?!\d)/i,
    /ep\.?\s*0*(\d{1,4})(?!\d)/i,
    /s\d{1,2}e0*(\d{1,4})(?!\d)/i,
    /\d{1,2}x0*(\d{1,4})(?!\d)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = combo.match(patterns[i]);
    if (m) { var n = parseInt(m[1], 10); if (!isNaN(n)) return n; }
  }

  // Priority 2: URL with /episode/ — take the LAST number in the slug
  if (u.indexOf("/episode/") !== -1 || u.indexOf("/ep-") !== -1) {
    // Get the part after /episode/ (up to next / or end)
    var slugMatch = u.match(/\/(?:episode|ep)[\/_-]([^\/?#]+)/i);
    var slug = slugMatch ? slugMatch[1] : u;
    // Find all numbers in slug, take the last
    var nums = slug.match(/\d{1,4}/g);
    if (nums && nums.length > 0) {
      // Filter out years (1900-2099) if there's another number
      var nonYear = nums.filter(function(x){ var v = parseInt(x,10); return v < 1900 || v > 2099; });
      var pick = nonYear.length > 0 ? nonYear[nonYear.length - 1] : nums[nums.length - 1];
      return parseInt(pick, 10);
    }
  }

  return null;
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

/* ---------------- Search ---------------- */

function search5tv(query) {
  var url = BASE_URL + "/search/?q=" + encodeURIComponent(query);
  log("SEARCH URL:", url);
  return fetchHtml(url).then(function(html){
    if (!html) return [];
    var results = [], seen = {};

    // Find all articles (search result cards)
    var articleRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = articleRe.exec(html)) !== null) {
      var block = m[1];

      // Title
      var tm = block.match(/<[^>]*class=["'][^"']*(?:ftv-home-poster-card__title|ftv-home-episode-card__title|ftv-search-card__title)[^"']*["'][^>]*>([\s\S]*?)<\//i)
        || block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      if (!tm) continue;
      var title = unescapeHtml(tm[1].replace(/<[^>]+>/g, "")).trim();
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

      // Classify
      var isMovieUrl = /\/movie\//.test(href);
      var isEpisodeUrl = /\/episode\//.test(href) || /\/ep[-_\/]/.test(href);
      var isSeriesUrl = /\/series\//.test(href);
      var hasEpWord = /الحلقة|حلقة|episode|ep\.?\s*\d/i.test(title);
      var epNum = extractEpisodeNum(title, href);

      // If URL has /episode/ OR title has episode word OR title has E3 pattern
      var isEpisode = isEpisodeUrl || hasEpWord || (epNum !== null && /s\d+e\d+|\d+x\d+/i.test(title));
      var isSeries = (isSeriesUrl || /مسلسل/i.test(title)) && !isMovieUrl && !isEpisodeUrl;

      results.push({
        url: href, title: title, poster: poster,
        isMovie: isMovieUrl, isSeries: isSeries, isEpisode: isEpisode,
        episodeNum: epNum
      });
    }

    log("SEARCH RESULTS:", results.length);
    results.forEach(function(r, i){
      log("  [" + i + "]", r.title, "| URL:", r.url,
          "| movie:", r.isMovie, "| series:", r.isSeries, "| ep:", r.isEpisode, "| num:", r.episodeNum);
    });
    return results;
  });
}

/* ---------------- Extract episodes from series page ---------------- */

function extractEpisodes(html, pageUrl) {
  if (!html) return [];
  var episodes = [], seen = {};
  var m;

  // PRIMARY: find ALL anchors pointing to /episode/
  var linkRe = /<a\b[^>]*?href=["']([^"']*(?:\/episode\/|\/ep[-_\/])[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    var eUrl = fixUrl(m[1], BASE_URL);
    if (seen[eUrl]) continue;
    seen[eUrl] = true;

    var inner = m[2];
    // Title from <strong> or text
    var tM = inner.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var txt = tM ? tM[1] : inner;
    txt = unescapeHtml(txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();

    var num = extractEpisodeNum(txt, eUrl);
    episodes.push({ url: eUrl, name: txt || "حلقة", episode: num, season: 1 });
  }

  // FALLBACK: any anchor whose text has "الحلقة N"
  if (episodes.length === 0) {
    var anyRe = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = anyRe.exec(html)) !== null) {
      var aUrl = fixUrl(m[1], BASE_URL);
      var aTxt = unescapeHtml(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
      if (!/الحلقة|حلقة|episode|ep\.?\s*\d/i.test(aTxt)) continue;
      if (seen[aUrl]) continue;
      seen[aUrl] = true;
      var an = extractEpisodeNum(aTxt, aUrl);
      episodes.push({ url: aUrl, name: aTxt, episode: an, season: 1 });
    }
  }

  // Dedupe by episode number (keep first occurrence of each)
  var byNum = {}, final = [];
  episodes.forEach(function(e){
    if (e.episode != null) {
      if (!byNum[e.episode]) { byNum[e.episode] = 1; final.push(e); }
    } else {
      final.push(e); // keep unknown-number episodes as-is
    }
  });

  final.sort(function(a,b){
    var ea = (a.episode == null ? 9999 : a.episode);
    var eb = (b.episode == null ? 9999 : b.episode);
    return ea - eb;
  });

  log("EXTRACTED EPISODES:", final.length);
  final.slice(0, 10).forEach(function(e, i){
    log("  EP[" + i + "]", "E" + e.episode, "|", e.name.substring(0, 50), "|", e.url);
  });
  return final;
}

/* ---------------- Server extraction ---------------- */

function extractServerTargets(html, pageUrl) {
  if (!html) return [];
  var targets = [], seen = {};
  var m;

  var piM = html.match(/<[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<iframe[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (piM && piM[1]) {
    var pu = fixUrl(piM[1], BASE_URL);
    if (!seen[pu]) { seen[pu] = true; targets.push({ name: "Direct Player", url: pu, isDownload: false }); }
  }

  var tabRe = /<button[^>]+data-server-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
  while ((m = tabRe.exec(html)) !== null) {
    var sUrl = fixUrl(m[1], BASE_URL);
    if (seen[sUrl]) continue;
    seen[sUrl] = true;
    var nm = m[2].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var name = nm ? nm[1].replace(/<[^>]+>/g, "").trim() : ("Server " + (targets.length+1));
    targets.push({ name: name, url: sUrl, isDownload: false });
  }

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

  log("SERVER TARGETS:", targets.length, targets.map(function(t){ return t.name; }).join(" | "));
  return targets;
}

function unpackDeanEdwards(scriptText) {
  try {
    var splitIdx = scriptText.lastIndexOf(".split('|')");
    if (splitIdx === -1) splitIdx = scriptText.lastIndexOf('.split("|")');
    if (splitIdx === -1) return "";
    var sub = scriptText.substring(0, splitIdx);
    var paramRe = /,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]/g;
    var matches = [], m;
    while ((m = paramRe.exec(sub)) !== null) matches.push({ a: parseInt(m[1],10), c: parseInt(m[2],10), start: m.index, end: paramRe.lastIndex });
    if (!matches.length) return "";
    var last = matches[matches.length - 1];
    var k = sub.substring(last.end).split("|");
    var lastBrace = sub.lastIndexOf("}", last.start);
    if (lastBrace === -1) return "";
    var pStart = sub.indexOf("'", lastBrace);
    if (pStart === -1 || pStart > last.start) pStart = sub.indexOf('"', lastBrace);
    if (pStart === -1) return "";
    var p = sub.substring(pStart + 1, last.start).replace(/['"]$/, "");
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    function toBase(n, b) { if (n === 0) return "0"; var o = ""; while (n > 0) { o = chars[n % b] + o; n = Math.floor(n / b); } return o || "0"; }
    var lookup = {};
    for (var i = 0; i < last.c; i++) { var key = toBase(i, last.a); lookup[key] = (i < k.length && k[i]) ? k[i] : key; }
    return p.replace(/\b\w+\b/g, function(w){ return lookup[w] !== undefined ? lookup[w] : w; });
  } catch (e) { return ""; }
}

function resolveServer(target, pageReferer) {
  var serverUrl = target.url;
  if (serverUrl.indexOf("dsvplay.com") !== -1) serverUrl = serverUrl.replace("dsvplay.com", "playmogo.com");
  var domain = getBaseUrl(serverUrl) + "/";

  return fetchHtml(serverUrl, pageReferer).then(function(content){
    if (!content) return [];
    content = unescapeHtml(content);
    if (content.indexOf("eval(function(p,a,c,k") !== -1) {
      var unpacked = unpackDeanEdwards(content);
      if (unpacked) content += "\n" + unescapeHtml(unpacked);
    }
    var matches = [], seenUrls = {};
    function add(u) { var c = cleanUrl(u); if (c.length > 20 && !seenUrls[c] && c !== serverUrl) { seenUrls[c] = true; matches.push(c); } }
    var m3u8Re = /(https?:[\\/]+[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi, mm;
    while ((mm = m3u8Re.exec(content)) !== null) add(mm[1]);
    var r2Re = /(https?:[\\/]+[^\s"'<>]+cloudflarestorage[^\s"'<>]*)/gi;
    while ((mm = r2Re.exec(content)) !== null) add(mm[1]);
    var mp4Re = /(https?:[\\/]+[^\s"'<>]+\.(?:mp4|mkv)[^\s"'<>]*)/gi;
    while ((mm = mp4Re.exec(content)) !== null) add(mm[1]);
    var fileRe = /["']?file["']?\s*:\s*["']([^"']+)["']/gi;
    while ((mm = fileRe.exec(content)) !== null) { if (mm[1].indexOf("http") === 0) add(mm[1]); }
    if (target.isDownload) {
      var anchorRe = /<a[^>]+href=["']([^"']+)["']/gi;
      while ((mm = anchorRe.exec(content)) !== null) { if (/\.(mp4|mkv|m3u8)(\?|$)/i.test(mm[1])) add(mm[1]); }
    }
    if (!matches.length) return [];
    return Promise.all(matches.map(function(vUrl){
      return verifyUrl(vUrl, domain).then(function(h){ return h === null ? null : { url: vUrl, headers: h, quality: "1080p", label: target.name }; });
    })).then(function(rs){ return rs.filter(function(r){ return r !== null; }); });
  });
}

function verifyUrl(videoUrl, domain) {
  var hNoRef = { "User-Agent": UA, "Range": "bytes=0-1" };
  var hWithRef = { "User-Agent": UA, "Referer": domain, "Origin": domain.replace(/\/$/, ""), "Range": "bytes=0-1" };
  return fetch(videoUrl, { headers: hNoRef })
    .then(function(r){ if (r.status >= 200 && r.status < 300) return {}; throw new Error(); })
    .catch(function(){
      return fetch(videoUrl, { headers: hWithRef })
        .then(function(r){ if (r.status >= 200 && r.status < 300) return { "Referer": domain, "Origin": domain.replace(/\/$/, "") }; return null; })
        .catch(function(){ return null; });
    });
}

function getAllStreams(pageUrl) {
  log("GET STREAMS FROM:", pageUrl);
  return fetchHtml(pageUrl).then(function(html){
    if (!html) return [];
    var targets = extractServerTargets(html, pageUrl);
    if (!targets.length) { log("No server targets"); return []; }
    return Promise.all(targets.map(function(t){
      return resolveServer(t, pageUrl).catch(function(e){ log(t.name, "failed:", e.message); return []; });
    })).then(function(arrays){
      var flat = [], seen = {};
      arrays.forEach(function(arr){
        (arr||[]).forEach(function(s){ if (s.url && !seen[s.url]) { seen[s.url] = true; flat.push(s); } });
      });
      return flat;
    });
  });
}

/* ---------------- Navigate from episode → series ---------------- */

function goBackToSeries(epUrl) {
  log("GO BACK TO SERIES from:", epUrl);
  return fetchHtml(epUrl).then(function(html){
    if (!html) return null;
    var m = html.match(/<a[^>]+class=["'][^"']*ftv-episode-poster-back[^"']*["'][^>]*href=["']([^"']+)["']/i)
      || html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*ftv-episode-poster-back[^"']*["']/i);
    if (m && m[1]) { var u = fixUrl(m[1], BASE_URL); log("  → back-link:", u); return u; }

    // Fallback: any /series/ link
    var sm = html.match(/<a[^>]+href=["']([^"']*\/series\/[^"']+)["']/i);
    if (sm && sm[1]) { var u2 = fixUrl(sm[1], BASE_URL); log("  → fallback /series/:", u2); return u2; }

    log("  → no back-link found");
    return null;
  });
}

/* ---------------- Find episode in series → play ---------------- */

function findAndPlayEpisode(seriesUrl, wantE) {
  log("=== FIND E" + wantE + " IN SERIES:", seriesUrl);
  // If this URL is actually an episode page, navigate back first
  if (/\/episode\//.test(seriesUrl)) {
    return goBackToSeries(seriesUrl).then(function(realSeries){
      if (realSeries && realSeries !== seriesUrl) return findAndPlayEpisode(realSeries, wantE);
      log("Cannot resolve series URL, playing direct");
      return getAllStreams(seriesUrl);
    });
  }

  return fetchHtml(seriesUrl).then(function(html){
    if (!html) return [];
    var eps = extractEpisodes(html, seriesUrl);
    if (!eps.length) { log("NO EPISODES FOUND in series page"); return []; }

    // Exact match by number
    var target = null;
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].episode === wantE) { target = eps[i]; break; }
    }
    // Fallback by index
    if (!target && eps.length >= wantE) {
      target = eps[wantE - 1];
      log("No exact number match, using index " + (wantE-1) + ":", target.name);
    }
    // Last resort
    if (!target) target = eps[0];

    log(">>> SELECTED EPISODE:", target.name, "| E" + target.episode, "|", target.url);
    return getAllStreams(target.url);
  });
}

/* ---------------- Movie handler ---------------- */

function handleMovie(results, info) {
  var wanted = info.titles.map(function(t){ return t.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ""); });
  var best = null, bestScore = 0;
  results.forEach(function(r){
    if (r.isSeries || r.isEpisode) return;
    var norm = r.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
    var score = 0;
    wanted.forEach(function(w){
      if (norm === w) score = Math.max(score, 3000);
      else if (norm.indexOf(w) !== -1) score = Math.max(score, 2000);
    });
    if (score > bestScore) { bestScore = score; best = r; }
  });
  if (!best) best = results.find(function(r){ return !r.isSeries && !r.isEpisode; }) || results[0];
  log(">>> MOVIE PICK:", best.title, best.url);
  return getAllStreams(best.url);
}

/* ---------------- TV handler (FIXED) ---------------- */

function handleTv(results, info, wantE) {
  // Strategy:
  // 1. If exact episode match by number → play directly
  // 2. If series page (not episode) exists → extract episodes, find target
  // 3. If only episode pages → go back to series from first one, then find target
  // 4. Fallback to first result

  // Step 1: Exact episode match
  var exactEp = results.find(function(r){ return r.episodeNum === wantE; });
  if (exactEp) {
    log(">>> EXACT EPISODE MATCH: E" + exactEp.episodeNum, "|", exactEp.title, "|", exactEp.url);
    return getAllStreams(exactEp.url);
  }
  log("No exact match for E" + wantE + " in search results");

  // Step 2: Series page
  var seriesPage = results.find(function(r){
    return r.url.indexOf("/series/") !== -1 && !r.isEpisode && r.episodeNum === null;
  });
  if (seriesPage) {
    log(">>> USING SERIES PAGE:", seriesPage.title, seriesPage.url);
    return findAndPlayEpisode(seriesPage.url, wantE);
  }

  // Step 3: Go back from first episode
  var firstEp = results.find(function(r){ return r.isEpisode || r.url.indexOf("/episode/") !== -1; });
  if (firstEp) {
    log(">>> NAVIGATING BACK from:", firstEp.title, firstEp.url);
    return goBackToSeries(firstEp.url).then(function(seriesUrl){
      if (seriesUrl) return findAndPlayEpisode(seriesUrl, wantE);
      log(">>> No series back-link, playing first episode as last resort");
      return getAllStreams(firstEp.url);
    });
  }

  // Step 4: Fallback
  log(">>> FALLBACK to first result:", results[0].title);
  return getAllStreams(results[0].url);
}

/* ---------------- Main ---------------- */

function getStreams(tmdbId, mediaType, season, episode) {
  log("========== START ==========");
  log("tmdbId:", tmdbId, "| type:", mediaType, "| S:", season, "| E:", episode);
  var isMovie = mediaType === "movie";
  var wantE = parseInt(episode, 10) || 1;

  return tmdbInfo(tmdbId, mediaType).then(function(info){
    if (!info.titles.length) { log("NO TMDB TITLES"); return []; }
    log("TMDB TITLES:", info.titles.join(" | "));

    // Search with first 2 titles in parallel
    return Promise.all(info.titles.slice(0, 2).map(search5tv)).then(function(arrs){
      var results = [], seen = {};
      arrs.forEach(function(arr){
        (arr||[]).forEach(function(r){ if (!seen[r.url]) { seen[r.url] = true; results.push(r); } });
      });
      log("MERGED RESULTS:", results.length);
      if (!results.length) return [];

      if (isMovie) return handleMovie(results, info);
      return handleTv(results, info, wantE);
    });
  }).then(function(streams){
    if (!streams || !streams.length) { log("NO STREAMS"); return []; }
    var final = [], seen = {};
    streams.forEach(function(s){
      if (!s.url || seen[s.url]) return;
      seen[s.url] = true;
      var isHls = s.url.indexOf(".m3u8") !== -1;
      final.push({
        name: "5TV - " + (s.label || s.quality || "HD"),
        title: "5TV \u2022 " + (s.label || "Server") + " (" + (isHls ? "HLS" : "MP4") + ")",
        url: s.url, quality: s.quality || "1080p", provider: "fivetv",
        headers: Object.assign({ "User-Agent": UA }, s.headers || {}),
        type: isHls ? "hls" : "mp4"
      });
    });
    log("========== FINAL STREAMS:", final.length, "==========");
    return final;
  }).catch(function(err){ log("FATAL:", err && err.message); return []; });
}

module.exports = { getStreams: getStreams };