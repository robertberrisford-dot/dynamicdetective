import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20; // rows per invocation (keeps every call well under edge function wall time)
const TIMEOUT_MS = 5000; // 5s timeout per URL
const CONCURRENCY = 10; // Check 10 URLs in parallel

function sheetRange(sheetName: string, range: string) {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${range}`;
}

async function fetchSheetValues(spreadsheetId: string, accessToken: string, range: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Sheet API error: ${await res.text()}`);
  const data = await res.json();
  return (data.values || []) as unknown[][];
}

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

async function checkUrlsConcurrently(
  vouchers: Array<{ voucher_id_pool: string; redirect_url: string; retailer_pool_id: string; client_name: string; voucher_title: string; assigned_email: string | null }>,
  batchId: string,
  spreadsheetId: string,
  sheetName: string,
) {
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < vouchers.length; i += CONCURRENCY) {
    const chunk = vouchers.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (voucher) => {
        const result = await checkUrl(voucher.redirect_url);
        const isError = (result.status !== null && (result.status === 404 || result.status >= 500));
        return {
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
        };
      })
    );
    results.push(...chunkResults);
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("check-urls invoked");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roleData } = await adminClient
        .from("user_roles").select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "ops_lead"])
        .maybeSingle();
      if (!roleData) {
        return new Response(JSON.stringify({ error: "Admin or ops lead access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const spreadsheetId = body.spreadsheet_id || "1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4";
    const sheetName = body.sheet_name || "MYDEAL_DE_API_Vouchers (Preset)";
    const batchId = body.batch_id || new Date().toISOString().slice(0, 10);
    const maxVouchers = Math.max(0, Number(body.limit || 0));
    const startRow = Math.max(2, Number(body.start_row || 2));
    const rowLimit = Math.min(BATCH_SIZE, Math.max(1, Number(body.row_limit || BATCH_SIZE)));
    const endRow = startRow + rowLimit - 1;

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

    const headerRows = await fetchSheetValues(spreadsheetId, accessToken, sheetRange(sheetName, "1:1"));
    const rows = await fetchSheetValues(spreadsheetId, accessToken, sheetRange(sheetName, `${startRow}:${endRow}`));

    if (headerRows.length < 1) {
      return new Response(JSON.stringify({ done: true, checked_this_batch: 0, total_checked: 0, total_to_check: 0, next_start_row: startRow }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers2 = headerRows[0].map((h: unknown) => String(h).trim().toLowerCase());
    const urlIdx = headers2.indexOf("voucher_url_redirect");
    const poolIdx = headers2.indexOf("voucher_id_pool");
    const activeIdx = headers2.indexOf("is_voucher_active");
    const retailerPoolIdx = headers2.indexOf("merchant_id_pool");
    const clientIdx = headers2.indexOf("merchant_name");
    const titleIdx = headers2.indexOf("voucher_title");

    if (urlIdx === -1) {
      return new Response(JSON.stringify({ error: "voucher_url_redirect column not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch retailer assignments
    const retailerMap = new Map<string, string>();
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data: retailersData } = await adminClient
        .from("retailers").select("retailer_pool_id, retailer_assignment")
        .range(offset, offset + PAGE_SIZE - 1);
      if (!retailersData || retailersData.length === 0) break;
      retailersData.forEach(r => {
        if (r.retailer_pool_id && r.retailer_assignment) {
          retailerMap.set(r.retailer_pool_id, r.retailer_assignment);
        }
      });
      if (retailersData.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const { data: editorsList } = await adminClient.from("editors").select("email, role");
    const editorRoleMap = new Map<string, string>();
    (editorsList || []).forEach(e => {
      if (e.role === "editor" || e.role === "team_lead") {
        editorRoleMap.set(e.email.toLowerCase(), e.role);
      }
    });

    const vouchersToCheck: {
      voucher_id_pool: string;
      redirect_url: string;
      retailer_pool_id: string;
      client_name: string;
      voucher_title: string;
      assigned_email: string | null;
    }[] = [];
    let eligibleRowsSeen = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isActive = activeIdx >= 0 ? row[activeIdx] : null;
      if (isActive !== true && isActive !== "true" && isActive !== "TRUE" && isActive !== 1) continue;
      const redirectUrl = String(row[urlIdx] || "").trim();
      if (!redirectUrl || !redirectUrl.startsWith("http")) continue;
      eligibleRowsSeen++;
      if (maxVouchers > 0 && eligibleRowsSeen > maxVouchers) break;
      const voucherPool = poolIdx >= 0 ? String(row[poolIdx] || "") : "";
      const rpid = retailerPoolIdx >= 0 ? String(row[retailerPoolIdx] || "") : "";
      const client = clientIdx >= 0 ? String(row[clientIdx] || "") : "";
      const title = titleIdx >= 0 ? String(row[titleIdx] || "") : "";
      let assignedEmail: string | null = null;
      if (rpid && retailerMap.has(rpid)) {
        const assignment = retailerMap.get(rpid)!;
        const emails = assignment.split(",").map(e => e.trim().toLowerCase());
        // Prefer plain editors over team_leads, then any known editor, then first email
        const editorEmail = emails.find(e => editorRoleMap.get(e) === "editor")
          || emails.find(e => editorRoleMap.has(e));
        assignedEmail = editorEmail || emails[0] || null;
      }
      vouchersToCheck.push({ voucher_id_pool: voucherPool, redirect_url: redirectUrl, retailer_pool_id: rpid, client_name: client, voucher_title: title, assigned_email: assignedEmail });
    }

    const { data: alreadyChecked } = await adminClient
      .from("url_check_results")
      .select("voucher_id_pool")
      .eq("batch_id", batchId);

    const checkedSet = new Set((alreadyChecked || []).map(r => r.voucher_id_pool));

    // Skip vouchers that have a resolved broken_redirect_url issue — don't recreate them
    const allVoucherPools = vouchersToCheck.map(v => v.voucher_id_pool).filter(Boolean);
    const resolvedSet = new Set<string>();
    for (let i = 0; i < allVoucherPools.length; i += 500) {
      const batch = allVoucherPools.slice(i, i + 500);
      const { data: resolvedIssues } = await adminClient
        .from("issues")
        .select("voucher_id_pool")
        .eq("issue_type", "broken_redirect_url")
        .eq("status", "resolved")
        .in("voucher_id_pool", batch);
      (resolvedIssues || []).forEach(r => { if (r.voucher_id_pool) resolvedSet.add(r.voucher_id_pool); });
    }
    console.log(`Skipping ${resolvedSet.size} vouchers with resolved broken_redirect_url issues`);

    const remaining = vouchersToCheck.filter(v => !checkedSet.has(v.voucher_id_pool) && !resolvedSet.has(v.voucher_id_pool));

    console.log(`Total: ${vouchersToCheck.length}, checked: ${checkedSet.size}, remaining: ${remaining.length}`);

    const batch = remaining.slice(0, BATCH_SIZE);
    const results = await checkUrlsConcurrently(batch, batchId, spreadsheetId, sheetName);

    if (results.length > 0) {
      const dbResults = results.map(({ voucher_title, ...rest }) => rest);
      const { error: insertError } = await adminClient.from("url_check_results").insert(dbResults);
      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

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
        retailer_url: r.redirect_url,
        sheet_id: r.sheet_id,
        sheet_name: r.sheet_name,
        status: "open",
      }));
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
