/**
 * コールサイン検索 中継プロキシ (Cloudflare Worker)
 *
 * 役割:
 *  - フロント(GitHub Pages)からコールサインを受け取り、入力を厳格に検証する
 *  - 総務省「無線局等情報検索」へサーバー側からアクセスし(ブラウザUA付与)、
 *    結果テーブルから「名称」「都道府県」等を抽出して JSON で返す
 *  - CORS は許可オリジンを限定し、内部の検索先や生HTMLは一切外部へ晒さない
 *
 * 総務省サイトはブラウザ以外を403で拒否し、CORSヘッダも返さないため、
 * ブラウザから直接アクセスできない。この中継が必須。
 */

const SOUMU_BASE = "https://www.tele.soumu.go.jp/musen/SearchServlet";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// アマチュア局コールサインとして許容する形式(英数字とポータブル表記の / のみ)
const CALLSIGN_RE = /^[A-Za-z0-9/]{3,12}$/;

export default {
  async fetch(request, env) {
    const allowOrigin = pickAllowedOrigin(request, env);
    const cors = corsHeaders(allowOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "method_not_allowed" }, 405, cors);
    }
    // 許可外オリジンからのブラウザ経由アクセスは拒否(直リンク防御の一助)
    if (allowOrigin === null) {
      return json({ ok: false, error: "forbidden_origin" }, 403, cors);
    }

    const url = new URL(request.url);
    const raw = (url.searchParams.get("callsign") || "").trim();
    const callsign = raw.toUpperCase();

    if (!callsign) {
      return json({ ok: false, error: "missing_callsign" }, 400, cors);
    }
    if (!CALLSIGN_RE.test(callsign)) {
      return json({ ok: false, error: "invalid_callsign" }, 400, cors);
    }

    let html;
    try {
      html = await fetchSoumu(callsign);
    } catch (e) {
      return json({ ok: false, error: "upstream_error" }, 502, cors);
    }

    const results = parseResults(html);
    return json({ ok: true, callsign, results }, 200, cors);
  },
};

function pickAllowedOrigin(request, env) {
  // env.ALLOWED_ORIGINS はカンマ区切り。"*" を含めれば全許可(非推奨)。
  const list = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS : "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*")) return "*";
  const origin = request.headers.get("Origin");
  if (origin && list.includes(origin)) return origin;
  // Origin ヘッダの無い直接アクセス(curl等)はブロック対象
  return null;
}

function corsHeaders(allowOrigin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
    if (allowOrigin !== "*") h["Vary"] = "Origin";
  }
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

async function fetchSoumu(callsign) {
  const params = new URLSearchParams({
    MA: callsign, // 呼出符号
    SelectID: "1",
    SelectOW: "01", // アマチュア局
    DC: "100",
    SK: "2",
    pageID: "3",
    SC: "1",
    CONFIRM: "1", // 検索実行
  });
  const res = await fetch(`${SOUMU_BASE}?${params.toString()}`, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "ja,en;q=0.9",
      Accept: "text/html",
    },
    cf: { cacheTtl: 60, cacheEverything: false },
  });
  if (!res.ok) throw new Error("soumu http " + res.status);
  return await res.text();
}

/** 結果テーブル(tbody.m-table-sort__body)の各行から4列を抽出 */
function parseResults(html) {
  const out = [];
  const bodyM = html.match(/m-table-sort__body[\s\S]*?<\/tbody>/);
  if (!bodyM) return out; // 0件
  const body = bodyM[0];
  const rowRe = /<tr class="m-table-sort__row">([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(body)) !== null) {
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let td;
    while ((td = tdRe.exec(row[1])) !== null) tds.push(cleanCell(td[1]));
    if (tds.length >= 2) {
      out.push({
        name: tds[0] || "",
        pref: tds[1] || "",
        purpose: tds[2] || "",
        date: tds[3] || "",
      });
    }
  }
  return out;
}

function cleanCell(s) {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
  ).trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}
