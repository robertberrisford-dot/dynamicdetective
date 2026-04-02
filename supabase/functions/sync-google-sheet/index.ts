import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VOUCHER_COLUMN_MAP: Record<string, string> = {
  "voucher_id_pool": "voucher_id_pool",
  "voucher_title": "voucher_title",
  "voucher_description": "voucher_description",
  "voucher_caption_text_1": "voucher_caption_text_1",
  "voucher_caption_1": "voucher_caption_1",
  "voucher_caption_2": "voucher_caption_2",
  "merchant_id_pool": "retailer_pool_id",
  "merchant_name": "client_name",
  "merchant_quality_name": "merchant_quality",
  "is_merchant_indexed": "indexed",
  "affiliate_network_name": "affiliate_network",
  "voucher_category": "voucher_category",
  "is_voucher_active": "is_voucher_active",
  "voucher_source": "voucher_source",
  "voucher_type": "voucher_type",
  "voucher_code": "voucher_code",
};

async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);
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
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${signInput}.${sigB64}`;
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

async function fetchSheet(accessToken: string, spreadsheetId: string, sheetName: string): Promise<string[][]> {
  const range = `'${sheetName}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Sheets API error for "${sheetName}": ${errText}`);
  }
  const data = await res.json();
  return data.values || [];
}

async function syncEditors(
  adminClient: ReturnType<typeof createClient>,
  accessToken: string,
  spreadsheetId: string,
  teamLeadEmail: string
) {
  let rows: string[][];
  try {
    rows = await fetchSheet(accessToken, spreadsheetId, "Editors");
  } catch (e) {
    console.log("Could not fetch Editors tab, skipping:", e);
    return 0;
  }
  if (rows.length < 2) return 0;

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const emailIdx = headers.findIndex(h => h.includes("mail") || h === "email" || h === "e-mail");
  const nameIdx = headers.findIndex(h => h === "name" || h.includes("name"));
  const roleIdx = headers.findIndex(h => h === "role" || h.includes("role"));

  if (emailIdx === -1) return 0;

  const editors: { email: string; name: string | null; role: string }[] = [];
  const editorEmails = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = String(row[emailIdx] || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    editorEmails.add(email);
    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() || null : null;
    const sheetRole = roleIdx >= 0 ? String(row[roleIdx] || "").trim().toLowerCase() : "";
    let role = "editor";
    if (email === teamLeadEmail.toLowerCase()) role = "team_lead";
    else if (sheetRole.includes("lead") || sheetRole.includes("manager")) role = "team_lead";
    editors.push({ email, name, role });
  }

  if (!editorEmails.has(teamLeadEmail.toLowerCase())) {
    editors.push({ email: teamLeadEmail.toLowerCase(), name: "Thomas Punzel", role: "team_lead" });
  }

  // Don't delete editors — just upsert to preserve team_lead_email
  if (editors.length > 0) {
    for (const ed of editors) {
      await adminClient.from("editors").upsert(
        { email: ed.email, name: ed.name, role: ed.role },
        { onConflict: "email" }
      );
    }
  }

  console.log(`Synced ${editors.length} editors`);
  return editors.length;
}

function hasNumericValue(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  const s = String(val).trim();
  if (s === "" || s === "0" || s === "0.0" || s === "0.00") return false;
  return /\d/.test(s) && !isNaN(parseFloat(s)) && parseFloat(s) !== 0;
}

function detectIssues(record: Record<string, unknown>): string | null {
  // Check: voucher_caption_1 has no numerical value
  if (!hasNumericValue(record.voucher_caption_1)) {
    return "missing_caption_1";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await adminClient
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin").maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { spreadsheet_id, sheet_name } = await req.json();
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sheetParam = sheet_name || "MYDEAL_DE_API_Vouchers (Preset)";
    const accessToken = await getAccessToken(serviceAccountKey);

    // Sync editors
    const editorsSynced = await syncEditors(
      adminClient, accessToken, spreadsheet_id, "thomas.punzel@atolls.com"
    );

    // Fetch retailer assignments
    const { data: retailersData } = await adminClient
      .from("retailers")
      .select("retailer_pool_id, retailer_assignment");
    const retailerMap = new Map<string, string>();
    (retailersData || []).forEach(r => {
      if (r.retailer_pool_id && r.retailer_assignment) {
        retailerMap.set(r.retailer_pool_id, r.retailer_assignment);
      }
    });

    // Fetch editor info for assignment lookup
    const { data: editorsList } = await adminClient.from("editors").select("email, role, team_lead_email");
    const editorEmailSet = new Set((editorsList || []).filter(e => e.role === "editor" || e.role === "team_lead").map(e => e.email.toLowerCase()));

    // Fetch voucher sheet
    const rows = await fetchSheet(accessToken, spreadsheet_id, sheetParam);
    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Sheet has no data rows", synced: 0, editors_synced: editorsSynced }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = rows[0].map((h: unknown) => String(h).trim().toLowerCase());
    console.log("Voucher sheet headers:", JSON.stringify(headers));
    const dataRows = rows.slice(1);

    // Process vouchers and detect issues
    const issues: Record<string, unknown>[] = [];
    let issueCount = 0;

    for (const row of dataRows) {
      const record: Record<string, unknown> = {
        sheet_id: spreadsheet_id,
        sheet_name: sheetParam,
        status: "open",
      };

      headers.forEach((header: string, idx: number) => {
        const dbCol = VOUCHER_COLUMN_MAP[header];
        if (dbCol && row[idx] !== undefined && row[idx] !== null) {
          record[dbCol] = row[idx];
        }
      });

      // Convert is_voucher_active to boolean
      if (record.is_voucher_active !== undefined) {
        record.is_voucher_active = record.is_voucher_active === true || record.is_voucher_active === "true" || record.is_voucher_active === "TRUE" || record.is_voucher_active === 1;
      }

      // Look up assignment from retailers table
      const poolId = String(record.retailer_pool_id || "");
      if (poolId && retailerMap.has(poolId)) {
        const assignment = retailerMap.get(poolId)!;
        record.retailer_assignment = assignment;
        // Find the editor email (not account manager, not team lead)
        const emails = assignment.split(",").map(e => e.trim().toLowerCase());
        // Prefer editor over team lead over account manager
        const editorEmail = emails.find(e => {
          const ed = editorsList?.find(ed => ed.email.toLowerCase() === e);
          return ed && ed.role === "editor";
        });
        record.assigned_email = editorEmail || emails.find(e => editorEmailSet.has(e)) || emails[0];
      }

      // Detect issues
      const issueType = detectIssues(record);
      if (issueType) {
        record.issue_type = issueType;
        issueCount++;
        issues.push(record);
      }
    }

    // Clear old issues for this sheet and re-insert only flagged ones
    await adminClient.from("issues").delete()
      .eq("sheet_id", spreadsheet_id).eq("sheet_name", sheetParam);

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

    console.log(`Total vouchers: ${dataRows.length}, Issues found: ${issueCount}, Inserted: ${inserted}`);

    return new Response(
      JSON.stringify({
        success: true,
        total_vouchers: dataRows.length,
        issues_found: issueCount,
        synced: inserted,
        editors_synced: editorsSynced,
        sheet: sheetParam,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
