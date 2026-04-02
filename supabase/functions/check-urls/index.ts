import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50; // URLs per invocation to avoid timeout
const TIMEOUT_MS = 8000; // 8s timeout per URL

async function checkUrl(url: string): Promise<{ status: number | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "AuditTracker/1.0" },
    });
    clearTimeout(timeout);
    return { status: res.status, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("abort")) {
      return { status: null, error: "timeout" };
    }
    return { status: null, error: message };
  }
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

    // Verify user is admin
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

    const body = await req.json();
    const spreadsheetId = body.spreadsheet_id || "1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4";
    const sheetName = body.sheet_name || "MYDEAL_DE_API_Vouchers (Preset)";
    // batch_id is a date-based string so we can resume
    const batchId = body.batch_id || new Date().toISOString().slice(0, 10);
    const maxVouchers = body.limit || 0; // 0 = no limit

    // Get the Google Sheet data via the service account
    const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!serviceAccountKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get access token
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
    const accessToken = tokenData.access_token;

    // Fetch sheet
    const range = `'${sheetName}'`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const sheetRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!sheetRes.ok) throw new Error(`Sheet API error: ${await sheetRes.text()}`);
    const sheetData = await sheetRes.json();
    const rows: string[][] = sheetData.values || [];

    if (rows.length < 2) {
      return new Response(JSON.stringify({ done: true, checked: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = rows[0].map((h: unknown) => String(h).trim().toLowerCase());
    const urlIdx = headers.indexOf("voucher_url_redirect");
    const poolIdx = headers.indexOf("voucher_id_pool");
    const activeIdx = headers.indexOf("is_voucher_active");
    const retailerPoolIdx = headers.indexOf("merchant_id_pool");
    const clientIdx = headers.indexOf("merchant_name");
    const titleIdx = headers.indexOf("voucher_title");

    if (urlIdx === -1) {
      return new Response(JSON.stringify({ error: "voucher_url_redirect column not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch retailer assignments for email lookup
    const { data: retailersData } = await adminClient
      .from("retailers").select("retailer_pool_id, retailer_assignment");
    const retailerMap = new Map<string, string>();
    (retailersData || []).forEach(r => {
      if (r.retailer_pool_id && r.retailer_assignment) {
        retailerMap.set(r.retailer_pool_id, r.retailer_assignment);
      }
    });

    const { data: editorsList } = await adminClient.from("editors").select("email, role");
    const editorEmailSet = new Set((editorsList || []).filter(e => e.role === "editor" || e.role === "team_lead").map(e => e.email.toLowerCase()));

    // Build list of active vouchers with URLs
    const vouchersToCheck: {
      voucher_id_pool: string;
      redirect_url: string;
      retailer_pool_id: string;
      client_name: string;
      voucher_title: string;
      assigned_email: string | null;
    }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const isActive = activeIdx >= 0 ? row[activeIdx] : null;
      if (isActive !== true && isActive !== "true" && isActive !== "TRUE" && isActive !== 1) continue;

      const redirectUrl = String(row[urlIdx] || "").trim();
      if (!redirectUrl || !redirectUrl.startsWith("http")) continue;

      const voucherPool = poolIdx >= 0 ? String(row[poolIdx] || "") : "";
      const rpid = retailerPoolIdx >= 0 ? String(row[retailerPoolIdx] || "") : "";
      const client = clientIdx >= 0 ? String(row[clientIdx] || "") : "";
      const title = titleIdx >= 0 ? String(row[titleIdx] || "") : "";

      let assignedEmail: string | null = null;
      if (rpid && retailerMap.has(rpid)) {
        const assignment = retailerMap.get(rpid)!;
        const emails = assignment.split(",").map(e => e.trim().toLowerCase());
        const editorEmail = emails.find(e => editorEmailSet.has(e));
        assignedEmail = editorEmail || emails[0] || null;
      }

      vouchersToCheck.push({
        voucher_id_pool: voucherPool,
        redirect_url: redirectUrl,
        retailer_pool_id: rpid,
        client_name: client,
        voucher_title: title,
        assigned_email: assignedEmail,
      });
    }

    // Apply limit if specified
    if (maxVouchers > 0 && vouchersToCheck.length > maxVouchers) {
      vouchersToCheck.length = maxVouchers;
    }

    // Find already-checked voucher_id_pools for this batch (resume support)
    const { data: alreadyChecked } = await adminClient
      .from("url_check_results")
      .select("voucher_id_pool")
      .eq("batch_id", batchId);

    const checkedSet = new Set((alreadyChecked || []).map(r => r.voucher_id_pool));
    const remaining = vouchersToCheck.filter(v => !checkedSet.has(v.voucher_id_pool));

    console.log(`Total active with URLs: ${vouchersToCheck.length}, already checked: ${checkedSet.size}, remaining: ${remaining.length}`);

    // Take next batch
    const batch = remaining.slice(0, BATCH_SIZE);
    const results: Record<string, unknown>[] = [];

    for (const voucher of batch) {
      const result = await checkUrl(voucher.redirect_url);
      const isError = result.error !== null || (result.status !== null && result.status >= 400);
      results.push({
        voucher_id_pool: voucher.voucher_id_pool,
        retailer_pool_id: voucher.retailer_pool_id,
        client_name: voucher.client_name,
        voucher_title: voucher.voucher_title,
        assigned_email: voucher.assigned_email,
        redirect_url: voucher.redirect_url,
        http_status: result.status,
        error_message: result.error,
        is_error: isError,
        batch_id: batchId,
        sheet_id: spreadsheetId,
        sheet_name: sheetName,
      });
    }

    // Insert results
    if (results.length > 0) {
      const { error: insertError } = await adminClient.from("url_check_results").insert(results);
      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

    // Create issues for errors
    const errors = results.filter(r => r.is_error);
    if (errors.length > 0) {
      const issueRecords = errors.map(r => ({
        voucher_id_pool: r.voucher_id_pool,
        retailer_pool_id: r.retailer_pool_id,
        client_name: r.client_name,
        assigned_email: r.assigned_email,
        issue_type: "broken_redirect_url",
        voucher_title: r.voucher_title,
        voucher_description: `HTTP ${r.http_status || 'N/A'}: ${r.error_message || 'Error'}`,
        sheet_id: r.sheet_id,
        sheet_name: r.sheet_name,
        status: "open",
      }));

      // Upsert: delete existing broken_redirect_url issues for these vouchers first
      const poolIds = issueRecords.map(r => r.voucher_id_pool).filter(Boolean) as string[];
      if (poolIds.length > 0) {
        await adminClient.from("issues").delete()
          .eq("issue_type", "broken_redirect_url")
          .in("voucher_id_pool", poolIds);
      }

      const { error: issueError } = await adminClient.from("issues").insert(issueRecords);
      if (issueError) console.error("Issue insert error:", issueError);
    }

    const done = remaining.length <= BATCH_SIZE;
    const totalChecked = checkedSet.size + batch.length;

    return new Response(
      JSON.stringify({
        success: true,
        batch_id: batchId,
        checked_this_batch: batch.length,
        errors_found: errors.length,
        total_checked: totalChecked,
        total_to_check: vouchersToCheck.length,
        done,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("URL check error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
