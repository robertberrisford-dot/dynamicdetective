WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY sheet_id, sheet_name, issue_type,
                        COALESCE(retailer_pool_id, ''),
                        COALESCE(voucher_id_pool, '')
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.issues
  WHERE country = 'de'
    AND status IN ('open','in_progress')
)
DELETE FROM public.issues
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);