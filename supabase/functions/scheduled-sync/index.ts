import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const body = await req.json().catch(() => ({}));
  const mode = body.mode || "full";

  const results: Array<{ function_name: string; status: string; message: string; details: unknown }> = [];

  // --- Clean up stuck "running" logs older than 30 minutes ---
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await adminClient.from("sync_logs").update({
    status: "error",
    message: "Timed out (stuck in running state)",
    finished_at: new Date().toISOString(),
  }).eq("status", "running").lt("started_at", thirtyMinAgo);

  // --- Fetch all enabled country configs ---
  const { data: countries } = await adminClient
    .from("country_configs")
    .select("*")
    .eq("enabled", true);

  if (!countries || countries.length === 0) {
    return new Response(
      JSON.stringify({ success: false, message: "No country configs found" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- 1. Sheet Sync for each country (only in "full" mode) ---
  if (mode === "full") {
    for (const country of countries) {
      const syncLogId = crypto.randomUUID();
      await adminClient.from("sync_logs").insert({
        id: syncLogId,
        function_name: "sync-google-sheet",
        status: "running",
        message: `Starting sheet sync for ${country.label} (${country.country_code})...`,
        started_at: new Date().toISOString(),
      });

      try {
        const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-google-sheet`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            spreadsheet_id: country.voucher_spreadsheet_id,
            sheet_name: country.voucher_sheet_name,
            country_code: country.country_code,
          }),
        });
        const syncData = await syncRes.json();
        if (!syncRes.ok || syncData.error) throw new Error(syncData.error || `HTTP ${syncRes.status}`);

        await adminClient.from("sync_logs").update({
          status: "success",
          message: `[${country.country_code.toUpperCase()}] Synced ${syncData.synced || 0} issues, ${syncData.editors_synced || 0} editors`,
          details: syncData,
          finished_at: new Date().toISOString(),
        }).eq("id", syncLogId);
        results.push({ function_name: `sync-google-sheet-${country.country_code}`, status: "success", message: `Synced ${syncData.synced} issues`, details: syncData });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await adminClient.from("sync_logs").update({ status: "error", message: `[${country.country_code.toUpperCase()}] ${message}`, finished_at: new Date().toISOString() }).eq("id", syncLogId);
        results.push({ function_name: `sync-google-sheet-${country.country_code}`, status: "error", message, details: null });
      }
    }
  }

  // --- 2. URL Check — single batch (use first country for now) ---
  const primaryCountry = countries[0];
  const batchId = `scheduled-${new Date().toISOString().slice(0, 10)}`;

  const { data: todayLogs } = await adminClient.from("sync_logs")
    .select("message")
    .eq("function_name", "check-urls")
    .eq("status", "success")
    .gte("created_at", new Date().toISOString().slice(0, 10) + "T00:00:00Z")
    .like("message", "Completed:%")
    .limit(1);

  if (todayLogs && todayLogs.length > 0) {
    results.push({ function_name: "check-urls", status: "skipped", message: "Already completed for today", details: null });
  } else {
    const urlLogId = crypto.randomUUID();
    await adminClient.from("sync_logs").insert({
      id: urlLogId,
      function_name: "check-urls",
      status: "running",
      message: "Starting URL check batch...",
      started_at: new Date().toISOString(),
    });

    try {
      const urlRes = await fetch(`${supabaseUrl}/functions/v1/check-urls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          spreadsheet_id: primaryCountry.voucher_spreadsheet_id,
          sheet_name: primaryCountry.voucher_sheet_name,
          batch_id: batchId,
        }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || urlData.error) throw new Error(urlData.error || `HTTP ${urlRes.status}`);

      const statusMsg = urlData.done
        ? `Completed: ${urlData.total_checked}/${urlData.total_to_check} URLs checked`
        : `Batch done: ${urlData.total_checked}/${urlData.total_to_check} URLs (continuing next run)`;

      await adminClient.from("sync_logs").update({
        status: "success",
        message: statusMsg,
        details: { ...urlData, batch_id: batchId },
        finished_at: new Date().toISOString(),
      }).eq("id", urlLogId);
      results.push({ function_name: "check-urls", status: "success", message: statusMsg, details: urlData });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await adminClient.from("sync_logs").update({ status: "error", message, finished_at: new Date().toISOString() }).eq("id", urlLogId);
      results.push({ function_name: "check-urls", status: "error", message, details: null });
    }
  }

  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
