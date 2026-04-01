import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SheetRow {
  [key: string]: string;
}

// Column mapping from sheet headers to database columns
const COLUMN_MAP: Record<string, string> = {
  "retailer id": "retailer_id",
  "retailer pool id": "retailer_pool_id",
  "client name": "client_name",
  "merchant quality": "merchant_quality",
  "published": "published",
  "indexed": "indexed",
  "active vouchers": "active_vouchers",
  "active codes": "active_codes",
  "active deals": "active_deals",
  "affiliate network": "affiliate_network",
  "seo url": "seo_url",
  "retailer seo title with tags": "retailer_seo_title",
  "retailer seo desc with tags": "retailer_seo_desc",
  "h1": "h1",
  "logo alt text": "logo_alt_text",
  "show expired vouchers": "show_expired_vouchers",
  "last verified": "last_verified",
  "ranking algorithm": "ranking_algorithm",
  "retailer url anchor": "retailer_url_anchor",
  "retailer url": "retailer_url",
  "page title": "page_title",
  "url anchor is js link": "url_anchor_js_link",
  "country": "country",
  "keyword 1": "keyword_1",
  "keyword 2": "keyword_2",
  "keyword 3": "keyword_3",
  "keyword 4": "keyword_4",
  "retailer assignment": "retailer_assignment",
};

async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);

  // Create JWT
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(header))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const claimB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(claim))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const signInput = `${headerB64}.${claimB64}`;

  // Import private key
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");

    if (!serviceAccountKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const { spreadsheet_id, sheet_name } = await req.json();
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sheetParam = sheet_name || "Sheet1";

    // Get Google access token
    const accessToken = await getAccessToken(serviceAccountKey);

    // Fetch sheet data
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(sheetParam)}`;
    const sheetRes = await fetch(sheetUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!sheetRes.ok) {
      const errText = await sheetRes.text();
      return new Response(
        JSON.stringify({ error: `Google Sheets API error: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sheetData = await sheetRes.json();
    const rows: string[][] = sheetData.values || [];

    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Sheet has no data rows", synced: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map headers to DB columns
    const headers = rows[0].map((h: string) => h.trim().toLowerCase());
    const dataRows = rows.slice(1);

    const issues = dataRows.map((row: string[]) => {
      const record: Record<string, string> = {
        sheet_id: spreadsheet_id,
        sheet_name: sheetParam,
        status: "open",
      };

      headers.forEach((header: string, idx: number) => {
        const dbCol = COLUMN_MAP[header];
        if (dbCol && row[idx]) {
          record[dbCol] = row[idx].trim();
        }
      });

      // Try to find assigned email from "retailer assignment" or similar
      if (!record.assigned_email && record.retailer_assignment) {
        // Check if retailer_assignment looks like an email
        if (record.retailer_assignment.includes("@")) {
          record.assigned_email = record.retailer_assignment;
        }
      }

      return record;
    });

    // Clear existing issues from this sheet and re-insert
    await adminClient
      .from("issues")
      .delete()
      .eq("sheet_id", spreadsheet_id)
      .eq("sheet_name", sheetParam);

    // Insert in batches of 100
    let inserted = 0;
    for (let i = 0; i < issues.length; i += 100) {
      const batch = issues.slice(i, i + 100);
      const { error: insertError } = await adminClient.from("issues").insert(batch);
      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error(`Insert failed: ${insertError.message}`);
      }
      inserted += batch.length;
    }

    return new Response(
      JSON.stringify({ success: true, synced: inserted, sheet: sheetParam }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
