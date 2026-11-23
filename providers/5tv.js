/**
 * 5TV - Nuvio JS Provider (FIXED Episode Selection)
 * Ported from CloudStream Kotlin (FiveTVProvider).
 * Fixes: correct episode matching, prefers series page, navigates from episode back to series.
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
    while ((m = paramRe.exec(sub)) !== null) matches.push({ a: parseInt(m[1],10), c: parseInt(m[2],10), start: m.index, end: paramRe.lastIndex });
    if (!matches.length) return "";
    var last = matches[matches.length - 1];
    var a = last.a, c = last.c;
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
    for (var i = 0; i < c; i++) { var key = toBase(i, a); lookup[key] = (i < k.length && k[i]) ? k[i] : key; }
    return p.replace(/\b\w+\b/g, function(w){ return lookup[w] !== undefined ? lookup[w] : w; });
  } catch (e) { return ""; }
}

/* ---------------- Episode number extraction ---------------- */

function extractEpisodeNum(text, url) {
  // From text: "الحلقة 3", "حلقة 3", "Episode 3", "EP3"
  var t = String(text || "");
  var m = t.match(/(?:الحلقة|حلقة|episode|ep|ep\.)\s*0*(\d{1,4})(?!\d)/i);
  if (m) return parseInt(m[1], 10);
  // From URL: /episode/3/, /ep-3/, -3-, _3_
  var u = String(url || "");
  var um = u.match(/\/(?:episode|ep|ep-)[\/_-]?(\d{1,4})(?:\/|$)/i);
  if (um) return parseInt(um[1], 10);
  um = u.match(/(?:^|[\/_-])(\d{1,4})(?:\/|$|-|_)/);
  if (um) return parseInt(um[1], 10);
  return null;
}

/* ---------------- Search ---------------- */

function search5tv(query) {
  var url = BASE_URL + "/search/?q=" + encodeURIComponent(query);
  log("Search:", url);
  return fetchHtml(url).then(function(html){
    if (!html) return [];
    var results = [], seen = {};
    var articleRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = articleRe.exec(html)) !== null) {
      var block = m[1];
      var tm = block.match(/<[^>]*class=["'][^"']*(?:ftv-home-poster-card__title|ftv-home-episode-card__title)[^"']*["'][^>]*>([\s\S]*?)<\//i)
        || block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      if (!tm) continue;
      var title = tm[1].replace(/<[^>]+>/g, "").trim();
      if (!title) continue;

      var um = block.match(/<a[^>]+href=["']([^"']+)["']/i);
      if (!um) continue;
      var href = fixUrl(um[1], BASE_URL);
      if (seen[href]) continue;
      seen[href] = true;

      var pm = block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
      var poster = pm ? fixUrl(pm[1], BASE_URL) : "";

      var isEpisodeUrl = /\/episode\//.test(href);
      var isSeriesUrl = /\/series\//.test(href);
      var isMovieUrl = /\/movie\//.test(href);
      var hasEpWord = /الحلقة|حلقة|episode|ep\.?\s*\d/i.test(title);
      var epNum = extractEpisodeNum(title, href);

      var isSeries = (isSeriesUrl || /مسلسل/i.test(title)) && !isMovieUrl;
      var isEpisode = isEpisodeUrl || hasEpWord;

      results.push({
        url: href,
        title: title,
        poster: poster,
        isSeries: isSeries,
        isEpisode: isEpisode,
        isMovie: isMovieUrl,
        episodeNum: epNum
      });
    }
    log("Search results:", results.length, results.map(function(r){ return (r.episodeNum!=null?"E"+r.episodeNum+" ":"")+r.title; }).slice(0,5).join(" | "));
    return results;
  });
}

/* ---------------- Episode extraction from series page ---------------- */

