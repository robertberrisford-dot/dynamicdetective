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

  results.push({
    function_name: "check-urls",
    status: "skipped",
    message: "Skipped in scheduled-sync to avoid nested edge-function timeouts",
    details: null,
  });

  return new Response(
    JSON.stringify({ success: true, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
