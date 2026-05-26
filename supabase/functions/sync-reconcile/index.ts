import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { run_id } = await req.json();
    if (!run_id) {
      return new Response(JSON.stringify({ error: "missing run_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: staging, error: stagingErr } = await adminClient
      .from("pending_sync_issues")
      .select("*")
      .eq("run_id", run_id)
      .maybeSingle();

    if (stagingErr || !staging) {
      return new Response(JSON.stringify({ error: "staging row not found", run_id }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const countryCode = staging.country_code as string;
    const spreadsheet_id = staging.spreadsheet_id as string;
    const sheetParam = staging.sheet_name as string;
    const payload = staging.payload as {
      issues: Record<string, unknown>[];
      activeVoucherPoolIds: string[];
      totalVouchers: number;
      editorsSynced: number;
      retailersSynced: number;
      retailerSheet: string;
    };
    const issues = payload.issues || [];
    const activeVoucherPoolIds = new Set<string>(payload.activeVoucherPoolIds || []);

    const syncManagedTypes = ['missing_caption_1','metas_without_values','zero_caption_top_position','repeated_caption_1','repeated_caption_combo','stale_evergreen','abc_missing_tnc','abc_repeated_tnc','duplicate_code','caption_title_mismatch','multiple_manual_picks','similar_titles','code_missing_on_igraal','code_missing_on_main','wrong_country_redirect_url','action_code_blocking_real_code','deal_blocking_real_code','html_in_tnc','automatic_source_review'];

    // Collect distinct (sheet_id, sheet_name) pairs from incoming issues.
    // Some checks (e.g. automatic_source_review on iGraal) emit issues tagged with the
    // iGraal sheet name rather than the request's sheetParam, so we must delete/re-insert
    // per-pair instead of only for the request's sheetParam.
    const sheetPairs = new Map<string, { sheet_id: string; sheet_name: string }>();
    sheetPairs.set(`${spreadsheet_id}|${sheetParam}`, { sheet_id: spreadsheet_id, sheet_name: sheetParam });
    for (const ni of issues) {
      const sid = String((ni as any).sheet_id || spreadsheet_id);
      const sname = String((ni as any).sheet_name || sheetParam);
      sheetPairs.set(`${sid}|${sname}`, { sheet_id: sid, sheet_name: sname });
    }

    // === Fetch existing issues across ALL involved sheet pairs (paged) ===
    // IMPORTANT: must ORDER BY a stable key, otherwise .range() can return
    // overlapping/missing pages on large result sets, causing existingIssues
    // to be under-populated. That made the snapshot mis-classify rows as
    // "new" and produced duplicate open issues over successive syncs.
    let existingIssues: Record<string, unknown>[] = [];
    for (const pair of sheetPairs.values()) {
      let eFrom = 0;
      while (true) {
        const { data: ePage } = await adminClient
          .from("issues")
          .select("id, issue_type, assigned_email, status, hidden_until, updated_at, created_at, retailer_pool_id, voucher_id_pool, sheet_id, sheet_name")
          .eq("sheet_id", pair.sheet_id)
          .eq("sheet_name", pair.sheet_name)
          .in("issue_type", syncManagedTypes)
          .order("id", { ascending: true })
          .range(eFrom, eFrom + 999);
        if (!ePage || ePage.length === 0) break;
        existingIssues = existingIssues.concat(ePage);
        if (ePage.length < 1000) break;
        eFrom += 1000;
      }
    }

    const issueKey = (rec: Record<string, unknown>) =>
      `${String(rec.sheet_name || "")}|${String(rec.issue_type || "")}|${String(rec.retailer_pool_id || "")}|${String(rec.voucher_id_pool || "")}`;

    const oldStatusMap = new Map<string, { status: string; hidden_until: string | null; updated_at: string; created_at: string }>();
    for (const oi of existingIssues) {
      const key = issueKey(oi);
      const status = String(oi.status || "open");
      if (!oldStatusMap.has(key) || status !== "open") {
        oldStatusMap.set(key, {
          status,
          hidden_until: oi.hidden_until as string | null,
          updated_at: String(oi.updated_at || ""),
          created_at: String(oi.created_at || ""),
        });
      }
    }

    const oldByKey = new Map<string, Record<string, unknown>>();
    for (const oi of existingIssues) {
      const k = `${oi.issue_type}|${(oi.assigned_email || "").toString().toLowerCase()}`;
      if (!oldByKey.has(k)) oldByKey.set(k, { count: 0, resolved: 0, statuses: [] as string[] });
      const entry = oldByKey.get(k)!;
      (entry as any).count++;
      (entry as any).statuses.push(oi.status);
      if (oi.status === 'done' || oi.status === 'ignored' || oi.status === 'not_allowed') (entry as any).resolved++;
    }

    const newByKey = new Map<string, number>();
    for (const ni of issues) {
      const k = `${ni.issue_type}|${(ni.assigned_email || "").toString().toLowerCase()}`;
      newByKey.set(k, (newByKey.get(k) || 0) + 1);
    }

    const syncRunId = new Date().toISOString();
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
    for (let i = 0; i < snapshots.length; i += 100) {
      await adminClient.from("sync_snapshots").insert(snapshots.slice(i, i + 100));
    }
    console.log(`Analytics: ${snapshots.length} snapshot rows recorded`);

    const nowTs = new Date().toISOString();
    let preservedCount = 0;
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    for (const issue of issues) {
      const key = issueKey(issue);
      const old = oldStatusMap.get(key);
      // ALWAYS set created_at so every row in a batch has the same columns.
      // Mixed columns -> supabase-js inserts explicit NULLs -> NOT NULL violation.
      if (old?.created_at && isoRe.test(old.created_at)) {
        issue.created_at = old.created_at;
      } else {
        issue.created_at = nowTs;
      }
      issue.updated_at = nowTs;
      if (old && old.status !== "open") {
        issue.status = old.status;
        preservedCount++;
        if (old.hidden_until && old.hidden_until > nowTs) {
          issue.hidden_until = old.hidden_until;
        }
      }
    }
    console.log(`Status preservation: ${preservedCount} issues kept their previous status`);

    // Only delete rows that are still "active" (open / in_progress).
    // Terminal statuses (not_allowed, wont_fix, resolved, done, ignored) are preserved
    // across syncs so that transient checks like code_missing_on_igraal don't
    // resurrect as fresh "open" issues when the check flickers between runs.
    for (const pair of sheetPairs.values()) {
      await adminClient.from("issues").delete()
        .eq("sheet_id", pair.sheet_id)
        .eq("sheet_name", pair.sheet_name)
        .eq("country", countryCode)
        .in("issue_type", syncManagedTypes)
        .in("status", ["open", "in_progress"]);
    }

    // Drop incoming issues whose key already exists with a terminal status,
    // so we don't try to insert a duplicate "open" row alongside the preserved one.
    const terminalKeys = new Set<string>();
    for (const oi of existingIssues) {
      const st = String(oi.status || "open");
      if (st !== "open" && st !== "in_progress") terminalKeys.add(issueKey(oi));
    }
    const beforeFilter = issues.length;
    const filteredIssues = issues.filter((ni) => !terminalKeys.has(issueKey(ni as Record<string, unknown>)));
    const droppedDup = beforeFilter - filteredIssues.length;
    if (droppedDup > 0) console.log(`Skipped ${droppedDup} incoming issues that already exist with a terminal status`);
    issues.length = 0;
    issues.push(...filteredIssues);

    // Auto-resolve broken_redirect_url for inactive vouchers
    const staleBroken: string[] = [];
    let brOffset = 0;
    const BR_PAGE = 1000;
    while (true) {
      const { data: brIssues } = await adminClient
        .from("issues")
        .select("id, voucher_id_pool")
        .eq("issue_type", "broken_redirect_url")
        .eq("country", countryCode)
        .eq("sheet_id", spreadsheet_id)
        .eq("sheet_name", sheetParam)
        .in("status", ["open", "in_progress"])
        .range(brOffset, brOffset + BR_PAGE - 1);
      if (!brIssues || brIssues.length === 0) break;
      for (const it of brIssues) {
        const vpid = String(it.voucher_id_pool || "");
        if (!vpid || !activeVoucherPoolIds.has(vpid)) staleBroken.push(it.id as string);
      }
      if (brIssues.length < BR_PAGE) break;
      brOffset += BR_PAGE;
    }
    if (staleBroken.length > 0) {
      console.log(`Auto-resolving ${staleBroken.length} stale broken_redirect_url issues`);
      for (let i = 0; i < staleBroken.length; i += 200) {
        await adminClient.from("issues")
          .update({ status: "resolved", updated_at: new Date().toISOString() })
          .in("id", staleBroken.slice(i, i + 200));
      }
    }

    let inserted = 0;
    let failedRows = 0;
    for (let i = 0; i < issues.length; i += 100) {
      const batch = issues.slice(i, i + 100);
      const { error: insertError } = await adminClient.from("issues").insert(batch);
      if (insertError) {
        console.error(`Batch insert error (rows ${i}-${i + batch.length}):`, insertError.message);
        for (const row of batch) {
          const { error: rowErr } = await adminClient.from("issues").insert(row);
          if (rowErr) {
            failedRows++;
            console.error(`Row insert failed (issue_type=${row.issue_type}):`, rowErr.message);
          } else inserted++;
        }
      } else inserted += batch.length;
    }
    if (failedRows > 0) console.warn(`Reconcile completed with ${failedRows} failed row(s)`);

    // Clean up staging
    await adminClient.from("pending_sync_issues").delete().eq("run_id", run_id);

    // Update sync_logs to success
    await adminClient.from("sync_logs").insert({
      function_name: "sync-reconcile",
      status: "success",
      message: `[${countryCode.toUpperCase()}] Reconciled ${inserted} issues`,
      finished_at: new Date().toISOString(),
      details: {
        run_id,
        total_vouchers: payload.totalVouchers,
        issues_found: issues.length,
        synced: inserted,
        editors_synced: payload.editorsSynced,
        retailers_synced: payload.retailersSynced,
        sheet: sheetParam,
        retailer_sheet: payload.retailerSheet,
      },
    });

    console.log(`Reconcile done: ${issues.length} issues, ${inserted} inserted`);
    return new Response(JSON.stringify({ success: true, inserted, issues_found: issues.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Reconcile error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
