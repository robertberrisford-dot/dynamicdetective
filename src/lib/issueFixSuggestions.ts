// Maps issue_type -> short, actionable suggestion on how to resolve it.
export const ISSUE_FIX_SUGGESTIONS: Record<string, string> = {
  abc_missing_tnc:
    "Add the missing Terms & Conditions (T&C) to caption 2 or the voucher description so the ABC requirement is met.",
  abc_repeated_tnc:
    "Rewrite the T&C so each voucher has unique terms — duplicate T&C across vouchers breaks the ABC rule.",
  broken_redirect_url:
    "Open the redirect URL, verify with the affiliate network, and replace it with a working tracking link or pause the voucher.",
  caption_title_mismatch:
    "Align caption 1 with the discount stated in the voucher title (same value, type and currency).",
  code_missing_on_igraal:
    "Add the same voucher code on the iGraal sheet so both domains stay in sync.",
  code_missing_on_main:
    "Add the voucher code on the main domain sheet so both domains stay in sync.",
  duplicate_code:
    "Remove or merge the duplicate voucher code — only one active voucher should carry a given code.",
  metas_without_values:
    "Fill in the missing meta fields (title, description, keywords) for the retailer page.",
  missing_caption_1:
    "Replace the non-numerical caption 1 with a numeric value (e.g. '20', '15 €') so it can be parsed.",
  multiple_manual_picks:
    "Keep only one manually picked voucher per retailer — unmark the others.",
  repeated_caption_1:
    "Edit caption 1 so it differs from the other active vouchers of this retailer.",
  repeated_caption_combo:
    "Adjust caption 1 or caption 2 so the combination is unique among the retailer's active vouchers.",
  similar_titles:
    "Rewrite one of the voucher titles to be clearly distinct, or deactivate the duplicate.",
  stale_evergreen:
    "Verify the evergreen voucher is still valid; refresh the title/description or expire it if no longer working.",
  wrong_country_redirect_url:
    "Update the redirect URL to point to the correct country domain (e.g. .de target for the DE sheet).",
};

export function getFixSuggestion(issueType?: string | null): string | null {
  if (!issueType) return null;
  return ISSUE_FIX_SUGGESTIONS[issueType] ?? null;
}
