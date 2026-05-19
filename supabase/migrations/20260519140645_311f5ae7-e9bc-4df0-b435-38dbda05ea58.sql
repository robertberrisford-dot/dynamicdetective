
INSERT INTO public.country_configs (country_code, label, voucher_spreadsheet_id, voucher_sheet_name, editors_sheet_name, retailer_spreadsheet_id, retailer_sheet_name, enabled)
VALUES ('uk', 'United Kingdom', '1cqppI7FWyBopAJKetmT4vlB6WQ7AgmQcCA1vwDAIgi4', 'API-Vouchers-UK(PReset)', 'Editors', '1fgzLXv6jxCprt_3tvBBVCsf1snOXzm9jMeJkgza5NUE', 'UK Retailer HUK', true);

INSERT INTO public.check_configs (country_code, issue_type, label, enabled, severity) VALUES
('uk','abc_missing_tnc','ABC code missing T&C',true,'issue'),
('uk','abc_repeated_tnc','ABC code repeated T&C',false,'issue'),
('uk','action_code_blocking_real_code','Action code blocking real code at position 1',true,'warning'),
('uk','broken_redirect_url','Broken redirect URL',false,'issue'),
('uk','caption_title_mismatch','Caption / title mismatch',true,'issue'),
('uk','code_missing_on_igraal','Code missing on iGraal',false,'issue'),
('uk','code_missing_on_main','Code missing on main domain',false,'issue'),
('uk','duplicate_code','Duplicate code',true,'issue'),
('uk','html_in_tnc','HTML in T&C',true,'warning'),
('uk','metas_without_values','Metas without values',true,'issue'),
('uk','missing_caption_1','Missing caption 1',false,'issue'),
('uk','multiple_manual_picks','Multiple manual picks',true,'issue'),
('uk','repeated_caption_1','Repeated caption 1',true,'warning'),
('uk','repeated_caption_combo','Repeated caption combo',true,'warning'),
('uk','similar_titles','Similar titles',true,'warning'),
('uk','stale_evergreen','Stale evergreen',true,'warning'),
('uk','wrong_country_redirect_url','Wrong country redirect URL',true,'warning'),
('uk','zero_caption_top_position','Zero caption at top position',true,'issue');
