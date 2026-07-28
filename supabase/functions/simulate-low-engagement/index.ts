import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  };
  const enc = new TextEncoder();
  const b64u = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claim))}`;
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const bin = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bin, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${signInput}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const d = await res.json();
  if (!d.access_token) throw new Error("Token fail");
  return d.access_token;
}

async function fetchSheet(token: string, sid: string, name: string): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`'${name}'`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).values || [];
}

function parseCpd(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) return v;
  const n = Number(String(v).replace(",", ".").trim());
  return isFinite(n) ? n : null;
}

// Sheet serial date -> JS Date
function serialToDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }
  const s = String(v).trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cfg } = await admin.from("country_configs").select("*").eq("country_code", "de").single();
    const token = await getAccessToken(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")!);
    const rows = await fetchSheet(token, cfg!.voucher_spreadsheet_id, cfg!.voucher_sheet_name);
    const headers = rows[0] as string[];
    const idx = (name: string) => headers.findIndex(h => h === name);
    const iActive = idx("is_voucher_active");
    const iRetailer = idx("merchant_id_pool");
    const iClient = idx("merchant_name");
    const iCpd = idx("voucher_rank_cpd") >= 0 ? idx("voucher_rank_cpd") : 36;
    const iCreated = idx("voucher_created_at") >= 0 ? idx("voucher_created_at") : 16; // Q = 16
    const iType = idx("voucher_type");

    const now = Date.now();
    const D30 = 30 * 86400 * 1000;

    type V = { rpid: string; client: string; cpd: number | null; created: Date | null; type: string };
    const groups = new Map<string, V[]>();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const active = row[iActive];
      const isActive = active === true || active === "true" || active === "TRUE" || active === 1;
      if (!isActive) continue;
      const rpid = String(row[iRetailer] ?? "").trim();
      if (!rpid) continue;
      const v: V = {
        rpid, client: String(row[iClient] ?? ""),
        cpd: parseCpd(row[iCpd]),
        created: serialToDate(row[iCreated]),
        type: String(row[iType] ?? ""),
      };
      if (!groups.has(rpid)) groups.set(rpid, []);
      groups.get(rpid)!.push(v);
    }

    const MIN = 5, RATIO = 0.4;
    const scenarios = [
      { name: "current (no age filter)", ageDays: 0 },
      { name: ">= 30d live", ageDays: 30 },
      { name: ">= 60d live", ageDays: 60 },
      { name: ">= 90d live", ageDays: 90 },
    ];
    const results: any[] = [];
    let vouchersMissingCreated = 0, totalActive = 0;
    for (const g of groups.values()) for (const v of g) { totalActive++; if (!v.created) vouchersMissingCreated++; }

    for (const s of scenarios) {
      let pages = 0, vouchers = 0;
      for (const g of groups.values()) {
        // "dead" pool must satisfy CPD<=0 AND (age filter if any)
        const eligible = g; // page eligibility uses all active vouchers
        if (eligible.length < MIN) continue;
        const dead = eligible.filter(v => {
          if (v.cpd === null || v.cpd > 0) return false;
          if (s.ageDays > 0) {
            if (!v.created) return false;
            if (now - v.created.getTime() < s.ageDays * 86400 * 1000) return false;
          }
          return true;
        });
        if (dead.length / eligible.length <= RATIO) continue;
        pages++;
        vouchers += dead.length;
      }
      results.push({ scenario: s.name, retailers: pages, vouchers_flagged: vouchers });
    }

    // sample raw created values
    const samples: any[] = [];
    for (let r = 1; r < rows.length && samples.length < 10; r++) {
      const row = rows[r];
      if (!row) continue;
      samples.push({ raw: row[iCreated], type: typeof row[iCreated] });
    }
    return new Response(JSON.stringify({
      total_active_vouchers: totalActive,
      vouchers_missing_created_at: vouchersMissingCreated,
      column_used_for_created: headers[iCreated] ?? `index ${iCreated}`,
      created_index: iCreated,
      header_at_16: headers[16],
      samples,
      results,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
