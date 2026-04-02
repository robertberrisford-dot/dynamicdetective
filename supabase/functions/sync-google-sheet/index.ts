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
    // Fetch ALL retailer assignments (paginate to avoid 1000-row limit)
    let allRetailers: { retailer_pool_id: string | null; retailer_assignment: string | null; seo_url: string | null }[] = [];
    let rFrom = 0;
    const rPageSize = 1000;
    while (true) {
      const { data: rPage } = await adminClient
        .from("retailers")
        .select("retailer_pool_id, retailer_assignment, seo_url")
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

    // Process vouchers — collect all parsed records
    const allRecords: Record<string, unknown>[] = [];

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
        // Store non-DB columns for processing only (prefixed with _)
        if (header === "voucher_automatic_extension_type" && row[idx] !== undefined) {
          record._extension_type = row[idx];
        }
        if (header === "voucher_started_at" && row[idx] !== undefined) {
          record._started_at = row[idx];
        }
      });

      // Convert is_voucher_active to boolean
      if (record.is_voucher_active !== undefined) {
        record.is_voucher_active = record.is_voucher_active === true || record.is_voucher_active === "true" || record.is_voucher_active === "TRUE" || record.is_voucher_active === 1;
      }

      // Look up assignment from retailers table
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
      }

      allRecords.push(record);
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
    for (const [pattern, affectedVouchers] of tncPatterns) {
      if (affectedVouchers.length > 3) {
        const template = affectedVouchers[0];
        const preview = pattern.length > 80 ? pattern.substring(0, 80) + "…" : pattern;
        const voucherList = affectedVouchers.map(v =>
          `• ${v.voucher_title || "Untitled"} (${v.client_name || "?"}) - Pos ${v.voucher_position || "?"}`
        ).join("\n");

        issues.push({
          sheet_id: spreadsheet_id,
          sheet_name: sheetParam,
          status: "open",
          retailer_pool_id: template.retailer_pool_id,
          client_name: template.client_name,
          assigned_email: template.assigned_email,
          retailer_assignment: template.retailer_assignment,
          merchant_quality: template.merchant_quality,
          indexed: template.indexed,
          seo_url: template.seo_url,
          voucher_terms_and_conditions: pattern,
          voucher_title: `Repeated T&C pattern (${affectedVouchers.length}x): "${preview}"`,
          voucher_description: voucherList,
          issue_type: "abc_repeated_tnc",
        });
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

    // Strip _meta fields from all records and issues before insert
    for (const record of allRecords) {
      delete record._extension_type;
      delete record._started_at;
    }
    for (const issue of issues) {
      delete issue._extension_type;
      delete issue._started_at;
    }

    // Only delete issue types managed by this sync — preserve broken_redirect_url from check-urls
    const syncManagedTypes = ['missing_caption_1', 'metas_without_values', 'repeated_caption_1', 'repeated_caption_combo', 'stale_evergreen', 'abc_missing_tnc', 'abc_repeated_tnc', 'duplicate_code'];
    for (const itype of syncManagedTypes) {
      await adminClient.from("issues").delete()
        .eq("sheet_id", spreadsheet_id).eq("sheet_name", sheetParam).eq("issue_type", itype);
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
