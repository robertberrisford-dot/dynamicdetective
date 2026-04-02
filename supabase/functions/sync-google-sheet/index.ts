import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COLUMN_MAP: Record<string, string> = {
  "old merchant id": "retailer_id",
  "retailer pool id": "retailer_pool_id",
  "client id": "client_id",
  "name": "client_name",
  "merchant quality": "merchant_quality",
  "retailer published": "published",
  "page published": "page_published",
  "indexed": "indexed",
  "affiliate network": "affiliate_network",
  "active vouchers": "active_vouchers",
  "active codes": "active_codes",
  "active deals": "active_deals",
  "seo url": "seo_url",
  "retailer seo title with tags": "retailer_seo_title",
  "retailer seo desc with tags": "retailer_seo_desc",
  "retailer logo alt text": "logo_alt_text",
  "ranking algorithm": "ranking_algorithm",
  "retailer url anchor": "retailer_url_anchor",
  "retailer url": "retailer_url",
  "client": "page_title",
  "country": "country",
  "keyword 1": "keyword_1",
  "keyword 2": "keyword_2",
  "keyword 3": "keyword_3",
  "keyword 4": "keyword_4",
  "retailer assignment": "retailer_assignment",
  // Voucher sheet mappings
  "merchant_id_pool": "retailer_pool_id",
  "merchant_name": "client_name",
  "merchant_quality_name": "merchant_quality",
  "affiliate_network_name": "affiliate_network",
  "is_merchant_indexed": "indexed",
  // Legacy mappings
  "retailer id": "retailer_id",
  "retailer pool id": "retailer_pool_id",
  "client name": "client_name",
  "published": "published",
  "show expired vouchers": "show_expired_vouchers",
  "last verified": "last_verified",
  "h1": "h1",
  "logo alt text": "logo_alt_text",
  "page title": "page_title",
  "url anchor is js link": "url_anchor_js_link",
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
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
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

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const emailIdx = headers.findIndex(h => h.includes("mail") || h === "email" || h === "e-mail");
  const nameIdx = headers.findIndex(h => h === "name" || h.includes("name"));
  const roleIdx = headers.findIndex(h => h === "role" || h.includes("role"));

  console.log("Editors tab headers:", JSON.stringify(headers));
  console.log("Column indices - email:", emailIdx, "name:", nameIdx, "role:", roleIdx);

  if (emailIdx === -1) {
    console.log("No email column found in Editors tab");
    return 0;
  }

  const editorEmails = new Set<string>();
  const editors: { email: string; name: string | null; role: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = row[emailIdx]?.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    editorEmails.add(email);
    const name = nameIdx >= 0 ? row[nameIdx]?.trim() || null : null;
    const sheetRole = roleIdx >= 0 ? row[roleIdx]?.trim().toLowerCase() || "" : "";

    let role = "editor";
    if (email.toLowerCase() === teamLeadEmail.toLowerCase()) {
      role = "team_lead";
    } else if (sheetRole.includes("lead") || sheetRole.includes("manager")) {
      role = "team_lead";
    }

    editors.push({ email, name, role });
  }

  // Clear and re-insert editors
  await adminClient.from("editors").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  if (editors.length > 0) {
    // Add team lead explicitly if not in the list
    if (!editorEmails.has(teamLeadEmail.toLowerCase())) {
      editors.push({ email: teamLeadEmail.toLowerCase(), name: "Thomas Punzel", role: "team_lead" });
    }

    const { error } = await adminClient.from("editors").upsert(editors, { onConflict: "email" });
    if (error) {
      console.error("Editor insert error:", error);
      throw new Error(`Editor insert failed: ${error.message}`);
    }
  }

  console.log(`Synced ${editors.length} editors`);
  return editors.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    // Verify user
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
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin").maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { spreadsheet_id, sheet_name } = await req.json();
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sheetParam = sheet_name || "Sheet1";
    const accessToken = await getAccessToken(serviceAccountKey);

    // Sync editors from the Editors tab
    const editorsSynced = await syncEditors(
      adminClient, accessToken, spreadsheet_id, "thomas.punzel@atolls.com"
    );

    // Fetch the editors list to identify account managers
    const { data: editorsList } = await adminClient.from("editors").select("email, role");
    const editorEmailSet = new Set((editorsList || []).map(e => e.email.toLowerCase()));

    // Fetch main sheet data
    const rows = await fetchSheet(accessToken, spreadsheet_id, sheetParam);

    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Sheet has no data rows", synced: 0, editors_synced: editorsSynced }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = rows[0].map((h: string) => h.trim().toLowerCase());
    console.log("Sheet headers:", JSON.stringify(headers));
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

      // Set assigned_email from retailer_assignment
      if (record.retailer_assignment) {
        const emails = record.retailer_assignment.split(",").map(e => e.trim().toLowerCase());
        // Use first assigned email as primary
        if (emails.length > 0 && emails[0].includes("@")) {
          record.assigned_email = emails[0];
        }
      }

      return record;
    });

    // Clear and re-insert
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

    // Now mark which assigned emails are account managers (not in editors list)
    // by checking against the editors table
    const assignedEmails = [...new Set(issues.map(i => i.assigned_email).filter(Boolean))];
    const accountManagers = assignedEmails.filter(e => !editorEmailSet.has(e));

    // Insert account managers into editors table
    if (accountManagers.length > 0) {
      const amRecords = accountManagers.map(email => ({
        email,
        role: "account_manager",
      }));
      await adminClient.from("editors").upsert(amRecords, { onConflict: "email", ignoreDuplicates: true });
      console.log(`Added ${accountManagers.length} account managers`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: inserted,
        editors_synced: editorsSynced,
        account_managers: accountManagers.length,
        sheet: sheetParam,
      }),
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
