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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  // Run countries sequentially and throttle batches to avoid backend function rate limits.
  // Each check-urls call processes a small sheet range and records progress for the next run.
  const startedAt = Date.now();
  const MAX_RUNTIME_MS = 8 * 60 * 1000; // overall wall budget
  const PER_CALL_TIMEOUT_MS = 90 * 1000; // abort an individual check-urls invocation after 90s
  const MAX_BATCHES_PER_COUNTRY = 8;
  const DELAY_BETWEEN_BATCHES_MS = 1500;
  const today = new Date().toISOString().slice(0, 10);

  async function runUrlCheckForCountry(country: any) {
    if (!country.voucher_spreadsheet_id || !country.voucher_sheet_name) return;
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
    let timedOut = false;
    let startRow = 2;

    const { data: previousLogs } = await adminClient
      .from("sync_logs")
      .select("details, message, started_at")
      .eq("function_name", "check-urls")
      .order("started_at", { ascending: false })
      .limit(30);
    const previousForCountry = (previousLogs || []).find((log: any) =>
      log.details?.batch_id === batchId || String(log.message || "").startsWith(`[${country.country_code.toUpperCase()}]`)
    );
    if (previousForCountry?.details?.batch_id === batchId) {
      totalChecked = previousForCountry.details.total_checked ?? 0;
      totalErrors = previousForCountry.details.errors_found ?? 0;
      if (previousForCountry.details.done) {
        done = true;
      } else if (Number(previousForCountry.details.next_start_row) >= 2) {
        startRow = Number(previousForCountry.details.next_start_row);
      }
    }

    try {
      while (!done && Date.now() - startedAt < MAX_RUNTIME_MS) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(`${supabaseUrl}/functions/v1/check-urls`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              spreadsheet_id: country.voucher_spreadsheet_id,
              sheet_name: country.voucher_sheet_name,
              batch_id: batchId,
              start_row: startRow,
            }),
            signal: ctrl.signal,
          });
        } catch (fetchErr: unknown) {
          const m = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          if (m.includes("abort")) {
            timedOut = true;
            lastError = `per-call timeout after ${PER_CALL_TIMEOUT_MS}ms`;
          } else {
            lastError = m;
          }
          break;
        } finally {
          clearTimeout(timer);
        }

        if (res.status === 504 || res.status === 408) {
          timedOut = true;
          lastError = `HTTP ${res.status} (gateway timeout)`;
          break;
        }

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
        startRow = data.next_start_row ?? startRow;
        done = !!data.done;
      }

      const status: "success" | "error" =
        (lastError && (!timedOut || batchCount === 0)) ? "error" : "success";

      const baseMsg = `[${country.country_code.toUpperCase()}] ${batchCount} batches, ${totalChecked} URLs checked, ${totalErrors} errors`;
      const message = status === "error"
        ? `${baseMsg} — ${lastError}`
        : timedOut
          ? `${baseMsg} (partial, timed out — will resume next run)`
          : done
            ? `${baseMsg} (complete)`
            : `${baseMsg} (partial — will resume next run)`;

      await adminClient.from("sync_logs").update({
        status,
        message,
        details: { batch_id: batchId, batches: batchCount, total_checked: totalChecked, errors_found: totalErrors, done, timed_out: timedOut, next_start_row: startRow },
        finished_at: new Date().toISOString(),
      }).eq("id", urlLogId);

      results.push({
        function_name: `check-urls-${country.country_code}`,
        status,
        message,
        details: { batch_id: batchId, batches: batchCount, total_checked: totalChecked, errors_found: totalErrors, done, timed_out: timedOut, next_start_row: startRow },
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
  }

  // Run all countries' URL checks in parallel
  await Promise.all(countries.map(runUrlCheckForCountry));

  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
