"use strict";

const CALLSIGN_RE = /^[A-Za-z0-9/]{3,12}$/;

const form = document.getElementById("searchForm");
const input = document.getElementById("callsign");
const submitBtn = document.getElementById("submitBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let lookup = null;       // lookup.json の中身
let lookupPromise = null;

function loadLookup() {
  if (!lookupPromise) {
    lookupPromise = fetch("lookup.json")
      .then((r) => {
        if (!r.ok) throw new Error("lookup load failed");
        return r.json();
      })
      .then((j) => (lookup = j));
  }
  return lookupPromise;
}

// ページ表示時に変換表を先読み
loadLookup().catch(() => {});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultsEl.innerHTML = "";
  setStatus("");

  const callsign = input.value.trim().toUpperCase();
  if (!CALLSIGN_RE.test(callsign)) {
    setStatus("コールサインの形式が正しくありません（英数字と / のみ・3〜12文字）。", "error");
    return;
  }

  setBusy(true);
  setStatus("検索中…");
  try {
    await loadLookup();
    const data = await searchSoumu(callsign);
    renderResults(callsign, data.results || []);
  } catch (err) {
    setStatus(messageFor(err), "error");
  } finally {
    setBusy(false);
  }
});

async function searchSoumu(callsign) {
  const base = (window.APP_CONFIG && window.APP_CONFIG.WORKER_URL) || "";
  if (!base || base.includes("YOUR-SUBDOMAIN")) {
    throw new Error("worker_not_configured");
  }
  const url = base + "?callsign=" + encodeURIComponent(callsign);
  const res = await fetch(url, { method: "GET", mode: "cors" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "http_" + res.status);
  }
  return res.json();
}

function renderResults(callsign, results) {
  if (!results.length) {
    setStatus("登録ありません", "warn");
    return;
  }
  setStatus(results.length + " 件見つかりました。");

  const frag = document.createDocumentFragment();
  for (const r of results) {
    const resolved = resolveCode(r.pref, lookup);
    const card = document.createElement("div");
    card.className = "card";
    card.appendChild(row("コールサイン", callsign));
    card.appendChild(row("名称", r.name || "—"));
    card.appendChild(row("都道府県", r.pref || "—"));
    card.appendChild(codeRow(resolved));
    if (r.purpose) card.appendChild(row("目的", r.purpose));
    if (r.date) card.appendChild(row("免許年月日", r.date));
    frag.appendChild(card);
  }
  resultsEl.appendChild(frag);
}

function codeRow(resolved) {
  if (resolved.type === "ku") {
    return row("区コード", resolved.code + "（" + resolved.city + resolved.ward + "）", "code");
  }
  if (resolved.type === "jcc") {
    const place = resolved.city || resolved.ward || "";
    return row("JCCコード", resolved.code + (place ? "（" + place + "）" : ""), "code");
  }
  if (resolved.type === "jcg") {
    const place = resolved.gun + (resolved.town || "");
    return row("JCGコード", resolved.code + "（" + place + "）", "code");
  }
  if (resolved.type === "pref") {
    return row("コード", "都道府県のみのため対象外", "muted");
  }
  // unknown
  const detail = resolved.detail ? "（" + resolved.detail + " は変換表に未登録）" : "";
  return row("コード", "該当コードが見つかりません" + detail, "muted");
}

/**
 * 都道府県列の文字列(例「北海道札幌市中央区」)を JCC/JCG/区コードに変換する。
 * 政令市の区 → 区コード、東京特別区・市 → JCC、郡 → JCG。
 */
function resolveCode(prefStr, L) {
  if (!L || !prefStr) return { type: "unknown" };
  const s = prefStr.trim();

  // 都道府県の正式名称を前方一致で特定(最長一致)
  let prefNum = null, prefName = null;
  for (const [num, name] of Object.entries(L.prefNames)) {
    if (s.startsWith(name) && (!prefName || name.length > prefName.length)) {
      prefNum = num; prefName = name;
    }
  }
  if (!prefName) return { type: "unknown" };

  const rest = s.slice(prefName.length).trim();
  if (rest === "") return { type: "pref", pref: prefName };

  // 政令市の区: 「○○市△△区」
  if (rest.includes("市") && rest.endsWith("区")) {
    const i = rest.indexOf("市");
    const city = rest.slice(0, i + 1);
    const ward = rest.slice(i + 1, rest.length - 1); // 末尾の「区」を除く
    const code = L.ku[city] && L.ku[city][ward];
    if (code) return { type: "ku", code, city, ward: ward + "区" };
    return { type: "unknown", detail: city + ward + "区" };
  }

  // 東京特別区など: 「○○区」(市を含まない) → JCC扱い
  if (rest.endsWith("区")) {
    const ward = rest.slice(0, rest.length - 1);
    const code = L.jcc[prefNum] && L.jcc[prefNum][ward];
    if (code) return { type: "jcc", code, ward: ward + "区" };
    return { type: "unknown", detail: rest };
  }

  // 郡: 「○○郡△△町/村」 → JCG(郡コード)
  if (rest.includes("郡")) {
    const i = rest.indexOf("郡");
    const gun = rest.slice(0, i);
    const town = rest.slice(i + 1);
    const code = L.jcg[prefNum] && L.jcg[prefNum][gun];
    if (code) return { type: "jcg", code, gun: gun + "郡", town };
    return { type: "unknown", detail: rest };
  }

  // 市: 「○○市」 → JCC
  if (rest.endsWith("市")) {
    const city = rest.slice(0, rest.length - 1);
    const code = L.jcc[prefNum] && L.jcc[prefNum][city];
    if (code) return { type: "jcc", code, city: city + "市" };
    return { type: "unknown", detail: rest };
  }

  return { type: "unknown", detail: rest };
}

function row(label, value, kind) {
  const div = document.createElement("div");
  div.className = "card__row" + (kind ? " card__row--" + kind : "");
  const l = document.createElement("span");
  l.className = "card__label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "card__value";
  v.textContent = value;
  div.appendChild(l);
  div.appendChild(v);
  return div;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " status--" + kind : "");
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  input.disabled = busy;
}

function messageFor(err) {
  const m = String((err && err.message) || err);
  if (m === "worker_not_configured")
    return "設定エラー: config.js の WORKER_URL を設定してください。";
  if (m === "invalid_callsign") return "コールサインの形式が正しくありません。";
  if (m === "forbidden_origin")
    return "アクセスが許可されていません（オリジン制限）。";
  if (m === "upstream_error" || m.startsWith("http_5"))
    return "総務省サイトへの照会に失敗しました。時間をおいて再度お試しください。";
  return "通信エラーが発生しました。ネットワークをご確認ください。";
}
