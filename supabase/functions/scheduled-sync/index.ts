import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SPREADSHEET_ID = "1bmlHyLXc0HwIjsZ0XklIbbGDGa2nO43VGfNe0cUHzU4";
const SHEET_NAME = "MYDEAL_DE_API_Vouchers (Preset)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const results: Array<{ function_name: string; status: string; message: string; details: unknown }> = [];

  // --- 1. Run Google Sheet Sync ---
  const syncLogId = crypto.randomUUID();
  await adminClient.from("sync_logs").insert({
    id: syncLogId,
    function_name: "sync-google-sheet",
    status: "running",
    message: "Starting sheet sync...",
    started_at: new Date().toISOString(),
  });

  try {
    const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-google-sheet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        spreadsheet_id: SPREADSHEET_ID,
        sheet_name: SHEET_NAME,
      }),
    });

    const syncData = await syncRes.json();

    if (!syncRes.ok || syncData.error) {
      throw new Error(syncData.error || `HTTP ${syncRes.status}`);
    }

    await adminClient.from("sync_logs").update({
      status: "success",
      message: `Synced ${syncData.synced || 0} issues, ${syncData.editors_synced || 0} editors`,
      details: syncData,
      finished_at: new Date().toISOString(),
    }).eq("id", syncLogId);

    results.push({ function_name: "sync-google-sheet", status: "success", message: `Synced ${syncData.synced} issues`, details: syncData });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await adminClient.from("sync_logs").update({
      status: "error",
      message,
      finished_at: new Date().toISOString(),
    }).eq("id", syncLogId);

    results.push({ function_name: "sync-google-sheet", status: "error", message, details: null });
  }

  // --- 2. Run URL Check (all URLs, batched) ---
  const urlLogId = crypto.randomUUID();
  await adminClient.from("sync_logs").insert({
    id: urlLogId,
    function_name: "check-urls",
    status: "running",
    message: "Starting URL check...",
    started_at: new Date().toISOString(),
  });

  try {
    const batchId = `scheduled-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let done = false;
    let totalChecked = 0;
    let totalToCheck = 0;

    while (!done) {
      const urlRes = await fetch(`${supabaseUrl}/functions/v1/check-urls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          spreadsheet_id: SPREADSHEET_ID,
          sheet_name: SHEET_NAME,
          batch_id: batchId,
        }),
      });

      const urlData = await urlRes.json();

      if (!urlRes.ok || urlData.error) {
        throw new Error(urlData.error || `HTTP ${urlRes.status}`);
      }

      totalChecked = urlData.total_checked;
      totalToCheck = urlData.total_to_check;
      done = urlData.done;
    }

    await adminClient.from("sync_logs").update({
      status: "success",
      message: `Checked ${totalChecked}/${totalToCheck} URLs`,
      details: { total_checked: totalChecked, total_to_check: totalToCheck, batch_id: batchId },
      finished_at: new Date().toISOString(),
    }).eq("id", urlLogId);

    results.push({ function_name: "check-urls", status: "success", message: `Checked ${totalChecked} URLs`, details: { totalChecked, totalToCheck } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await adminClient.from("sync_logs").update({
      status: "error",
      message,
      finished_at: new Date().toISOString(),
    }).eq("id", urlLogId);

    results.push({ function_name: "check-urls", status: "error", message, details: null });
  }

  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
