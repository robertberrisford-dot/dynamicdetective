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
  teamLeadEmail: string,
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
  const emailIdx = headers.findIndex(h => h.includes("mail") || h === "email" || h === "e-mail");
  const nameIdx = headers.findIndex(h => h === "name" || h.includes("name"));
  const roleIdx = headers.findIndex(h => h === "role" || h.includes("role"));
  const tlEmailIdx = headers.findIndex(h => h === "team_lead_email" || h === "team_lead" || h.includes("team_lead"));

  if (emailIdx === -1) return 0;

  const editors: { email: string; name: string | null; role: string; team_lead_email: string | null }[] = [];
  const editorEmails = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = String(row[emailIdx] || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    editorEmails.add(email);
    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() || null : null;
    const sheetRole = roleIdx >= 0 ? String(row[roleIdx] || "").trim().toLowerCase() : "";
    const sheetTlEmail = tlEmailIdx >= 0 ? String(row[tlEmailIdx] || "").trim().toLowerCase() || null : null;
    let role = "editor";
    if (teamLeadEmail && email === teamLeadEmail.toLowerCase()) role = "team_lead";
    else if (sheetRole.includes("ops") && sheetRole.includes("lead")) role = "team_lead";
    else if (sheetRole.includes("team") && sheetRole.includes("lead")) role = "team_lead";
    else if (sheetRole.includes("lead") || sheetRole.includes("manager")) role = "team_lead";
    editors.push({ email, name, role, team_lead_email: sheetTlEmail });
  }

  if (teamLeadEmail && !editorEmails.has(teamLeadEmail.toLowerCase())) {
    editors.push({ email: teamLeadEmail.toLowerCase(), name: null, role: "team_lead", team_lead_email: null });
  }

  const hasTlEmailColumn = tlEmailIdx >= 0;
  // Don't delete editors — just upsert name/role/country; only set team_lead_email if it came from the sheet
  if (editors.length > 0) {
    for (const ed of editors) {
      const upsertData: Record<string, unknown> = { email: ed.email, name: ed.name, role: ed.role, country: countryCode };
      // Only overwrite team_lead_email if the sheet has a team_lead_email column
      if (hasTlEmailColumn && ed.team_lead_email !== null) {
        upsertData.team_lead_email = ed.team_lead_email;
      }
      await adminClient.from("editors").upsert(
        upsertData,
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
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();

      if (!roleData) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { spreadsheet_id, sheet_name, country_code } = await req.json();
    if (!spreadsheet_id) {
      return new Response(JSON.stringify({ error: "spreadsheet_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sheetParam = sheet_name || "MYDEAL_DE_API_Vouchers (Preset)";
    const countryCode = country_code || "de";
    const accessToken = await getAccessToken(serviceAccountKey);

    // Fetch country config for editors sheet name and team lead
    const { data: countryConfig } = await adminClient
      .from("country_configs")
      .select("editors_sheet_name, team_lead_email")
      .eq("country_code", countryCode)
      .maybeSingle();
    
    const editorsSheetName = countryConfig?.editors_sheet_name || "Editors";
    const teamLeadEmail = countryConfig?.team_lead_email || "";

    // Sync editors
    const editorsSynced = await syncEditors(
      adminClient, accessToken, spreadsheet_id, teamLeadEmail, editorsSheetName, countryCode
    );

    // Fetch retailer assignments
    // Fetch ALL retailer assignments (paginate to avoid 1000-row limit), only published retailers
    let allRetailers: { retailer_pool_id: string | null; retailer_assignment: string | null; seo_url: string | null }[] = [];
    let rFrom = 0;
    const rPageSize = 1000;
    while (true) {
      const { data: rPage } = await adminClient
        .from("retailers")
        .select("retailer_pool_id, retailer_assignment, seo_url")
        .eq("page_published", "PUBLISHED")
        .eq("country", countryCode)
        .range(rFrom, rFrom + rPageSize - 1);
      if (!rPage || rPage.length === 0) break;
      allRetailers = allRetailers.concat(rPage);
      if (rPage.length < rPageSize) break;
      rFrom += rPageSize;
    }
    const retailerMap = new Map<string, { assignment: string; seo_url: string | null }>();
    allRetailers.forEach(r => {
      if (r.retailer_pool_id) {
        retailerMap.set(r.retailer_pool_id, {
          assignment: r.retailer_assignment || "",
          seo_url: r.seo_url || null,
        });
      }
    });
    console.log(`Loaded ${retailerMap.size} retailers for assignment lookup`);

    // Fetch editor info for assignment lookup
    const { data: editorsList } = await adminClient.from("editors").select("email, role, team_lead_email").eq("country", countryCode);
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

    // === Check 1: Non-Numerical Caption 1 (voucher-level) ===
    const issues: Record<string, unknown>[] = [];

    for (const record of allRecords) {
      if (!hasNumericValue(record.voucher_caption_1)) {
        issues.push({ ...record, issue_type: "missing_caption_1" });
      }
    }

    // === Check 2: Metas Without Values (retailer-level) ===
    // Group vouchers by retailer_pool_id
    const byRetailer = new Map<string, Record<string, unknown>[]>();
    for (const record of allRecords) {
      const rpid = String(record.retailer_pool_id || "");
      if (!rpid) continue;
      if (!byRetailer.has(rpid)) byRetailer.set(rpid, []);
      byRetailer.get(rpid)!.push(record);
    }

    for (const [rpid, vouchers] of byRetailer) {
      const pos1 = vouchers.find(v => String(v.voucher_position) === "1");
      const pos2 = vouchers.find(v => String(v.voucher_position) === "2");

      const pos1Missing = pos1 && !hasNumericValue(pos1.voucher_caption_1);
      const pos2Missing = pos2 && !hasNumericValue(pos2.voucher_caption_1);

      // Create a separate issue for each problematic position voucher
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

    // === Check 5: Stale Evergreen Vouchers (older than 150 days) ===
    const now = Date.now();
    const DAY_MS = 86400000;

    // Google Sheets serial date to JS Date (serial 1 = 1900-01-01, with the Lotus 1-2-3 bug)
    const serialToDate = (serial: number): Date => {
      const epoch = new Date(1899, 11, 30); // Dec 30, 1899
      return new Date(epoch.getTime() + serial * DAY_MS);
    };

    let evergreenCount = 0;
    let staleCount = 0;
    for (const record of allRecords) {
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
      if (ageDays > 150) {
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
    console.log(`Evergreen check: ${evergreenCount} evergreen vouchers found, ${staleCount} older than 150 days`);

    // === Check 6: Action-Based Codes (ABC) with missing/weak T&C ===
    let abcCount = 0;
    const tncPatterns = new Map<string, Record<string, unknown>[]>();

    for (const record of allRecords) {
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

    // === Check 7: Duplicate voucher codes on the same retailer page ===
    let dupeCodeCount = 0;
    for (const [rpid, vouchers] of byRetailer) {
      const codeCounts = new Map<string, Record<string, unknown>[]>();
      for (const v of vouchers) {
        const code = String(v.voucher_code || "").trim();
        if (!code) continue;
        // Skip action-based codes (voucher_type=code with space in code)
        const vType = String(v.voucher_type || "").trim().toLowerCase();
        if (vType === "code" && code.includes(" ")) continue;
        if (!codeCounts.has(code)) codeCounts.set(code, []);
        codeCounts.get(code)!.push(v);
      }

      for (const [code, affectedVouchers] of codeCounts) {
        if (affectedVouchers.length > 1) {
          dupeCodeCount++;
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
            voucher_code: code,
            voucher_title: `Code "${code}" appears ${affectedVouchers.length}x on same page`,
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
    for (const record of allRecords) {
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
        const mp = v._manual_pick;
        return mp === true || mp === "true" || mp === "TRUE" || mp === 1;
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

    // Strip _meta fields from all records and issues before insert
    for (const record of allRecords) {
      delete record._extension_type;
      delete record._started_at;
      delete record._manual_pick;
    }
    for (const issue of issues) {
      delete issue._extension_type;
      delete issue._started_at;
      delete issue._manual_pick;
    }

    // === Snapshot analytics before delete ===
    const syncRunId = new Date().toISOString();
    const syncManagedTypes = ['missing_caption_1', 'metas_without_values', 'repeated_caption_1', 'repeated_caption_combo', 'stale_evergreen', 'abc_missing_tnc', 'abc_repeated_tnc', 'duplicate_code', 'caption_title_mismatch', 'multiple_manual_picks', 'similar_titles'];

    // Fetch existing issues before deleting (include status, hidden_until, updated_at for preservation)
    let existingIssues: Record<string, unknown>[] = [];
    let eFrom = 0;
    while (true) {
      const { data: ePage } = await adminClient
        .from("issues")
        .select("id, issue_type, assigned_email, status, hidden_until, updated_at, retailer_pool_id, voucher_id_pool")
        .eq("sheet_id", spreadsheet_id)
        .eq("sheet_name", sheetParam)
        .in("issue_type", syncManagedTypes)
        .range(eFrom, eFrom + 999);
      if (!ePage || ePage.length === 0) break;
      existingIssues = existingIssues.concat(ePage);
      if (ePage.length < 1000) break;
      eFrom += 1000;
    }

    // Build lookup of old issues by composite key for status preservation
    const issueKey = (rec: Record<string, unknown>) => {
      const it = String(rec.issue_type || "");
      const rp = String(rec.retailer_pool_id || "");
      const vp = String(rec.voucher_id_pool || "");
      return `${it}|${rp}|${vp}`;
    };

    // Map old issues: key → { status, hidden_until, updated_at }
    const oldStatusMap = new Map<string, { status: string; hidden_until: string | null; updated_at: string }>();
    for (const oi of existingIssues) {
      const key = issueKey(oi);
      const status = String(oi.status || "open");
      // If multiple old issues share a key, prefer the one with a non-open status
      if (!oldStatusMap.has(key) || status !== "open") {
        oldStatusMap.set(key, {
          status,
          hidden_until: oi.hidden_until as string | null,
          updated_at: String(oi.updated_at || ""),
        });
      }
    }

    // Build lookup of old issues by key for snapshot analytics
    const oldByKey = new Map<string, Record<string, unknown>>();
    for (const oi of existingIssues) {
      const k = `${oi.issue_type}|${(oi.assigned_email || "").toString().toLowerCase()}`;
      if (!oldByKey.has(k)) oldByKey.set(k, { count: 0, resolved: 0, statuses: [] as string[] });
      const entry = oldByKey.get(k)!;
      (entry as any).count++;
      (entry as any).statuses.push(oi.status);
      if (oi.status === 'done' || oi.status === 'ignored') (entry as any).resolved++;
    }

    // Build new issues lookup
    const newByKey = new Map<string, number>();
    for (const ni of issues) {
      const k = `${ni.issue_type}|${(ni.assigned_email || "").toString().toLowerCase()}`;
      newByKey.set(k, (newByKey.get(k) || 0) + 1);
    }

    // Generate snapshots
    const snapshots: Record<string, unknown>[] = [];
    const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
    for (const key of allKeys) {
      const [issueType, email] = key.split("|");
      const old = oldByKey.get(key) as any;
      const oldCount = old?.count || 0;
      const resolved = old?.resolved || 0;
      const newCount = newByKey.get(key) || 0;

      const disappeared = Math.max(0, oldCount - resolved - newCount);
      const brandNew = Math.max(0, newCount - (oldCount - resolved));

      snapshots.push({
        sync_run_id: syncRunId,
        editor_email: email || null,
        issue_type: issueType,
        issue_count: newCount,
        issues_resolved: resolved,
        issues_disappeared: disappeared,
        issues_new: brandNew,
      });
    }

    // Insert snapshots
    for (let i = 0; i < snapshots.length; i += 100) {
      await adminClient.from("sync_snapshots").insert(snapshots.slice(i, i + 100));
    }
    console.log(`Analytics: ${snapshots.length} snapshot rows recorded`);

    // Preserve statuses: if an issue was acted on (status != 'open'), carry over the status
    // For hidden_until: preserve if still in the future
    const nowTs = new Date().toISOString();
    let preservedCount = 0;
    for (const issue of issues) {
      const key = issueKey(issue);
      const old = oldStatusMap.get(key);
      if (old && old.status !== "open") {
        // Preserve the editor's status change
        issue.status = old.status;
        preservedCount++;
        // Preserve hidden_until if still active
        if (old.hidden_until && old.hidden_until > nowTs) {
          issue.hidden_until = old.hidden_until;
        }
      }
    }
    console.log(`Status preservation: ${preservedCount} issues kept their previous status`);

    // Only delete issue types managed by this sync for this country — preserve broken_redirect_url from check-urls
    for (const itype of syncManagedTypes) {
      await adminClient.from("issues").delete()
        .eq("sheet_id", spreadsheet_id).eq("sheet_name", sheetParam).eq("issue_type", itype).eq("country", countryCode);
    }

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

    console.log(`Total vouchers: ${dataRows.length}, Issues found: ${issues.length}, Inserted: ${inserted}`);

    return new Response(
      JSON.stringify({
        success: true,
        total_vouchers: dataRows.length,
        issues_found: issues.length,
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
