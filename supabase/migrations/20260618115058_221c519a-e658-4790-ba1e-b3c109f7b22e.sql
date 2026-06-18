
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY country, sheet_name, issue_type, COALESCE(retailer_pool_id,''), COALESCE(voucher_id_pool,'')
      ORDER BY
        CASE status
          WHEN 'not_allowed' THEN 1
          WHEN 'wont_fix'    THEN 2
          WHEN 'hidden_3m'   THEN 3
          WHEN 'resolved'    THEN 4
          WHEN 'done'        THEN 5
          WHEN 'ignored'     THEN 6
          WHEN 'in_progress' THEN 7
          WHEN 'open'        THEN 8
          ELSE 9
        END,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.issues
  WHERE issue_type IN ('missing_caption_1','metas_without_values','zero_caption_top_position','repeated_caption_1','repeated_caption_combo','stale_evergreen','abc_missing_tnc','abc_repeated_tnc','duplicate_code','caption_title_mismatch','multiple_manual_picks','similar_titles','code_missing_on_igraal','code_missing_on_main','wrong_country_redirect_url','action_code_blocking_real_code','deal_blocking_real_code','html_in_tnc','automatic_source_review')
)
DELETE FROM public.issues WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