function extractEpisodes(html, pageUrl) {
  if (!html) return [];
  var episodes = [];
  var seen = {};
  var m;

  // Pattern 1: ftv-episode-completion-item blocks
  var itemRe = /<div[^>]*class=["'][^"']*ftv-(?:series-)?episode-completion-item[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((m = itemRe.exec(html)) !== null) {
    var block = m[1];
    var hrefM = block.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (!hrefM) continue;
    var epUrl = fixUrl(hrefM[1], BASE_URL);
    if (seen[epUrl]) continue;
    seen[epUrl] = true;
    var titleM = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    var epTitle = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim() : "حلقة";
    var epNum = extractEpisodeNum(epTitle, epUrl);
    episodes.push({ url: epUrl, name: epTitle, episode: epNum, season: 1 });
  }

  // Pattern 2: any <a> pointing to /episode/
  if (episodes.length === 0) {
    var linkRe = /<a[^>]+href=["']([^"']*\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = linkRe.exec(html)) !== null) {
      var eUrl = fixUrl(m[1], BASE_URL);
      if (seen[eUrl]) continue;
      seen[eUrl] = true;
      var txt = m[2].replace(/<[^>]+>/g, "").trim();
      var n = extractEpisodeNum(txt, eUrl);
      episodes.push({ url: eUrl, name: txt || "حلقة", episode: n, season: 1 });
    }
  }

  // Pattern 3: fallback — any link whose text contains "الحلقة N"
  if (episodes.length === 0) {
    var anyRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = anyRe.exec(html)) !== null) {
      var aUrl = fixUrl(m[1], BASE_URL);
      var aTxt = m[2].replace(/<[^>]+>/g, "").trim();
      if (!/الحلقة|حلقة|episode/i.test(aTxt)) continue;
      if (seen[aUrl]) continue;
      seen[aUrl] = true;
      var an = extractEpisodeNum(aTxt, aUrl);
      episodes.push({ url: aUrl, name: aTxt, episode: an, season: 1 });
    }
  }

  // Dedupe by episode number (keep first)
  var byNum = {}, final = [];
  episodes.forEach(function(e){
    if (e.episode != null && !byNum[e.episode]) { byNum[e.episode] = 1; final.push(e); }
  });
  if (final.length === 0) final = episodes;

  final.sort(function(a,b){ return (a.episode||999) - (b.episode||999); });
  log("Episodes found:", final.length, final.slice(0,5).map(function(e){ return "E"+e.episode; }).join(","));
  return final;
}

/* ---------------- Server extraction ---------------- */

function extractServerTargets(html, pageUrl) {
  if (!html) return [];
  var targets = [];
  var seen = {};

  var piM = html.match(/<[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<iframe[^>]*class=["'][^"']*ftv-player-iframe[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (piM && piM[1]) {
    var pu = fixUrl(piM[1], BASE_URL);
    if (!seen[pu]) { seen[pu] = true; targets.push({ name: "Direct Player", url: pu, isDownload: false }); }
  }

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

/* ---------------- Resolve server ---------------- */

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
    function add(u) {
      var c = cleanUrl(u);
      if (c.length > 20 && !seenUrls[c] && c !== serverUrl) { seenUrls[c] = true; matches.push(c); }
    }
    var m3u8Re = /(https?:[\\/]+[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi; var mm;
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
    if (matches.length === 0) return [];
    var verifyPromises = matches.map(function(vUrl){
      return verifyUrl(vUrl, domain).then(function(headers){
        if (headers === null) return null;
        return { url: vUrl, headers: headers };
      });
    });
    return Promise.all(verifyPromises).then(function(results){
      var out = [];
      results.forEach(function(r){ if (r) out.push(r); });
      return out.map(function(r){ return { url: r.url, headers: r.headers, quality: "1080p", label: target.name }; });
    });
  });
}

function verifyUrl(videoUrl, domain) {
  var hNoRef = { "User-Agent": UA, "Range": "bytes=0-1" };
  var hWithRef = { "User-Agent": UA, "Referer": domain, "Origin": domain.replace(/\/$/, ""), "Range": "bytes=0-1" };
  return fetch(videoUrl, { headers: hNoRef })
    .then(function(r){ if (r.status >= 200 && r.status < 300) return {}; throw new Error("need ref"); })
    .catch(function(){
      return fetch(videoUrl, { headers: hWithRef })
        .then(function(r){ if (r.status >= 200 && r.status < 300) return { "Referer": domain, "Origin": domain.replace(/\/$/, "") }; return null; })
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
        (arr || []).forEach(function(s){ if (s.url && !seen[s.url]) { seen[s.url] = true; flat.push(s); } });
      });
      return flat;
    });
  });
}

/* ---------------- Navigate from episode page back to series ---------------- */

