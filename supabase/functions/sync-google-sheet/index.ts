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
  "voucher_position": "voucher_position",
  "voucher_terms_and_conditions": "voucher_terms_and_conditions",
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
  _teamLeadEmail: string,
  editorsSheetName: string = "Editors",
  countryCode: string = "de"
) {
  let rows: string[][];
  try {
    rows = await fetchSheet(accessToken, spreadsheetId, editorsSheetName);
  } catch (e) {
    console.log(`Could not fetch ${editorsSheetName} tab, skipping:`, e);
    return 0;
  }
  if (rows.length < 2) return 0;

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const countryIdx = headers.findIndex(h => h === "country" || h.includes("country"));
  const emailIdx = headers.findIndex(h => h.includes("mail") || h === "email" || h === "e-mail");
  const nameIdx = headers.findIndex(h => h === "name" || h.includes("name"));
  const roleIdx = headers.findIndex(h => h === "role" || h.includes("role"));
  const tlEmailIdx = headers.findIndex(h => h === "team_lead_email" || h === "team_lead" || h.includes("team_lead_email"));

  if (emailIdx === -1) return 0;

  const normalizedCountry = countryCode.toLowerCase();
  const uniqueEditors = new Map<string, { email: string; name: string | null; role: string; team_lead_email: string | null }>();

  // Track the most recently seen team_lead row so editor rows listed BELOW a team_lead
  // (without an explicit team_lead_email column) can be auto-linked to that team_lead.
  let lastSeenTeamLead: string | null = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowCountry = countryIdx >= 0 ? String(row[countryIdx] || "").trim().toLowerCase() : normalizedCountry;
    if (rowCountry && rowCountry !== normalizedCountry) continue;

    const email = String(row[emailIdx] || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() || null : null;
    const sheetRole = roleIdx >= 0 ? String(row[roleIdx] || "").trim().toLowerCase() : "";
    const explicitTlEmail = tlEmailIdx >= 0 ? String(row[tlEmailIdx] || "").trim().toLowerCase() || null : null;

    let role = "editor";
    if (sheetRole.includes("ops") && sheetRole.includes("lead")) role = "ops_lead";
    else if (sheetRole.includes("team") && sheetRole.includes("lead")) role = "team_lead";
    else if (sheetRole.includes("lead") || sheetRole.includes("manager")) role = "team_lead";

    // Refresh the "current lead" pointer whenever we hit a team_lead OR ops_lead row.
    // Editor rows listed below an ops_lead in the sheet should be auto-linked to that ops_lead.
    if (role === "team_lead" || role === "ops_lead") lastSeenTeamLead = email;

    const assignedTeamLeadEmail = role === "editor"
      ? (explicitTlEmail || lastSeenTeamLead || null)
      : null;

    uniqueEditors.set(email, { email, name, role, team_lead_email: assignedTeamLeadEmail });
  }

  for (const ed of uniqueEditors.values()) {
    const { data: existing } = await adminClient
      .from("editors")
      .select("name, team_lead_email")
      .eq("email", ed.email)
      .maybeSingle();

    const upsertData: Record<string, unknown> = {
      email: ed.email,
      role: ed.role,
      country: countryCode,
    };
    // Preserve manually-set team_lead_email: only write it when we have a new value.
    // Never overwrite an existing assignment with NULL.
    if (ed.team_lead_email) {
      upsertData.team_lead_email = ed.team_lead_email;
    } else if (existing && (existing as any).team_lead_email) {
      // keep existing — don't include the field in upsert
    } else {
      upsertData.team_lead_email = null;
    }
    if (!existing || !existing.name) {
      upsertData.name = ed.name;
    }

    await adminClient.from("editors").upsert(upsertData, { onConflict: "email" });
  }

  const sheetEmails = new Set(uniqueEditors.keys());
  const { data: existingCountryEditors } = await adminClient
    .from("editors")
    .select("email")
    .eq("country", countryCode);

  for (const existing of existingCountryEditors || []) {
    const email = String(existing.email || "").toLowerCase();
    if (email && !sheetEmails.has(email)) {
      await adminClient.from("editors").delete().eq("country", countryCode).eq("email", email);
    }
  }

  console.log(`Synced ${uniqueEditors.size} editors for ${countryCode}`);
  return uniqueEditors.size;
}

async function syncRetailers(
  adminClient: ReturnType<typeof createClient>,
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  countryCode: string
) {
  const rows = await fetchSheet(accessToken, spreadsheetId, sheetName);
  if (rows.length < 2) {
    console.log(`No retailer rows found for ${countryCode} in ${sheetName}`);
    return 0;
  }

  const headerMap: Record<string, string> = {
    "old merchant id": "old_merchant_id",
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
    "client": "client",
    "country": "country",
    "keyword 1": "keyword_1",
    "keyword 2": "keyword_2",
    "keyword 3": "keyword_3",
    "keyword 4": "keyword_4",
    "categories": "categories",
    "retailer assignment": "retailer_assignment",
    "dynamic vouchers": "dynamic_vouchers",
  };

  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const records: Record<string, unknown>[] = [];

  for (const row of rows.slice(1)) {
    const record: Record<string, unknown> = { country: countryCode };
    headers.forEach((header, idx) => {
      const dbCol = headerMap[header];
      if (dbCol && row[idx] !== undefined && row[idx] !== null && String(row[idx]).trim() !== "") {
        record[dbCol] = String(row[idx]).trim();
      }
    });

    const poolId = String(record.retailer_pool_id || "").trim();
    if (!poolId) continue;
    if (!record.country) record.country = countryCode;
    records.push(record);
  }

  await adminClient.from("retailers").delete().eq("country", countryCode);

  // Dedupe by retailer_pool_id (keep last occurrence) to avoid ON CONFLICT errors
  const dedupedMap = new Map<string, Record<string, unknown>>();
  for (const r of records) {
    dedupedMap.set(String(r.retailer_pool_id), r);
  }
  const dedupedRecords = Array.from(dedupedMap.values());

  for (let i = 0; i < dedupedRecords.length; i += 200) {
    const batch = dedupedRecords.slice(i, i + 200);
    const { error } = await adminClient.from("retailers").upsert(batch, { onConflict: "retailer_pool_id" });
    if (error) {
      throw new Error(`Retailer sync failed for ${countryCode}: ${error.message}`);
    }
  }


  console.log(`Synced ${records.length} retailers for ${countryCode}`);
  return records.length;
}

