import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function parseFunctionResponse(res: Response) {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {
      data: null,
      parseError: "Empty response body",
      rawText,
    };
  }

  try {
    return {
      data: JSON.parse(trimmed),
      parseError: null,
      rawText,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON response";
    return {
      data: null,
      parseError: message,
      rawText,
    };
  }
}

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
        const { data: syncData, parseError, rawText } = await parseFunctionResponse(syncRes);
        if (parseError) {
          throw new Error(`sync-google-sheet returned invalid JSON (${parseError})${rawText ? `: ${rawText.slice(0, 300)}` : ""}`);
        }
        if (!syncRes.ok || syncData?.error) throw new Error(syncData?.error || `HTTP ${syncRes.status}`);

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

  // --- 2. URL Check (run in both "full" and "url-only" modes) ---
  // Loop check-urls per country until done or until we approach the edge function wall time.
  const startedAt = Date.now();
  const MAX_RUNTIME_MS = 9 * 60 * 1000; // stop scheduling new batches after ~9 min
  const today = new Date().toISOString().slice(0, 10);

  for (const country of countries) {
    if (!country.voucher_spreadsheet_id || !country.voucher_sheet_name) continue;
    const batchId = `scheduled-${country.country_code}-${today}`;
    const urlLogId = crypto.randomUUID();
    await adminClient.from("sync_logs").insert({
      id: urlLogId,
      function_name: "check-urls",
      status: "running",
      message: `Starting URL checks for ${country.label} (${country.country_code})...`,
      started_at: new Date().toISOString(),
    });

    let totalChecked = 0;
    let totalErrors = 0;
    let batchCount = 0;
    let done = false;
    let lastError: string | null = null;

    try {
      while (!done && Date.now() - startedAt < MAX_RUNTIME_MS) {
        const res = await fetch(`${supabaseUrl}/functions/v1/check-urls`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            spreadsheet_id: country.voucher_spreadsheet_id,
            sheet_name: country.voucher_sheet_name,
            batch_id: batchId,
          }),
        });
        const { data, parseError, rawText } = await parseFunctionResponse(res);
        if (parseError) {
          lastError = `check-urls invalid JSON (${parseError})${rawText ? `: ${rawText.slice(0, 200)}` : ""}`;
          break;
        }
        if (!res.ok || data?.error) {
          lastError = data?.error || `HTTP ${res.status}`;
          break;
        }
        batchCount++;
        totalChecked = data.total_checked ?? totalChecked;
        totalErrors += data.errors_found ?? 0;
        done = !!data.done;
        if (data.checked_this_batch === 0 && !done) {
          // No progress — bail to avoid infinite loop
          break;
        }
      }

      await adminClient.from("sync_logs").update({
        status: lastError ? "error" : "success",
        message: lastError
          ? `[${country.country_code.toUpperCase()}] ${lastError} (after ${batchCount} batches, ${totalChecked} checked)`
          : `[${country.country_code.toUpperCase()}] ${batchCount} batches, ${totalChecked} URLs checked, ${totalErrors} errors${done ? " (complete)" : " (partial — will resume next run)"}`,
        details: { batch_id: batchId, batches: batchCount, total_checked: totalChecked, errors_found: totalErrors, done },
        finished_at: new Date().toISOString(),
      }).eq("id", urlLogId);

      results.push({
        function_name: `check-urls-${country.country_code}`,
        status: lastError ? "error" : "success",
        message: lastError || `${batchCount} batches, ${totalChecked} checked, ${totalErrors} errors${done ? "" : " (partial)"}`,
        details: { batch_id: batchId, batches: batchCount, total_checked: totalChecked, errors_found: totalErrors, done },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await adminClient.from("sync_logs").update({
        status: "error",
        message: `[${country.country_code.toUpperCase()}] ${message}`,
        finished_at: new Date().toISOString(),
      }).eq("id", urlLogId);
      results.push({ function_name: `check-urls-${country.country_code}`, status: "error", message, details: null });
    }

    if (Date.now() - startedAt >= MAX_RUNTIME_MS) {
      console.log("Approaching wall time; stopping URL checks for remaining countries");
      break;
    }
  }

  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