function goBackToSeries(epUrl) {
  return fetchHtml(epUrl).then(function(html){
    if (!html) return null;
    // Try ftv-episode-poster-back
    var m = html.match(/<a[^>]+class=["'][^"']*ftv-episode-poster-back[^"']*["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*ftv-episode-poster-back[^"']*["']/i);
    if (m && m[1]) return fixUrl(m[1], BASE_URL);
    // Fallback: any link to /series/
    var sm = html.match(/<a[^>]+href=["']([^"']*\/series\/[^"']+)["']/i);
    if (sm && sm[1]) return fixUrl(sm[1], BASE_URL);
    return null;
  });
}

/* ---------------- Find episode & get streams ---------------- */

function findAndPlayEpisode(seriesUrl, season, episode) {
  var wantE = parseInt(episode, 10) || 1;
  log("Find episode E" + wantE + " in series:", seriesUrl);

  return fetchHtml(seriesUrl).then(function(html){
    if (!html) return [];
    var eps = extractEpisodes(html, seriesUrl);
    if (!eps.length) { log("No episodes in series page"); return []; }

    // Exact match first
    var target = null;
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].episode === wantE) { target = eps[i]; break; }
    }
    // Fallback: index-based
    if (!target) target = eps[wantE - 1];
    if (!target) target = eps[0];

    log("Selected episode:", target.name, "E" + target.episode, target.url);
    return getAllStreams(target.url);
  });
}

/* ---------------- Main ---------------- */

function getStreams(tmdbId, mediaType, season, episode) {
  log("=== START:", tmdbId, mediaType, "S"+season, "E"+episode);
  var isMovie = mediaType === "movie";

  return tmdbInfo(tmdbId, mediaType).then(function(info){
    if (!info.titles.length) { log("No titles"); return []; }
    log("Titles:", info.titles.join(" | "));

    return Promise.all(info.titles.slice(0, 2).map(search5tv)).then(function(arrs){
      var results = [], seen = {};
      arrs.forEach(function(arr){ (arr||[]).forEach(function(r){ if (!seen[r.url]) { seen[r.url]=true; results.push(r); } }); });
      if (!results.length) { log("No results"); return []; }

      /* --- MOVIE --- */
      if (isMovie) {
        var moviePick = null, movieScore = 0;
        results.forEach(function(r){
          if (r.isSeries || r.isEpisode) return;
          var norm = r.title.toLowerCase();
          var score = 0;
          info.titles.forEach(function(t){
            var nt = t.toLowerCase();
            if (norm === nt) score = Math.max(score, 3000);
            else if (norm.indexOf(nt) !== -1) score = Math.max(score, 2000);
          });
          if (score > movieScore) { movieScore = score; moviePick = r; }
        });
        if (!moviePick) moviePick = results.find(function(r){ return !r.isSeries && !r.isEpisode; }) || results[0];
        log("Movie pick:", moviePick.title, moviePick.url);
        return getAllStreams(moviePick.url);
      }

      /* --- TV SERIES --- */
      var wantE = parseInt(episode, 10) || 1;

      // 1) Prefer TRUE series page (isSeries && !isEpisode)
      var seriesCandidates = results.filter(function(r){ return r.isSeries && !r.isEpisode && !r.episodeNum; });
      if (seriesCandidates.length > 0) {
        // sort by best title match
        var bestSeries = null, bestScore = 0;
        seriesCandidates.forEach(function(r){
          var norm = r.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
          var score = 0;
          info.titles.forEach(function(t){
            var nt = t.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
            if (norm === nt) score = Math.max(score, 3000);
            else if (norm.indexOf(nt) !== -1) score = Math.max(score, 2000);
          });
          if (score > bestScore) { bestScore = score; bestSeries = r; }
        });
        if (bestSeries) {
          log("Using SERIES page:", bestSeries.title, bestSeries.url);
          return findAndPlayEpisode(bestSeries.url, season, wantE);
        }
      }

      // 2) Exact episode match by episodeNum
      var exactEp = null;
      results.forEach(function(r){
        if (r.episodeNum === wantE && (r.isEpisode || r.isSeries || /الحلقة|episode/i.test(r.title))) {
          if (!exactEp) exactEp = r;
        }
      });
      if (exactEp) {
        log("Exact episode match:", exactEp.title, exactEp.url);
        return getAllStreams(exactEp.url);
      }

      // 3) Any episode → go back to series, then find correct episode
      var anyEp = results.find(function(r){ return r.isEpisode || r.episodeNum != null; });
      if (anyEp) {
        log("Using episode page then back to series:", anyEp.title, anyEp.url);
        return goBackToSeries(anyEp.url).then(function(seriesUrl){
          if (seriesUrl) {
            log("Found series back-link:", seriesUrl);
            return findAndPlayEpisode(seriesUrl, season, wantE);
          }
          // Couldn't find series — play anyEp as last resort
          log("No series back-link; playing found episode directly");
          return getAllStreams(anyEp.url);
        });
      }

      // 4) Last resort: whatever is first
      log("Fallback to first result:", results[0].title, results[0].url);
      return getAllStreams(results[0].url);
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