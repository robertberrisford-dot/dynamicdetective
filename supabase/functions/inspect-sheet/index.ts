import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const encoder = new TextEncoder();
  const headerB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(header)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const claimB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(claim)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signInput = `${headerB64}.${claimB64}`;
  const pemContent = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${signInput}.${sigB64}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")!;
    const accessToken = await getAccessToken(serviceAccountKey);
    const { spreadsheet_id, sheet_name, list_tabs } = await req.json();

    if (list_tabs) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}?fields=sheets.properties`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      const tabs = (data.sheets || []).map((s: any) => s.properties?.title);
      return new Response(JSON.stringify({ tabs, raw: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const range = `'${sheet_name}'!1:2`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    const headers = data.values?.[0] || [];
    const sample = data.values?.[1] || [];
    return new Response(JSON.stringify({ total_columns: headers.length, headers, sample_values: sample.slice(0, 50), raw: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