async function assignEditorTeamLeadsFromRetailers(
  adminClient: ReturnType<typeof createClient>,
  countryCode: string,
) {
  const { data: editors } = await adminClient
    .from("editors")
    .select("email, role")
    .eq("country", countryCode);

  const editorEmails = new Set((editors || []).filter(e => e.role === "editor").map(e => String(e.email).toLowerCase()));
  const teamLeadEmails = new Set((editors || []).filter(e => e.role === "team_lead").map(e => String(e.email).toLowerCase()));
  const pairCounts = new Map<string, number>();

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: retailers } = await adminClient
      .from("retailers")
      .select("retailer_assignment")
      .eq("country", countryCode)
      .eq("page_published", "PUBLISHED")
      .range(from, from + pageSize - 1);

    if (!retailers || retailers.length === 0) break;

    for (const retailer of retailers) {
      const emails = String(retailer.retailer_assignment || "")
        .split(",")
        .map(email => email.trim().toLowerCase())
        .filter(email => email.includes("@"));

      const assignedEditors = emails.filter(email => editorEmails.has(email));
      const assignedTeamLeads = emails.filter(email => teamLeadEmails.has(email));

      for (const editorEmail of assignedEditors) {
        for (const teamLeadEmail of assignedTeamLeads) {
          const key = `${editorEmail}|${teamLeadEmail}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    if (retailers.length < pageSize) break;
    from += pageSize;
  }

  const bestByEditor = new Map<string, { teamLeadEmail: string; count: number }>();
  for (const [key, count] of pairCounts.entries()) {
    const [editorEmail, teamLeadEmail] = key.split("|");
    const current = bestByEditor.get(editorEmail);
    if (!current || count > current.count) {
      bestByEditor.set(editorEmail, { teamLeadEmail, count });
    }
  }

  for (const [editorEmail, assignment] of bestByEditor.entries()) {
    await adminClient
      .from("editors")
      .update({ team_lead_email: assignment.teamLeadEmail })
      .eq("country", countryCode)
      .eq("email", editorEmail)
      .eq("role", "editor");
  }

  console.log(`Assigned team leads for ${bestByEditor.size} editors from retailer assignments (${countryCode})`);
  return bestByEditor.size;
}

function hasNumericValue(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  const s = String(val).trim();
  if (s === "") return false;
  // Strip currency symbols and whitespace, normalize comma decimals
  const cleaned = s.replace(/[€$£%\s]/g, "").replace(",", ".");
  if (!cleaned || cleaned === "0" || cleaned === "0.0" || cleaned === "0.00") return false;
  // Check if there's any digit and a valid number can be extracted
  if (!/\d/.test(cleaned)) return false;
  // Try to extract a number from anywhere in the string
  const match = cleaned.match(/(\d+\.?\d*)/);
  return match !== null && parseFloat(match[1]) !== 0;
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

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Allow service role key to bypass admin check (for scheduled invocations)
    const _token = authHeader.replace(/^Bearer\s+/i, "");
    let isServiceRole = _token === supabaseServiceKey;
    if (!isServiceRole) {
      try {
        const payloadB64 = _token.split(".")[1];
        if (payloadB64) {
          const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payloadB64.length / 4) * 4, "=");
          const claims = JSON.parse(atob(padded));
          if (claims?.role === "service_role") isServiceRole = true;
        }
      } catch (_) { /* ignore */ }
    }
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

      const { data: hasAccess, error: roleError } = await adminClient.rpc("has_any_role", {
        _user_id: user.id,
        _roles: ["admin", "ops_lead"],
      });

      if (roleError) {
        console.error("Role lookup failed:", roleError);
        return new Response(JSON.stringify({ error: "Failed to verify permissions" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Admin or Ops Lead access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = await req.json();
    } catch (e) {
      console.error("Failed to parse request body:", e);
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { spreadsheet_id, sheet_name, country_code } = parsedBody as { spreadsheet_id?: string; sheet_name?: string; country_code?: string };
    console.log("Received body:", JSON.stringify({ spreadsheet_id, sheet_name, country_code }));
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sheetParam = sheet_name || "MYDEAL_DE_API_Vouchers (Preset)";
    const countryCode = country_code || "de";
    const accessToken = await getAccessToken(serviceAccountKey);

    // Fetch country config for editors and retailers
    const { data: countryConfig } = await adminClient
      .from("country_configs")
      .select("editors_sheet_name, team_lead_email, retailer_spreadsheet_id, retailer_sheet_name, igraal_retailer_sheet_name, igraal_voucher_sheet_name")
      .eq("country_code", countryCode)
      .maybeSingle();

    const editorsSheetName = countryConfig?.editors_sheet_name || "Editors";
    const teamLeadEmail = countryConfig?.team_lead_email || "";
    const retailerSpreadsheetId = countryConfig?.retailer_spreadsheet_id || spreadsheet_id;
    const retailerSheetName = countryConfig?.retailer_sheet_name;

    if (!retailerSheetName) {
      throw new Error(`Retailer sheet is not configured for ${countryCode}`);
    }

    const retailersSynced = await syncRetailers(
      adminClient,
      accessToken,
      retailerSpreadsheetId,
      retailerSheetName,
      countryCode,
    );

    const editorsSynced = await syncEditors(
      adminClient,
      accessToken,
      retailerSpreadsheetId,
      teamLeadEmail,
      editorsSheetName,
      countryCode,
    );
    const editorTeamLeadsAssigned = await assignEditorTeamLeadsFromRetailers(adminClient, countryCode);

    let allRetailers: { retailer_pool_id: string | null; retailer_assignment: string | null; seo_url: string | null; client_name: string | null }[] = [];
    let rFrom = 0;
    const rPageSize = 1000;
    while (true) {
      const { data: rPage } = await adminClient
        .from("retailers")
        .select("retailer_pool_id, retailer_assignment, seo_url, client_name")
        .eq("page_published", "PUBLISHED")
        .eq("country", countryCode)
        .range(rFrom, rFrom + rPageSize - 1);
      if (!rPage || rPage.length === 0) break;
      allRetailers = allRetailers.concat(rPage);
      if (rPage.length < rPageSize) break;
      rFrom += rPageSize;
    }
    const retailerMap = new Map<string, { assignment: string; seo_url: string | null; client_name: string | null }>();
    allRetailers.forEach(r => {
      if (r.retailer_pool_id) {
        retailerMap.set(r.retailer_pool_id, {
          assignment: r.retailer_assignment || "",
          seo_url: r.seo_url || null,
          client_name: r.client_name || null,
        });
      }
    });
    console.log(`Loaded ${retailerMap.size} retailers for assignment lookup (${countryCode}); synced ${retailersSynced} retailers from ${retailerSheetName}`);

    // Fetch editor info for assignment lookup
    const { data: editorsList } = await adminClient.from("editors").select("email, role, team_lead_email").eq("country", countryCode);
    const editorEmailSet = new Set((editorsList || []).filter(e => e.role === "editor" || e.role === "team_lead").map(e => e.email.toLowerCase()));

    // Fetch voucher sheet
    const rows = await fetchSheet(accessToken, spreadsheet_id, sheetParam);
    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "Sheet has no data rows", synced: 0, editors_synced: editorsSynced, editor_team_leads_assigned: editorTeamLeadsAssigned }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = rows[0].map((h: unknown) => String(h).trim().toLowerCase());
    console.log("Voucher sheet headers:", JSON.stringify(headers));
    const dataRows = rows.slice(1);

    // Process vouchers — collect all parsed records
    const allRecords: Record<string, unknown>[] = [];

    for (const row of dataRows) {
      const record: Record<string, unknown> = {
        sheet_id: spreadsheet_id,
        sheet_name: sheetParam,
        status: "open",
        country: countryCode,
      };

      headers.forEach((header: string, idx: number) => {
        const dbCol = VOUCHER_COLUMN_MAP[header];
        if (dbCol && row[idx] !== undefined && row[idx] !== null) {
          record[dbCol] = row[idx];
        }
        // Store non-DB columns for processing only (prefixed with _)
        if (header === "voucher_automatic_extension_type" && row[idx] !== undefined) {
          record._extension_type = row[idx];
        }
        if (header === "voucher_started_at" && row[idx] !== undefined) {
          record._started_at = row[idx];
        }
        if (header === "is_voucher_manual_pick" && row[idx] !== undefined) {
          record._manual_pick = row[idx];
        }
        if (header === "voucher_url_redirect" && row[idx] !== undefined) {
          record._redirect_url = row[idx];
        }
      });

      // Convert is_voucher_active to boolean
      if (record.is_voucher_active !== undefined) {
        record.is_voucher_active = record.is_voucher_active === true || record.is_voucher_active === "true" || record.is_voucher_active === "TRUE" || record.is_voucher_active === 1;
      }

      // Look up assignment from retailers table (only published retailers are in the map)
      const poolId = String(record.retailer_pool_id || "");
      if (poolId && retailerMap.has(poolId)) {
        const retailerInfo = retailerMap.get(poolId)!;
        record.retailer_assignment = retailerInfo.assignment;
        record.seo_url = retailerInfo.seo_url;
        if (retailerInfo.assignment) {
          const emails = retailerInfo.assignment.split(",").map(e => e.trim().toLowerCase());
          const editorEmail = emails.find(e => {
            const ed = editorsList?.find(ed => ed.email.toLowerCase() === e);
            return ed && ed.role === "editor";
          });
          record.assigned_email = editorEmail || emails.find(e => editorEmailSet.has(e)) || emails[0];
        }
        allRecords.push(record);
      }
      // Skip vouchers from unpublished retailers (not in retailerMap)
    }

    // Only consider ACTIVE vouchers on PUBLISHED retailers for all issue checks.
    // (Published filter already applied above via retailerMap; expired/inactive vouchers
    // are excluded here. Any future "expired vouchers" check should be added separately.)
    const activeRecords = allRecords.filter(r => r.is_voucher_active === true);
    console.log(`Active vouchers on published retailers: ${activeRecords.length} of ${allRecords.length}`);

    // === Load enabled-checks config so we can skip heavy checks that are turned off ===
    const { data: __checkCfgs } = await adminClient
      .from("check_configs")
      .select("issue_type, enabled")
      .eq("country_code", countryCode);
    const disabledChecks = new Set(
      (__checkCfgs || []).filter((c: any) => c.enabled === false).map((c: any) => c.issue_type)
    );
    const checkEnabled = (t: string) => !disabledChecks.has(t);
    console.log(`Disabled checks for ${countryCode}: ${[...disabledChecks].join(", ") || "(none)"}`);

    // === Check 1: Non-Numerical Caption 1 (voucher-level) ===
    const issues: Record<string, unknown>[] = [];

    if (checkEnabled("missing_caption_1")) {
      for (const record of activeRecords) {
        if (!hasNumericValue(record.voucher_caption_1)) {
          issues.push({ ...record, issue_type: "missing_caption_1" });
        }
      }
    }

    // === Check 1b: Automatic Source Review (vouchers that went live yesterday with source=automatic) ===
    // Persists across syncs until status is set to resolved/wont_fix — we re-emit any
    // existing open/in_progress issues whose voucher is still active.
    if (checkEnabled("automatic_source_review")) {
      // Compute "yesterday" date string (UTC) for matching voucher_started_at
      const _today = new Date();
      const _yesterday = new Date(_today.getTime() - 86400000);
      const _yStr = _yesterday.toISOString().split("T")[0];

      // Fetch existing unresolved issues for this type+sheet so we can carry them forward
      const carryForwardVids = new Set<string>();
      try {
        const { data: existingAuto } = await adminClient
          .from("issues")
          .select("voucher_id_pool, status")
          .eq("country", countryCode)
          .eq("sheet_id", spreadsheet_id)
          .eq("sheet_name", sheetParam)
          .eq("issue_type", "automatic_source_review")
          .in("status", ["open", "in_progress"]);
        for (const e of existingAuto || []) {
          const vid = String((e as any).voucher_id_pool || "").trim();
          if (vid) carryForwardVids.add(vid);
        }
      } catch (e) {
        console.error("automatic_source_review carry-forward fetch failed:", e);
      }

      let autoCount = 0;
      for (const record of activeRecords) {
        const src = String(record.voucher_source || "").trim().toLowerCase();
        if (src !== "automatic") continue;

        // Parse start date — UK sheet stores the ISO timestamp in voucher_automatic_extension_type
        // (column AF) rather than voucher_started_at (column AE, which holds booleans).
        // Fall back to _extension_type when _started_at is missing/non-date.
        const parseStart = (raw: unknown): string => {
          if (raw === undefined || raw === null || raw === "") return "";
          const s = String(raw).trim();
          if (s === "" || s.toLowerCase() === "true" || s.toLowerCase() === "false") return "";
          let sd: Date | null = null;
          if (typeof raw === "number" || /^\d+(\.\d+)?$/.test(s)) {
            const epoch = new Date(1899, 11, 30);
            sd = new Date(epoch.getTime() + Number(s) * 86400000);
          } else {
            const d = new Date(s);
            if (!isNaN(d.getTime())) sd = d;
          }
          return sd ? sd.toISOString().split("T")[0] : "";
        };
        let startStr = parseStart(record._started_at);
        if (!startStr) startStr = parseStart(record._extension_type);

        const isYesterday = startStr === _yStr;
        const vid = String(record.voucher_id_pool || "").trim();
        const carryForward = vid && carryForwardVids.has(vid);
        if (!isYesterday && !carryForward) continue;

        autoCount++;
        const cleanRecord = { ...record };
        delete cleanRecord._extension_type;
        delete cleanRecord._started_at;
        delete cleanRecord._manual_pick;
        delete cleanRecord._redirect_url;
        cleanRecord.voucher_start_date = startStr || null;
        issues.push({
          ...cleanRecord,
          issue_type: "automatic_source_review",
          voucher_description:
            (startStr ? `Auto-generated voucher (source=automatic) started ${startStr}. ` : `Auto-generated voucher (source=automatic). `) +
            `Please review captions, title and T&Cs before they remain live.`,
        });
      }
      console.log(`Automatic source review (main, ${countryCode}): ${autoCount} vouchers flagged (carry-forward set size: ${carryForwardVids.size})`);
    }


    // === Check 2: Metas Without Values (retailer-level) ===
    // Group ACTIVE vouchers by retailer_pool_id
    const byRetailer = new Map<string, Record<string, unknown>[]>();
    for (const record of activeRecords) {
      const rpid = String(record.retailer_pool_id || "");
      if (!rpid) continue;
      if (!byRetailer.has(rpid)) byRetailer.set(rpid, []);
      byRetailer.get(rpid)!.push(record);
    }

    const isPoland = countryCode.toLowerCase() === "pl";
    const isUK = countryCode.toLowerCase() === "uk";
    for (const [rpid, vouchers] of byRetailer) {
      const pos1 = vouchers.find(v => String(v.voucher_position) === "1");
      const pos2 = vouchers.find(v => String(v.voucher_position) === "2");

      const pos1Missing = pos1 && !hasNumericValue(pos1.voucher_caption_1);
      const pos2Missing = pos2 && !hasNumericValue(pos2.voucher_caption_1);

      if (isUK) {
        // UK meta uses only position 1 caption_1.
        if (pos1Missing) {
          const issueRecord = { ...pos1! };
          issueRecord.issue_type = "metas_without_values";
          issueRecord.voucher_description = "Position 1 caption_1: " + (pos1!.voucher_caption_1 || "empty");
          issues.push(issueRecord);
        }
      } else if (isPoland) {
        // PL meta: %kw1% %voucher_1_caption1% + %higher_deal_caption% – %month% %year%
        // Slot 1 = pos1 caption_1 directly → always flag if non-numeric.
        if (pos1Missing) {
          const issueRecord = { ...pos1! };
          issueRecord.issue_type = "metas_without_values";
          issueRecord.voucher_description = "Position 1 caption_1: " + (pos1!.voucher_caption_1 || "empty");
          issues.push(issueRecord);
        }
        // Slot 2 = higher_deal_caption → only filled by deals (codes don't count).
        // Flag if pos1 is non-numeric AND no deal on the page has a numeric caption_1.
        if (pos1Missing) {
          const hasDealWithNumericCaption = vouchers.some(v => {
            const type = String(v.voucher_type || "").toLowerCase();
            return type.includes("deal") && hasNumericValue(v.voucher_caption_1);
          });
          if (!hasDealWithNumericCaption && pos2) {
            const issueRecord = { ...pos2 };
            issueRecord.issue_type = "metas_without_values";
            issueRecord.voucher_description = "higher_deal_caption slot: no deal with a numeric caption_1 available on this retailer";
            issues.push(issueRecord);
          }
        }
      } else {
        // DE: pos1 and pos2 caption_1 are used directly in the meta.
        if (pos1Missing) {
          const issueRecord = { ...pos1! };
          issueRecord.issue_type = "metas_without_values";
          issueRecord.voucher_description = "Position 1 caption_1: " + (pos1!.voucher_caption_1 || "empty");
          issues.push(issueRecord);
        }
        if (pos2Missing) {
          const issueRecord = { ...pos2! };
          issueRecord.issue_type = "metas_without_values";
          issueRecord.voucher_description = "Position 2 caption_1: " + (pos2!.voucher_caption_1 || "empty");
          issues.push(issueRecord);
        }
      }
    }

    // === Check 2b: Zero-value caption_1 at top position(s) ===
    // DE: positions 1 and 2 — PL/UK: position 1 only.
    // Flags vouchers whose caption_1 resolves numerically to 0 (e.g. "0", "0%", "0€", "0.00").
    const isZeroCaption = (val: unknown): boolean => {
      if (val === null || val === undefined) return false;
      const s = String(val).trim();
      if (s === "") return false;
      const cleaned = s.replace(/[€$£%\s]/g, "").replace(",", ".");
      if (!cleaned) return false;
      const match = cleaned.match(/^-?(\d+\.?\d*)$/);
      if (!match) return false;
      return parseFloat(match[1]) === 0;
    };
    const topPositions = (isPoland || isUK) ? ["1"] : ["1", "2"];
    for (const [rpid, vouchers] of byRetailer) {
      for (const posStr of topPositions) {
        const v = vouchers.find(x => String(x.voucher_position) === posStr);
        if (v && isZeroCaption(v.voucher_caption_1)) {
          const issueRecord = { ...v };
          issueRecord.issue_type = "zero_caption_top_position";
          issueRecord.voucher_description = `Position ${posStr} caption_1 is 0: "${v.voucher_caption_1}"`;
          issues.push(issueRecord);
        }
      }
    }


    // === Check 3: Repeated Caption 1 per retailer ===
    for (const [rpid, vouchers] of byRetailer) {
      // Count caption_1 occurrences (only active vouchers with non-empty caption)
      const captionCounts = new Map<string, Record<string, unknown>[]>();
      for (const v of vouchers) {
        const cap = String(v.voucher_caption_1 || "").trim();
        if (!cap) continue;
        if (!captionCounts.has(cap)) captionCounts.set(cap, []);
        captionCounts.get(cap)!.push(v);
      }

      for (const [caption, affectedVouchers] of captionCounts) {
        if (affectedVouchers.length > 3) {
          // Format caption for display: 0.1 → 10%, 0.05 → 5%
          const num = parseFloat(caption);
          const displayCaption = (!isNaN(num) && num > 0 && num < 1)
            ? `${Math.round(num * 100)}%`
            : caption;

          // Use first voucher as template for retailer-level info
          const template = affectedVouchers[0];
          const voucherList = affectedVouchers.map(v =>
            `• ${v.voucher_title || "Untitled"} (Pos ${v.voucher_position || "?"})`
          ).join("\n");

          issues.push({
            sheet_id: spreadsheet_id,
            sheet_name: sheetParam,
            status: "open",
            retailer_pool_id: template.retailer_pool_id,
            retailer_id: template.retailer_id,
            client_name: template.client_name,
            country: template.country,
            assigned_email: template.assigned_email,
            retailer_assignment: template.retailer_assignment,
            merchant_quality: template.merchant_quality,
            indexed: template.indexed,
            seo_url: template.seo_url,
            voucher_caption_1: caption,
            voucher_title: `Caption "${displayCaption}" repeated ${affectedVouchers.length}x`,
            voucher_description: voucherList,
            issue_type: "repeated_caption_1",
          });
        }
      }
    }

    // === Check 4: Repeated Caption 1+2 combo per retailer ===
    for (const [rpid, vouchers] of byRetailer) {
      const comboCounts = new Map<string, Record<string, unknown>[]>();
      for (const v of vouchers) {
        const cap1 = String(v.voucher_caption_1 || "").trim();
        const cap2 = String(v.voucher_caption_2 || "").trim();
        if (!cap1 && !cap2) continue;
        const comboKey = `${cap1}|||${cap2}`;
        if (!comboCounts.has(comboKey)) comboCounts.set(comboKey, []);
        comboCounts.get(comboKey)!.push(v);
      }

      for (const [comboKey, affectedVouchers] of comboCounts) {
        if (affectedVouchers.length > 3) {
          const [rawCap1, rawCap2] = comboKey.split("|||");
          const fmt = (v: string) => {
            const n = parseFloat(v);
            return (!isNaN(n) && n > 0 && n < 1) ? `${Math.round(n * 100)}%` : v;
          };
          const displayCap1 = rawCap1 ? fmt(rawCap1) : "empty";
          const displayCap2 = rawCap2 ? fmt(rawCap2) : "empty";

          const template = affectedVouchers[0];
          const voucherList = affectedVouchers.map(v =>
            `• ${v.voucher_title || "Untitled"} (Pos ${v.voucher_position || "?"})`
          ).join("\n");

          issues.push({
            sheet_id: spreadsheet_id,
            sheet_name: sheetParam,
            status: "open",
            retailer_pool_id: template.retailer_pool_id,
            retailer_id: template.retailer_id,
            client_name: template.client_name,
            country: template.country,
            assigned_email: template.assigned_email,
            retailer_assignment: template.retailer_assignment,
            merchant_quality: template.merchant_quality,
            indexed: template.indexed,
            seo_url: template.seo_url,
            voucher_caption_1: rawCap1 || null,
            voucher_caption_2: rawCap2 || null,
            voucher_title: `Captions "${displayCap1}" / "${displayCap2}" repeated ${affectedVouchers.length}x`,
            voucher_description: voucherList,
            issue_type: "repeated_caption_combo",
          });
        }
      }
    }

    // === Check 5: Stale Evergreen Vouchers (older than 180 days) ===
    const now = Date.now();
    const DAY_MS = 86400000;

    // Google Sheets serial date to JS Date (serial 1 = 1900-01-01, with the Lotus 1-2-3 bug)
    const serialToDate = (serial: number): Date => {
      const epoch = new Date(1899, 11, 30); // Dec 30, 1899
      return new Date(epoch.getTime() + serial * DAY_MS);
    };

    if (checkEnabled("stale_evergreen")) {
      let evergreenCount = 0;
      let staleCount = 0;
      for (const record of activeRecords) {
        const extType = String(record._extension_type || "").trim().toLowerCase();
        if (extType !== "evergreen") continue;
        evergreenCount++;
        const rawStarted = record._started_at;
        if (rawStarted === undefined || rawStarted === null || rawStarted === "") continue;

        let startDate: Date;
        if (typeof rawStarted === "number" || /^\d+(\.\d+)?$/.test(String(rawStarted).trim())) {
          startDate = serialToDate(Number(rawStarted));
        } else {
          startDate = new Date(String(rawStarted));
        }
        if (isNaN(startDate.getTime())) continue;

        const ageDays = Math.floor((now - startDate.getTime()) / DAY_MS);
        const startStr = startDate.toISOString().split("T")[0];
        if (ageDays > 180) {
          staleCount++;
          const cleanRecord = { ...record };
          delete cleanRecord._extension_type;
          delete cleanRecord._started_at;
          cleanRecord.voucher_start_date = startStr;
          issues.push({
            ...cleanRecord,
            issue_type: "stale_evergreen",
            voucher_description: `Evergreen voucher started ${startStr}, ${ageDays} days ago`,
          });
        }
      }
      console.log(`Evergreen check: ${evergreenCount} evergreen vouchers found, ${staleCount} older than 180 days`);
    } else {
      console.log("Evergreen check skipped (disabled)");
    }


    // === Check 6: Action-Based Codes (ABC) with missing/weak T&C ===
    let abcCount = 0;
    const tncPatterns = new Map<string, Record<string, unknown>[]>();

    for (const record of activeRecords) {
      const vType = String(record.voucher_type || "").trim().toLowerCase();
      const vCode = String(record.voucher_code || "").trim();
      if (vType !== "code" || !vCode.includes(" ")) continue;
      abcCount++;

      const tnc = String(record.voucher_terms_and_conditions || "").trim();
      const wordCount = tnc ? tnc.split(/\s+/).filter(w => w.length > 0).length : 0;

      // Sub-check A: Missing or very short T&C
      if (wordCount < 5) {
        issues.push({
          ...record,
          issue_type: "abc_missing_tnc",
          voucher_description: tnc
            ? `T&C has only ${wordCount} word(s): "${tnc}"`
            : "No terms and conditions provided",
        });
      }

      // Collect T&C for pattern detection
      if (tnc && wordCount >= 5) {
        // Normalize: lowercase, collapse whitespace
        const normalized = tnc.toLowerCase().replace(/\s+/g, " ").trim();
        if (!tncPatterns.has(normalized)) tncPatterns.set(normalized, []);
        tncPatterns.get(normalized)!.push(record);
      }
    }

    // Sub-check B: Repeated T&C patterns across ABC vouchers
    // Create one issue per affected voucher so editors get individual admin links
    for (const [pattern, affectedVouchers] of tncPatterns) {
      if (affectedVouchers.length > 3) {
        const preview = pattern.length > 80 ? pattern.substring(0, 80) + "…" : pattern;
        for (const v of affectedVouchers) {
          issues.push({
            sheet_id: spreadsheet_id,
            sheet_name: sheetParam,
            status: "open",
            retailer_pool_id: v.retailer_pool_id,
            client_name: v.client_name,
            assigned_email: v.assigned_email,
            retailer_assignment: v.retailer_assignment,
            merchant_quality: v.merchant_quality,
            indexed: v.indexed,
            seo_url: v.seo_url,
            voucher_id_pool: v.voucher_id_pool,
            voucher_title: v.voucher_title || "Untitled",
            voucher_position: v.voucher_position,
            voucher_terms_and_conditions: pattern,
            voucher_description: `Repeated T&C (${affectedVouchers.length}x): "${preview}"`,
            issue_type: "abc_repeated_tnc",
            country: v.country,
          });
        }
      }
    }
    console.log(`ABC check: ${abcCount} action-based codes found`);

    // === Check 6c: HTML in voucher Terms & Conditions ===
    // T&C is meant to be plain text. HTML tags or entities usually mean the editor
    // copied formatted content from the retailer website (often with hidden styling).
    if (checkEnabled("html_in_tnc")) {
      const htmlTagRe = /<\/?[a-z][a-z0-9]*\b[^<>]*>/i;
      const htmlEntityRe = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
      let htmlInTncCount = 0;
      for (const record of activeRecords) {
        const tnc = String(record.voucher_terms_and_conditions || "");
        if (!tnc) continue;
        const tagMatch = tnc.match(htmlTagRe);
        const entityMatch = tnc.match(htmlEntityRe);
        if (!tagMatch && !entityMatch) continue;
        htmlInTncCount++;
        const sample = (tagMatch?.[0] || entityMatch?.[0] || "").slice(0, 60);
        issues.push({
          ...record,
          issue_type: "html_in_tnc",
          voucher_description: `T&C contains HTML${tagMatch ? " tag" : " entity"}: "${sample}"`,
        });
      }
      console.log(`HTML in T&C check: ${htmlInTncCount} vouchers flagged`);
    } else {
      console.log("HTML in T&C check skipped (disabled)");
    }

    // === Check 6d: Past month name in voucher title ===
    // Flags titles containing the name of a month that has already passed in the current year
    // (Europe/Berlin). The current month is NOT flagged. Month names are matched per country.
    if (checkEnabled("past_month_in_title")) {
      const MONTHS_BY_COUNTRY: Record<string, string[][]> = {
        de: [
          ["Januar"], ["Februar"], ["März", "Maerz"], ["April"], ["Mai"], ["Juni"],
          ["Juli"], ["August"], ["September"], ["Oktober"], ["November"], ["Dezember"],
        ],
        uk: [
          ["January", "Jan"], ["February", "Feb"], ["March", "Mar"], ["April", "Apr"],
          ["May"], ["June", "Jun"], ["July", "Jul"], ["August", "Aug"],
          ["September", "Sep", "Sept"], ["October", "Oct"], ["November", "Nov"], ["December", "Dec"],
        ],
        pl: [
          ["styczeń", "stycznia", "styczniu"],
          ["luty", "lutego", "lutym"],
          ["marzec", "marca", "marcu"],
          ["kwiecień", "kwietnia", "kwietniu"],
          ["maj", "maja", "maju"],
          ["czerwiec", "czerwca", "czerwcu"],
          ["lipiec", "lipca", "lipcu"],
          ["sierpień", "sierpnia", "sierpniu"],
          ["wrzesień", "września", "wrześniu"],
          ["październik", "października", "październiku"],
          ["listopad", "listopada", "listopadzie"],
          ["grudzień", "grudnia", "grudniu"],
        ],
      };
      const monthsForCountry = MONTHS_BY_COUNTRY[countryCode] || MONTHS_BY_COUNTRY.uk;
      const berlinNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
      const currentMonthIdx = berlinNow.getMonth(); // 0-based
      const pastMonthNames: string[] = [];
      for (let i = 0; i < currentMonthIdx; i++) pastMonthNames.push(...monthsForCountry[i]);

      let pastMonthCount = 0;
      if (pastMonthNames.length > 0) {
        const escaped = pastMonthNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const pastMonthRe = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "iu");
        for (const record of activeRecords) {
          const title = String(record.voucher_title || "");
          if (!title) continue;
          const m = title.match(pastMonthRe);
          if (!m) continue;
          pastMonthCount++;
          issues.push({
            ...record,
            issue_type: "past_month_in_title",
            voucher_description: `Title contains past month "${m[1]}" — update or expire this voucher.`,
          });
        }
      }
      console.log(`Past month in title check: ${pastMonthCount} vouchers flagged (past months: ${pastMonthNames.join(", ") || "(none — January)"})`);
    } else {
      console.log("Past month in title check skipped (disabled)");
    }


    // === Check 6b: Action-based code at position 1 while a real code exists lower on the page ===
    // Action-based code = voucher_type=code AND voucher_code contains whitespace.
    // Real code = voucher_type=code AND voucher_code non-empty AND no whitespace.
    // Flag the position-1 voucher (one issue per retailer). Applies to all countries (DE, PL, ...).
    let actionBlockingCount = 0;
    for (const [rpid, vouchers] of byRetailer) {
      const pos1 = vouchers.find(v => String(v.voucher_position) === "1");
      if (!pos1) continue;
      const p1Type = String(pos1.voucher_type || "").trim().toLowerCase();
      const p1Code = String(pos1.voucher_code || "");
      const p1IsAction = p1Type === "code" && /\s/.test(p1Code) && p1Code.trim().length > 0;
      if (!p1IsAction) continue;

      const realCodeBelow = vouchers.find(v => {
        if (v === pos1) return false;
        const posNum = parseInt(String(v.voucher_position || ""), 10);
        if (!Number.isFinite(posNum) || posNum <= 1) return false;
        const t = String(v.voucher_type || "").trim().toLowerCase();
        const c = String(v.voucher_code || "").trim();
        return t === "code" && c.length > 0 && !/\s/.test(c);
      });
      if (!realCodeBelow) continue;

      actionBlockingCount++;
      issues.push({
        ...pos1,
        issue_type: "action_code_blocking_real_code",
        voucher_description:
          `Action-based code at position 1 ("${p1Code.trim()}") while a real code exists lower on the page: ` +
          `"${String(realCodeBelow.voucher_title || "Untitled")}" (Pos ${realCodeBelow.voucher_position || "?"}, code: "${String(realCodeBelow.voucher_code || "").trim()}"). ` +
          `Move the real code to position 1.`,
      });
    }
    console.log(`Action-code-blocking-real-code check: ${actionBlockingCount} retailers flagged`);

    // === Check 6b-2: Manually picked DEAL at position 1 while a real code exists lower on the page ===
    // Deal = voucher_type=deal (no code). When a manual pick puts a deal at pos 1 in front of a
    // real code, users miss the working code. Flag the position-1 deal (one issue per retailer).
    let dealBlockingCount = 0;
    const isManualPick = (mp: unknown) => {
      if (mp === true || mp === 1) return true;
      if (typeof mp === "string") {
        const s = mp.trim().toLowerCase();
        return s === "true" || s === "yes" || s === "1";
      }
      return false;
    };
    for (const [rpid, vouchers] of byRetailer) {
      const pos1 = vouchers.find(v => String(v.voucher_position) === "1");
      if (!pos1) continue;
      const p1Type = String(pos1.voucher_type || "").trim().toLowerCase();
      if (p1Type !== "deal") continue;
      if (!isManualPick(pos1._manual_pick)) continue;

      const realCodeBelow = vouchers.find(v => {
        if (v === pos1) return false;
        const posNum = parseInt(String(v.voucher_position || ""), 10);
        if (!Number.isFinite(posNum) || posNum <= 1) return false;
        const t = String(v.voucher_type || "").trim().toLowerCase();
        const c = String(v.voucher_code || "").trim();
        return t === "code" && c.length > 0 && !/\s/.test(c);
      });
      if (!realCodeBelow) continue;

      dealBlockingCount++;
      issues.push({
        ...pos1,
        issue_type: "deal_blocking_real_code",
        voucher_description:
          `Manually picked deal at position 1 ("${String(pos1.voucher_title || "Untitled")}") while a real code exists lower on the page: ` +
          `"${String(realCodeBelow.voucher_title || "Untitled")}" (Pos ${realCodeBelow.voucher_position || "?"}, code: "${String(realCodeBelow.voucher_code || "").trim()}"). ` +
          `Move the real code to position 1 or remove the manual pick on the deal.`,
      });
    }
    console.log(`Deal-blocking-real-code check: ${dealBlockingCount} retailers flagged`);

    // === Check 7: Duplicate voucher codes on the same retailer page ===
    let dupeCodeCount = 0;
    for (const [rpid, vouchers] of byRetailer) {
      // Group by case-insensitive code so variants like "forjoy" / "FORJOY" are caught
      const codeCounts = new Map<string, Record<string, unknown>[]>();
      for (const v of vouchers) {
        const code = String(v.voucher_code || "").trim();
        if (!code) continue;
        // Skip action-based codes (voucher_type=code with space in code)
        const vType = String(v.voucher_type || "").trim().toLowerCase();
        if (vType === "code" && code.includes(" ")) continue;
        const key = code.toLowerCase();
        if (!codeCounts.has(key)) codeCounts.set(key, []);
        codeCounts.get(key)!.push(v);
      }

      for (const [, affectedVouchers] of codeCounts) {
        if (affectedVouchers.length > 1) {
          dupeCodeCount++;
          const template = affectedVouchers[0];
          const variants = Array.from(new Set(affectedVouchers.map(v => String(v.voucher_code || "").trim())));
          const hasCaseVariants = variants.length > 1;
          const displayCode = hasCaseVariants ? variants.join(" / ") : variants[0];
          const voucherList = affectedVouchers.map(v =>
            `• ${v.voucher_title || "Untitled"} (Pos ${v.voucher_position || "?"}) — code: "${String(v.voucher_code || "").trim()}"`
          ).join("\n");
          const titlePrefix = hasCaseVariants
            ? `Code "${displayCode}" appears ${affectedVouchers.length}x on same page (different casing)`
            : `Code "${displayCode}" appears ${affectedVouchers.length}x on same page`;

          issues.push({
            sheet_id: spreadsheet_id,
            sheet_name: sheetParam,
            status: "open",
            retailer_pool_id: template.retailer_pool_id,
            retailer_id: template.retailer_id,
            client_name: template.client_name,
            country: template.country,
            assigned_email: template.assigned_email,
            retailer_assignment: template.retailer_assignment,
            merchant_quality: template.merchant_quality,
            indexed: template.indexed,
            seo_url: template.seo_url,
            voucher_code: displayCode,
            voucher_title: titlePrefix,
            voucher_description: voucherList,
            issue_type: "duplicate_code",
          });
        }
      }
    }
    console.log(`Duplicate code check: ${dupeCodeCount} duplicate codes found`);

    // === Check 8: Caption-Title Value Mismatch ===
    // Extracts numeric values with their units from caption and title, flags mismatches
    const extractValues = (text: string): { num: number; unit: string; raw: string }[] => {
      const results: { num: number; unit: string; raw: string }[] = [];
      // Match numbers with optional unit (€, %, comma/dot decimals)
      const regex = /(\d+[.,]?\d*)\s*([€%])?/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const rawNum = m[1].replace(",", ".");
        const num = parseFloat(rawNum);
        if (isNaN(num) || num === 0) continue;
        const unit = m[2] || "";
        results.push({ num, unit, raw: m[0].trim() });
      }
      // Also check for decimal values like 0.15 that represent percentages
      if (results.length === 0) {
        const decMatch = text.match(/^(0\.\d+)$/);
        if (decMatch) {
          const num = parseFloat(decMatch[1]);
          results.push({ num: Math.round(num * 100), unit: "%", raw: decMatch[0] });
        }
      }
      return results;
    };

    let captionTitleMismatchCount = 0;
    for (const record of activeRecords) {
      const caption = String(record.voucher_caption_1 || "").trim();
      const title = String(record.voucher_title || "").trim();
      if (!caption || !title) continue;

      const captionVals = extractValues(caption);
      const titleVals = extractValues(title);
      if (captionVals.length === 0 || titleVals.length === 0) continue;

      // Only compare caption against the FIRST value in the title
      // (second value in title may refer to something else, not caption 1)
      const firstTitleVal = titleVals[0];
      for (const cv of captionVals) {
        const tv = firstTitleVal;
        // Same number, different unit (e.g. 10% vs 10€)
        const unitMismatch = cv.num === tv.num && cv.unit && tv.unit && cv.unit !== tv.unit;
        // Same unit (or both no unit), different number (e.g. 15€ vs 150€)
        const numMismatch = cv.num !== tv.num && (cv.unit === tv.unit || (!cv.unit && !tv.unit));
        // Only flag if they share a unit context (both have units, or comparing raw numbers)
        if (unitMismatch || (numMismatch && (cv.unit || tv.unit))) {
          captionTitleMismatchCount++;
          const cleanRecord = { ...record };
          delete cleanRecord._extension_type;
          delete cleanRecord._started_at;
          issues.push({
            ...cleanRecord,
            issue_type: "caption_title_mismatch",
            voucher_description: `Caption: "${caption}" vs Title: "${title}" — possible mismatch: ${cv.raw} ≠ ${tv.raw}`,
          });
          break; // one mismatch per voucher is enough
        }
      }
    }
    console.log(`Caption-title mismatch check: ${captionTitleMismatchCount} mismatches found`);

    // === Check 9: Multiple Manual Picks per retailer ===
    let multiManualPickCount = 0;
    for (const [rpid, vouchers] of byRetailer) {
      const manualPicks = vouchers.filter(v => {
        // Only count vouchers actually live on the page (active)
        if (v.is_voucher_active !== true) return false;
        const mp = v._manual_pick;
        if (mp === true || mp === 1) return true;
        if (typeof mp === "string") {
          const s = mp.trim().toLowerCase();
          return s === "true" || s === "yes" || s === "1";
        }
        return false;
      });
      if (manualPicks.length > 1) {
        multiManualPickCount++;
        const template = manualPicks[0];
        const voucherList = manualPicks.map(v =>
          `• ${v.voucher_title || "Untitled"} (Pos ${v.voucher_position || "?"})`
        ).join("\n");

        issues.push({
          sheet_id: spreadsheet_id,
          sheet_name: sheetParam,
          status: "open",
          retailer_pool_id: template.retailer_pool_id,
          retailer_id: template.retailer_id,
          client_name: template.client_name,
          country: template.country,
          assigned_email: template.assigned_email,
          retailer_assignment: template.retailer_assignment,
          merchant_quality: template.merchant_quality,
          indexed: template.indexed,
          seo_url: template.seo_url,
          voucher_title: `${manualPicks.length} manual picks on same page`,
          voucher_description: voucherList,
          issue_type: "multiple_manual_picks",
        });
      }
    }
    console.log(`Multiple manual picks check: ${multiManualPickCount} retailers with multiple manual picks`);

    // === Check 11: Cross-domain code presence (main vs iGraal, same country) ===
    // The two voucher sheets use DIFFERENT merchant_id_pool values for the same retailer
    // (each domain has its own pool ids). To bridge them, we use the iGraal retailer
    // sheet which lists each iGraal retailer's pool_id and Name; we match that Name
    // against the main retailers table (already loaded for this country) to find the
    // corresponding main retailer_pool_id. Only ACTIVE vouchers are considered.
    // Note: scoping is per-country (this whole sync runs for one country at a time).
    let crossMissingOnIgraal = 0;
    let crossMissingOnMain = 0;
    try {
      const igraalSheetName = (countryConfig as any)?.igraal_voucher_sheet_name as string | undefined;
      const igraalRetailerSheetName = (countryConfig as any)?.igraal_retailer_sheet_name as string | undefined;

      if (!igraalSheetName) {
        console.log(`No igraal_voucher_sheet_name configured for ${countryCode}, skipping cross-domain check`);
      } else if (!igraalRetailerSheetName) {
        console.log(`No igraal_retailer_sheet_name configured for ${countryCode}, skipping cross-domain check`);
      } else {
        // Normalize a retailer name for matching
        const normalizeName = (raw: unknown): string => {
          return String(raw ?? "")
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "")
            .trim();
        };

        // Build name -> main retailer pool_id map from already-loaded retailerMap (this country)
        const mainNameToPoolId = new Map<string, { pool_id: string; client_name: string }>();
        for (const [poolId, info] of retailerMap) {
          const ci = info as Record<string, unknown>;
          const key = normalizeName(ci.client_name);
          if (!key) continue;
          if (!mainNameToPoolId.has(key)) {
            mainNameToPoolId.set(key, { pool_id: poolId, client_name: String(ci.client_name || "") });
          }
        }

        // Fetch iGraal retailer sheet -> map iGraal pool_id -> main pool_id (via name)
        const igraalRetailerRows = await fetchSheet(accessToken, retailerSpreadsheetId, igraalRetailerSheetName);
        const igraalPoolToMain = new Map<string, { mainPoolId: string; clientName: string }>();
        if (igraalRetailerRows.length >= 2) {
          const rHeaders = igraalRetailerRows[0].map((h: unknown) => String(h).trim().toLowerCase());
          const rPoolIdx = rHeaders.indexOf("retailer pool id");
          const rNameIdx = rHeaders.indexOf("name");
          const rPublishedIdx = rHeaders.indexOf("retailer published");
          if (rPoolIdx >= 0 && rNameIdx >= 0) {
            for (let i = 1; i < igraalRetailerRows.length; i++) {
              const row = igraalRetailerRows[i];
              if (rPublishedIdx >= 0) {
                const pub = String(row[rPublishedIdx] ?? "").trim().toLowerCase();
                if (pub && pub !== "yes" && pub !== "true" && pub !== "1") continue;
              }
              const igraalPoolId = String(row[rPoolIdx] ?? "").trim();
              const name = String(row[rNameIdx] ?? "").trim();
              if (!igraalPoolId || !name) continue;
              const nameKey = normalizeName(name);
              const mainMatch = mainNameToPoolId.get(nameKey);
              if (!mainMatch) continue;
              igraalPoolToMain.set(igraalPoolId, { mainPoolId: mainMatch.pool_id, clientName: mainMatch.client_name });
            }
          } else {
            console.log(`iGraal retailer sheet "${igraalRetailerSheetName}" missing required columns (Retailer Pool ID / Name)`);
          }
        }
        console.log(`Cross-domain mapping (${countryCode}): ${igraalPoolToMain.size} iGraal retailers matched to main retailers by name`);

        if (igraalPoolToMain.size === 0) {
          console.log(`No iGraal retailers matched to main retailers for ${countryCode}, skipping code comparison`);
        } else {
          const igraalRows = await fetchSheet(accessToken, spreadsheet_id, igraalSheetName);
          if (igraalRows.length < 2) {
            console.log(`iGraal voucher sheet "${igraalSheetName}" has no data rows, skipping cross-domain check`);
          } else {
            const iHeaders = igraalRows[0].map((h: unknown) => String(h).trim().toLowerCase());
            const idx = (name: string) => iHeaders.indexOf(name);
            const iPoolIdx = idx("merchant_id_pool");
            const iCodeIdx = idx("voucher_code");
            const iActiveIdx = idx("is_voucher_active");
            const iVidIdx = idx("voucher_id_pool");
            const iNameIdx = idx("merchant_name");
            const iPosIdx = idx("voucher_position");
            const iTitleIdx = idx("voucher_title");
            const iTypeIdx = idx("voucher_type");

            const normalizeCode = (raw: unknown): string | null => {
              if (raw === null || raw === undefined) return null;
              const s = String(raw).trim();
              if (!s) return null;
              if (/\s/.test(s)) return null;
              return s.toUpperCase();
            };

            type IgraalEntry = {
              voucher_id_pool: string;
              client_name: string;
              voucher_title: string;
              voucher_position: string;
              voucher_code: string;
              igraal_pool_id: string;
            };
            const igraalByMainPool = new Map<string, Map<string, IgraalEntry>>();
            for (let i = 1; i < igraalRows.length; i++) {
              const row = igraalRows[i];
              if (iActiveIdx >= 0) {
                const a = row[iActiveIdx];
                const isActive = a === true || a === "true" || a === "TRUE" || a === 1;
                if (!isActive) continue;
              }
              const igraalPoolId = iPoolIdx >= 0 ? String(row[iPoolIdx] ?? "").trim() : "";
              if (!igraalPoolId) continue;
              const mapping = igraalPoolToMain.get(igraalPoolId);
              if (!mapping) continue;
              const code = normalizeCode(row[iCodeIdx]);
              if (!code) continue;
              const vType = iTypeIdx >= 0 ? String(row[iTypeIdx] ?? "").trim().toLowerCase() : "";
              if (vType === "code" && /\s/.test(String(row[iCodeIdx] ?? ""))) continue;
              const mainPoolId = mapping.mainPoolId;
              if (!igraalByMainPool.has(mainPoolId)) igraalByMainPool.set(mainPoolId, new Map());
              const m = igraalByMainPool.get(mainPoolId)!;
              if (!m.has(code)) {
                m.set(code, {
                  voucher_id_pool: String(row[iVidIdx] ?? ""),
                  client_name: String(row[iNameIdx] ?? "") || mapping.clientName,
                  voucher_title: String(row[iTitleIdx] ?? ""),
                  voucher_position: String(row[iPosIdx] ?? ""),
                  voucher_code: String(row[iCodeIdx] ?? "").trim(),
                  igraal_pool_id: igraalPoolId,
                });
              }
            }

            const mainByPool = new Map<string, Map<string, Record<string, unknown>>>();
            for (const v of activeRecords) {
              const poolId = String(v.retailer_pool_id || "").trim();
              if (!poolId) continue;
              if (!igraalByMainPool.has(poolId)) continue;
              const code = normalizeCode(v.voucher_code);
              if (!code) continue;
              const vType = String(v.voucher_type || "").trim().toLowerCase();
              if (vType === "code" && /\s/.test(String(v.voucher_code || ""))) continue;
              if (!mainByPool.has(poolId)) mainByPool.set(poolId, new Map());
              const m = mainByPool.get(poolId)!;
              if (!m.has(code)) m.set(code, v);
            }

            for (const [poolId, igraalCodes] of igraalByMainPool) {
              const mainCodes = mainByPool.get(poolId);
              const mainTemplate = mainCodes?.values().next().value as Record<string, unknown> | undefined;

              if (mainCodes) {
                for (const [code, mainV] of mainCodes) {
                  if (igraalCodes.has(code)) continue;
                  crossMissingOnIgraal++;
                  issues.push({
                    sheet_id: spreadsheet_id,
                    sheet_name: sheetParam,
                    status: "open",
                    country: countryCode,
                    retailer_pool_id: mainV.retailer_pool_id,
                    retailer_id: mainV.retailer_id,
                    client_name: mainV.client_name,
                    assigned_email: mainV.assigned_email,
                    retailer_assignment: mainV.retailer_assignment,
                    merchant_quality: mainV.merchant_quality,
                    indexed: mainV.indexed,
                    seo_url: mainV.seo_url,
                    voucher_id_pool: mainV.voucher_id_pool,
                    voucher_code: String(mainV.voucher_code || "").trim(),
                    voucher_title: `Code "${String(mainV.voucher_code || "").trim()}" missing on iGraal`,
                    voucher_position: mainV.voucher_position,
                    voucher_description: `Active code present on main domain but not found on iGraal for this retailer.\nMain voucher: ${mainV.voucher_title || "Untitled"} (Pos ${mainV.voucher_position || "?"})`,
                    issue_type: "code_missing_on_igraal",
                  });
                }
              }

              for (const [code, iV] of igraalCodes) {
                if (mainCodes && mainCodes.has(code)) continue;
                crossMissingOnMain++;
                issues.push({
                  sheet_id: spreadsheet_id,
                  sheet_name: sheetParam,
                  status: "open",
                  country: countryCode,
                  retailer_pool_id: poolId,
                  retailer_id: mainTemplate?.retailer_id,
                  client_name: mainTemplate?.client_name || iV.client_name,
                  assigned_email: mainTemplate?.assigned_email,
                  retailer_assignment: mainTemplate?.retailer_assignment,
                  merchant_quality: mainTemplate?.merchant_quality,
                  indexed: mainTemplate?.indexed,
                  seo_url: mainTemplate?.seo_url,
                  voucher_id_pool: iV.voucher_id_pool,
                  voucher_code: iV.voucher_code,
                  voucher_title: `Code "${iV.voucher_code}" missing on main domain`,
                  voucher_position: iV.voucher_position,
                  voucher_description: `Active code present on iGraal but not found on main domain for this retailer.\niGraal voucher: ${iV.voucher_title || "Untitled"} (Pos ${iV.voucher_position || "?"})`,
                  issue_type: "code_missing_on_main",
                });
              }
            }
            console.log(`Cross-domain code check (${countryCode}): ${crossMissingOnIgraal} missing on iGraal, ${crossMissingOnMain} missing on main`);

            // === Check: Automatic Source Review on iGraal (same rules as main domain) ===
            if (checkEnabled("automatic_source_review")) {
              const iSourceIdx = idx("voucher_source");
              const iStartedIdx = idx("voucher_started_at");
              const iTncIdx = idx("voucher_terms_and_conditions");
              const iCap1Idx = idx("voucher_caption_1");
              const iCap2Idx = idx("voucher_caption_2");
              const iCapText1Idx = idx("voucher_caption_text_1");
              // Cashback combinable: try common headers, else fall back to column AH (index 33)
              let iCashbackIdx = -1;
              const cbCandidates = [
                "is_cashback_combinable", "cashback_combinable",
                "is_cashback_combineable", "cashback_combineable",
                "voucher_cashback_combinable", "voucher_cashback_combineable",
                "cashback_combinable_flag",
              ];
              for (const h of cbCandidates) {
                const k = iHeaders.indexOf(h);
                if (k >= 0) { iCashbackIdx = k; break; }
              }
              if (iCashbackIdx === -1 && iHeaders.length > 33) iCashbackIdx = 33; // column AH

              const _today = new Date();
              const _yStr = new Date(_today.getTime() - 86400000).toISOString().split("T")[0];

              // Carry forward existing unresolved iGraal automatic_source_review issues
              const igraalCarryForwardVids = new Set<string>();
              try {
                const { data: existingAutoIg } = await adminClient
                  .from("issues")
                  .select("voucher_id_pool, status")
                  .eq("country", countryCode)
                  .eq("sheet_id", spreadsheet_id)
                  .eq("sheet_name", igraalSheetName)
                  .eq("issue_type", "automatic_source_review")
                  .in("status", ["open", "in_progress"]);
                for (const e of existingAutoIg || []) {
                  const vid = String((e as any).voucher_id_pool || "").trim();
                  if (vid) igraalCarryForwardVids.add(vid);
                }
              } catch (e) {
                console.error("iGraal automatic_source_review carry-forward fetch failed:", e);
              }

              const parseStartDate = (raw: unknown): string => {
                if (raw === undefined || raw === null || raw === "") return "";
                let sd: Date | null = null;
                if (typeof raw === "number" || /^\d+(\.\d+)?$/.test(String(raw).trim())) {
                  const epoch = new Date(1899, 11, 30);
                  sd = new Date(epoch.getTime() + Number(raw) * 86400000);
                } else {
                  const d = new Date(String(raw));
                  if (!isNaN(d.getTime())) sd = d;
                }
                return sd ? sd.toISOString().split("T")[0] : "";
              };

              let iAutoCount = 0;
              for (let i = 1; i < igraalRows.length; i++) {
                const row = igraalRows[i];
                if (iActiveIdx >= 0) {
                  const a = row[iActiveIdx];
                  const isActive = a === true || a === "true" || a === "TRUE" || a === 1;
                  if (!isActive) continue;
                }
                const src = iSourceIdx >= 0 ? String(row[iSourceIdx] ?? "").trim().toLowerCase() : "";
                if (src !== "automatic") continue;

                const igraalPoolId = iPoolIdx >= 0 ? String(row[iPoolIdx] ?? "").trim() : "";
                const mapping = igraalPoolId ? igraalPoolToMain.get(igraalPoolId) : undefined;
                const mainPoolId = mapping?.mainPoolId || null;
                const mainTemplate = mainPoolId
                  ? (mainByPool.get(mainPoolId)?.values().next().value as Record<string, unknown> | undefined)
                  : undefined;

                const startStr = iStartedIdx >= 0 ? parseStartDate(row[iStartedIdx]) : "";
                const vidPool = iVidIdx >= 0 ? String(row[iVidIdx] ?? "").trim() : "";
                const isYesterday = startStr === _yStr;
                const carryForward = vidPool && igraalCarryForwardVids.has(vidPool);
                if (!isYesterday && !carryForward) continue;

                const title = iTitleIdx >= 0 ? String(row[iTitleIdx] ?? "") : "";
                const code = iCodeIdx >= 0 ? String(row[iCodeIdx] ?? "").trim() : "";
                const pos = iPosIdx >= 0 ? String(row[iPosIdx] ?? "") : "";
                const cap1 = iCap1Idx >= 0 ? String(row[iCap1Idx] ?? "") : "";
                const cap2 = iCap2Idx >= 0 ? String(row[iCap2Idx] ?? "") : "";
                const capText1 = iCapText1Idx >= 0 ? String(row[iCapText1Idx] ?? "") : "";
                const tnc = iTncIdx >= 0 ? String(row[iTncIdx] ?? "") : "";
                const cashbackRaw = iCashbackIdx >= 0 ? row[iCashbackIdx] : undefined;
                const cashbackCombinable =
                  cashbackRaw === true || cashbackRaw === 1 ||
                  (typeof cashbackRaw === "string" && ["true", "yes", "1", "y"].includes(cashbackRaw.trim().toLowerCase()));
                const cashbackLabel = cashbackRaw === undefined || cashbackRaw === null || cashbackRaw === ""
                  ? "unknown"
                  : (cashbackCombinable ? "yes" : "no");
                const clientName = iNameIdx >= 0 ? String(row[iNameIdx] ?? "") : "";

                iAutoCount++;
                issues.push({
                  sheet_id: spreadsheet_id,
                  sheet_name: igraalSheetName,
                  status: "open",
                  country: countryCode,
                  retailer_pool_id: mainPoolId || igraalPoolId,
                  retailer_id: mainTemplate?.retailer_id ?? null,
                  client_name: mainTemplate?.client_name || clientName || mapping?.clientName || null,
                  assigned_email: mainTemplate?.assigned_email ?? null,
                  retailer_assignment: mainTemplate?.retailer_assignment ?? null,
                  merchant_quality: mainTemplate?.merchant_quality ?? null,
                  indexed: mainTemplate?.indexed ?? null,
                  seo_url: mainTemplate?.seo_url ?? null,
                  voucher_id_pool: vidPool,
                  voucher_title: title || "Untitled",
                  voucher_position: pos,
                  voucher_code: code,
                  voucher_caption_1: cap1,
                  voucher_caption_2: cap2,
                  voucher_caption_text_1: capText1,
                  voucher_terms_and_conditions: tnc,
                  voucher_source: "automatic",
                  voucher_start_date: startStr || null,
                  issue_type: "automatic_source_review",
                  voucher_description:
                    `[iGraal] Auto-generated voucher (source=automatic)` +
                    (startStr ? ` started ${startStr}.` : `.`) +
                    ` Cashback combinable: ${cashbackLabel}. Please review captions, title and T&Cs.`,
                });
              }
              console.log(`Automatic source review (iGraal, ${countryCode}): ${iAutoCount} vouchers flagged (carry-forward set size: ${igraalCarryForwardVids.size})`);
            }
          }
        }
      }
    } catch (e) {
      console.error("Cross-domain code check failed (non-fatal):", e);
    }

    // === Check 10: Similar Titles within same retailer (>85% trigram similarity) ===
    function trigrams(s: string): Set<string> {
      const t = new Set<string>();
      const norm = s.toLowerCase().replace(/\s+/g, " ").trim();
      const padded = `  ${norm} `;
      for (let i = 0; i < padded.length - 2; i++) {
        t.add(padded.substring(i, i + 3));
      }
      return t;
    }

    function trigramSimilarity(a: string, b: string): number {
      const ta = trigrams(a);
      const tb = trigrams(b);
      let intersection = 0;
      for (const t of ta) { if (tb.has(t)) intersection++; }
      const union = ta.size + tb.size - intersection;
      return union === 0 ? 0 : intersection / union;
    }

    let similarTitleCount = 0;
    for (const [rpid, vouchers] of byRetailer) {
      // Collect titles with their vouchers
      const titledVouchers = vouchers
        .filter(v => String(v.voucher_title || "").trim().length > 5)
        .map(v => ({ title: String(v.voucher_title || "").trim(), voucher: v }));

      const flagged = new Set<number>();
      for (let i = 0; i < titledVouchers.length; i++) {
        for (let j = i + 1; j < titledVouchers.length; j++) {
          if (flagged.has(i) && flagged.has(j)) continue;
          const sim = trigramSimilarity(titledVouchers[i].title, titledVouchers[j].title);
          if (sim > 0.85 && titledVouchers[i].title !== titledVouchers[j].title) {
            flagged.add(i);
            flagged.add(j);
          }
        }
      }

      if (flagged.size > 0) {
        similarTitleCount++;
        const affectedVouchers = [...flagged].map(idx => titledVouchers[idx]);
        const template = affectedVouchers[0].voucher;
        const voucherList = affectedVouchers.map(v =>
          `• ${v.title} (Pos ${v.voucher.voucher_position || "?"})`
        ).join("\n");

        issues.push({
          sheet_id: spreadsheet_id,
          sheet_name: sheetParam,
          status: "open",
          retailer_pool_id: template.retailer_pool_id,
          retailer_id: template.retailer_id,
          client_name: template.client_name,
          country: template.country,
          assigned_email: template.assigned_email,
          retailer_assignment: template.retailer_assignment,
          merchant_quality: template.merchant_quality,
          indexed: template.indexed,
          seo_url: template.seo_url,
          voucher_title: `${flagged.size} similar titles on same page`,
          voucher_description: voucherList,
          issue_type: "similar_titles",
        });
      }
    }
    console.log(`Similar titles check: ${similarTitleCount} retailers with similar titles`);

    // === Check 12: Wrong country redirect URL ===
    // Flag active vouchers whose voucher_url_redirect points to a ccTLD that is
    // different from the sync country (e.g. .at/.ch/.it for a DE sync). Generic
    // TLDs like .com/.net/.org/.eu/.io are ignored.
    const GENERIC_TLDS = new Set([
      "com","net","org","eu","io","co","info","biz","app","shop","store","online",
      "site","tech","xyz","me","tv","cc","gg","global","world","int","gov","edu",
    ]);
    // Allow-list of known affiliate / tracking / link-shortener hostnames.
    // These often use ccTLDs (e.g. prf.hn) but are not country-specific destinations.
    const AFFILIATE_HOSTS = new Set([
      "prf.hn","awin1.com","tradedoubler.com","linksynergy.com","click.linksynergy.com",
      "go.skimresources.com","skimresources.com","anrdoezrs.net","dpbolvw.net",
      "tkqlhce.com","jdoqocy.com","kqzyfj.com","qksrv.net","tradetracker.net",
      "tc.tradetracker.net","webgains.com","track.webgains.com","belboon.com",
      "track.belboon.com","affilinet.de","partners.webmasterplan.com","ad.zanox.com",
      "zanox.com","track.adtraction.com","adtraction.com","clk.tradedoubler.com",
      "impact.com","go2cloud.org","prf.io","bit.ly","tinyurl.com","t.co","ow.ly",
      "lnkd.in","cutt.ly","rebrand.ly","shorturl.at","s.click.aliexpress.com",
      "amzn.to","ebay.to","fave.co","sovrn.co","viglink.com","redirect.viglink.com",
      "converti.se","hvjjg.com",
    ]);
    let wrongCountryCount = 0;
    const syncTld = countryCode.toLowerCase();
    // Pre-built fast regex to extract the hostname's TLD without constructing a URL object.
    // Matches: protocol://[user@]host[:port]/...  capturing the last dotted segment of host.
    const HOST_RE = /^https?:\/\/(?:[^/@]*@)?([^/:?#]+)/i;
    for (const record of activeRecords) {
      const rawUrl = String((record as any)._redirect_url || "").trim();
      if (!rawUrl || rawUrl.length < 8) continue;
      // Fast hostname extraction via regex (avoids new URL() for the 99% case)
      const m = HOST_RE.exec(rawUrl);
      if (!m) continue;
      let host = m[1].toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      const dot = host.lastIndexOf(".");
      if (dot < 0) continue;
      const tld = host.slice(dot + 1);
      // Fast exits: only 2-letter ccTLDs are interesting, skip generic + matching country
      if (tld.length !== 2) continue;
      if (tld === syncTld) continue;
      if (GENERIC_TLDS.has(tld)) continue;
      // Affiliate hosts use ccTLDs (e.g. prf.hn) — skip these
      let isAffiliate = false;
      for (const ah of AFFILIATE_HOSTS) {
        if (host === ah || host.endsWith("." + ah)) { isAffiliate = true; break; }
      }
      if (isAffiliate) continue;

      // Only now do the expensive URL parse to check for inner redirect destination.
      let finalHost = host;
      let finalTld = tld;
      if (rawUrl.includes("?") && rawUrl.includes("http", 8)) {
        try {
          const parsedUrl = new URL(rawUrl);
          const REDIRECT_PARAMS = ["r","url","u","redirect","redirect_url","dest","destination","target","to","goto","link","out","ulp","deep_link","deeplink","deepLink","murl","ued","p"];
          for (const key of REDIRECT_PARAMS) {
            const val = parsedUrl.searchParams.get(key);
            if (!val || !val.includes("http")) continue;
            let inner = val;
            try { inner = decodeURIComponent(val); } catch { /* ignore */ }
            if (!inner.startsWith("http")) continue;
            try {
              const innerHost = new URL(inner).hostname.toLowerCase();
              if (innerHost) {
                const h = innerHost.startsWith("www.") ? innerHost.slice(4) : innerHost;
                const d = h.lastIndexOf(".");
                if (d >= 0) {
                  finalHost = h;
                  finalTld = h.slice(d + 1);
                }
                break;
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        // Re-check after unwrap: skip if final destination is fine
        if (finalTld.length !== 2 || finalTld === syncTld || GENERIC_TLDS.has(finalTld)) continue;
        let isAffFinal = false;
        for (const ah of AFFILIATE_HOSTS) {
          if (finalHost === ah || finalHost.endsWith("." + ah)) { isAffFinal = true; break; }
        }
        if (isAffFinal) continue;
      }

      wrongCountryCount++;
      issues.push({
        sheet_id: spreadsheet_id,
        sheet_name: sheetParam,
        status: "open",
        retailer_pool_id: record.retailer_pool_id,
        retailer_id: record.retailer_id,
        client_name: record.client_name,
        country: record.country,
        assigned_email: record.assigned_email,
        retailer_assignment: record.retailer_assignment,
        merchant_quality: record.merchant_quality,
        indexed: record.indexed,
        seo_url: record.seo_url,
        voucher_id_pool: record.voucher_id_pool,
        voucher_title: record.voucher_title,
        voucher_description: `Redirect points to .${finalTld} (${finalHost}) instead of .${syncTld}`,
        retailer_url: rawUrl,
        voucher_position: record.voucher_position,
        issue_type: "wrong_country_redirect_url",
      });
    }
    console.log(`Wrong country redirect check: ${wrongCountryCount} vouchers flagged`);

    // Strip _meta fields from all records and issues before insert
    for (const record of allRecords) {
      delete record._extension_type;
      delete record._started_at;
      delete record._manual_pick;
      delete record._client_uid;
      delete record._redirect_url;
    }
    for (const issue of issues) {
      delete issue._extension_type;
      delete issue._started_at;
      delete issue._manual_pick;
      delete issue._client_uid;
      delete issue._redirect_url;
    }

    // === Filter issues by enabled check_configs ===
    const { data: checkCfgs } = await adminClient
      .from("check_configs")
      .select("issue_type, enabled")
      .eq("country_code", countryCode);
    const disabledTypes = new Set(
      (checkCfgs || []).filter((c: any) => c.enabled === false).map((c: any) => c.issue_type)
    );
    if (disabledTypes.size > 0) {
      const before = issues.length;
      for (let i = issues.length - 1; i >= 0; i--) {
        if (disabledTypes.has(String(issues[i].issue_type))) issues.splice(i, 1);
      }
      console.log(`Filtered out ${before - issues.length} issues from disabled checks: ${[...disabledTypes].join(", ")}`);
    }

    // === Dedupe automatic_source_review across domains by voucher_id_pool ===
    // The same voucher (same pool ID) can appear on the main sheet AND the iGraal sheet.
    // Editors fix it once in the admin tool and it propagates to all domains, so we only
    // want a single issue per voucher_id_pool. Prefer the main-sheet entry; fall back to
    // whichever came first.
    {
      const seen = new Map<string, number>(); // vid -> index in issues
      const dropIdx: number[] = [];
      for (let i = 0; i < issues.length; i++) {
        const it = issues[i] as Record<string, unknown>;
        if (it.issue_type !== "automatic_source_review") continue;
        const vid = String(it.voucher_id_pool || "").trim();
        if (!vid) continue;
        const existingIdx = seen.get(vid);
        if (existingIdx === undefined) {
          seen.set(vid, i);
          continue;
        }
        const existing = issues[existingIdx] as Record<string, unknown>;
        const existingIsMain = String(existing.sheet_name || sheetParam) === sheetParam;
        const currentIsMain = String(it.sheet_name || sheetParam) === sheetParam;
        if (currentIsMain && !existingIsMain) {
          // Replace iGraal duplicate with the main-sheet version
          dropIdx.push(existingIdx);
          seen.set(vid, i);
        } else {
          dropIdx.push(i);
        }
      }
      if (dropIdx.length > 0) {
        const dropSet = new Set(dropIdx);
        const before = issues.length;
        for (let i = issues.length - 1; i >= 0; i--) {
          if (dropSet.has(i)) issues.splice(i, 1);
        }
        console.log(`Deduped automatic_source_review across domains: dropped ${before - issues.length} duplicate(s) by voucher_id_pool`);
      }
    }



    // === Stage payload + hand off to reconcile in a fresh invocation ===
    const run_id = `${countryCode}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const activeVoucherPoolIds = activeRecords
      .map(r => String(r.voucher_id_pool || ""))
      .filter(Boolean);

    const { error: stageErr } = await adminClient.from("pending_sync_issues").insert({
      run_id,
      country_code: countryCode,
      spreadsheet_id,
      sheet_name: sheetParam,
      payload: {
        issues,
        activeVoucherPoolIds,
        totalVouchers: dataRows.length,
        editorsSynced,
        retailersSynced,
        retailerSheet: retailerSheetName,
      },
    });
    if (stageErr) {
      console.error("Failed to stage payload:", stageErr.message);
      return new Response(JSON.stringify({ error: `staging failed: ${stageErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`Staged ${issues.length} issues under run_id=${run_id}`);

    // Fire-and-forget reconcile invocation. Do NOT await — we want the current
    // function to return immediately so its CPU budget resets for the next phase.
    const reconcileUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-reconcile`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const reconcilePromise = fetch(reconcileUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ run_id }),
    }).then(r => console.log(`Reconcile kickoff status: ${r.status}`))
      .catch(err => console.error("Reconcile kickoff failed:", err));
    // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(reconcilePromise);
    }

    return new Response(
      JSON.stringify({
        success: true,
        phase: "checks_complete",
        run_id,
        total_vouchers: dataRows.length,
        issues_found: issues.length,
        editors_synced: editorsSynced,
        retailers_synced: retailersSynced,
        sheet: sheetParam,
        retailer_sheet: retailerSheetName,
        note: "Reconciliation continues in sync-reconcile.",
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
