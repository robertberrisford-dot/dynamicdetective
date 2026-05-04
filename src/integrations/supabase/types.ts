export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      check_configs: {
        Row: {
          country_code: string
          created_at: string
          enabled: boolean
          id: string
          issue_type: string
          label: string
          severity: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          issue_type: string
          label: string
          severity?: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          issue_type?: string
          label?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          comment_text: string
          created_at: string
          id: string
          issue_id: string | null
          retailer_pool_id: string | null
          user_email: string
          user_id: string
          voucher_id_pool: string | null
        }
        Insert: {
          comment_text: string
          created_at?: string
          id?: string
          issue_id?: string | null
          retailer_pool_id?: string | null
          user_email: string
          user_id: string
          voucher_id_pool?: string | null
        }
        Update: {
          comment_text?: string
          created_at?: string
          id?: string
          issue_id?: string | null
          retailer_pool_id?: string | null
          user_email?: string
          user_id?: string
          voucher_id_pool?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      country_configs: {
        Row: {
          country_code: string
          created_at: string
          editors_sheet_name: string | null
          enabled: boolean | null
          id: string
          label: string
          retailer_sheet_name: string
          retailer_spreadsheet_id: string
          team_lead_email: string | null
          updated_at: string
          voucher_sheet_name: string
          voucher_spreadsheet_id: string
        }
        Insert: {
          country_code: string
          created_at?: string
          editors_sheet_name?: string | null
          enabled?: boolean | null
          id?: string
          label: string
          retailer_sheet_name: string
          retailer_spreadsheet_id: string
          team_lead_email?: string | null
          updated_at?: string
          voucher_sheet_name: string
          voucher_spreadsheet_id: string
        }
        Update: {
          country_code?: string
          created_at?: string
          editors_sheet_name?: string | null
          enabled?: boolean | null
          id?: string
          label?: string
          retailer_sheet_name?: string
          retailer_spreadsheet_id?: string
          team_lead_email?: string | null
          updated_at?: string
          voucher_sheet_name?: string
          voucher_spreadsheet_id?: string
        }
        Relationships: []
      }
      editors: {
        Row: {
          country: string | null
          created_at: string
          email: string
          id: string
          name: string | null
          role: string
          team_lead_email: string | null
          updated_at: string
          vacation_substitute_email: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          email: string
          id?: string
          name?: string | null
          role?: string
          team_lead_email?: string | null
          updated_at?: string
          vacation_substitute_email?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          role?: string
          team_lead_email?: string | null
          updated_at?: string
          vacation_substitute_email?: string | null
        }
        Relationships: []
      }
      issue_status_updates: {
        Row: {
          assigned_email_snapshot: string | null
          client_name: string | null
          created_at: string
          id: string
          issue_id: string | null
          issue_type: string | null
          new_status: string
          old_status: string | null
          retailer_pool_id: string | null
          updated_by: string
          updated_by_email: string
          voucher_id_pool: string | null
        }
        Insert: {
          assigned_email_snapshot?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          issue_type?: string | null
          new_status: string
          old_status?: string | null
          retailer_pool_id?: string | null
          updated_by: string
          updated_by_email: string
          voucher_id_pool?: string | null
        }
        Update: {
          assigned_email_snapshot?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          issue_type?: string | null
          new_status?: string
          old_status?: string | null
          retailer_pool_id?: string | null
          updated_by?: string
          updated_by_email?: string
          voucher_id_pool?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_status_updates_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          active_codes: string | null
          active_deals: string | null
          active_vouchers: string | null
          affiliate_network: string | null
          assigned_email: string | null
          client_name: string | null
          country: string | null
          created_at: string
          h1: string | null
          hidden_until: string | null
          id: string
          indexed: string | null
          is_voucher_active: boolean | null
          issue_type: string | null
          keyword_1: string | null
          keyword_2: string | null
          keyword_3: string | null
          keyword_4: string | null
          last_verified: string | null
          logo_alt_text: string | null
          merchant_quality: string | null
          page_title: string | null
          published: string | null
          ranking_algorithm: string | null
          retailer_assignment: string | null
          retailer_id: string | null
          retailer_pool_id: string | null
          retailer_seo_desc: string | null
          retailer_seo_title: string | null
          retailer_url: string | null
          retailer_url_anchor: string | null
          seo_url: string | null
          sheet_id: string | null
          sheet_name: string | null
          show_expired_vouchers: string | null
          status: string
          updated_at: string
          url_anchor_js_link: string | null
          voucher_caption_1: string | null
          voucher_caption_2: string | null
          voucher_caption_text_1: string | null
          voucher_category: string | null
          voucher_code: string | null
          voucher_description: string | null
          voucher_id_pool: string | null
          voucher_position: string | null
          voucher_source: string | null
          voucher_start_date: string | null
          voucher_terms_and_conditions: string | null
          voucher_title: string | null
          voucher_type: string | null
        }
        Insert: {
          active_codes?: string | null
          active_deals?: string | null
          active_vouchers?: string | null
          affiliate_network?: string | null
          assigned_email?: string | null
          client_name?: string | null
          country?: string | null
          created_at?: string
          h1?: string | null
          hidden_until?: string | null
          id?: string
          indexed?: string | null
          is_voucher_active?: boolean | null
          issue_type?: string | null
          keyword_1?: string | null
          keyword_2?: string | null
          keyword_3?: string | null
          keyword_4?: string | null
          last_verified?: string | null
          logo_alt_text?: string | null
          merchant_quality?: string | null
          page_title?: string | null
          published?: string | null
          ranking_algorithm?: string | null
          retailer_assignment?: string | null
          retailer_id?: string | null
          retailer_pool_id?: string | null
          retailer_seo_desc?: string | null
          retailer_seo_title?: string | null
          retailer_url?: string | null
          retailer_url_anchor?: string | null
          seo_url?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          show_expired_vouchers?: string | null
          status?: string
          updated_at?: string
          url_anchor_js_link?: string | null
          voucher_caption_1?: string | null
          voucher_caption_2?: string | null
          voucher_caption_text_1?: string | null
          voucher_category?: string | null
          voucher_code?: string | null
          voucher_description?: string | null
          voucher_id_pool?: string | null
          voucher_position?: string | null
          voucher_source?: string | null
          voucher_start_date?: string | null
          voucher_terms_and_conditions?: string | null
          voucher_title?: string | null
          voucher_type?: string | null
        }
        Update: {
          active_codes?: string | null
          active_deals?: string | null
          active_vouchers?: string | null
          affiliate_network?: string | null
          assigned_email?: string | null
          client_name?: string | null
          country?: string | null
          created_at?: string
          h1?: string | null
          hidden_until?: string | null
          id?: string
          indexed?: string | null
          is_voucher_active?: boolean | null
          issue_type?: string | null
          keyword_1?: string | null
          keyword_2?: string | null
          keyword_3?: string | null
          keyword_4?: string | null
          last_verified?: string | null
          logo_alt_text?: string | null
          merchant_quality?: string | null
          page_title?: string | null
          published?: string | null
          ranking_algorithm?: string | null
          retailer_assignment?: string | null
          retailer_id?: string | null
          retailer_pool_id?: string | null
          retailer_seo_desc?: string | null
          retailer_seo_title?: string | null
          retailer_url?: string | null
          retailer_url_anchor?: string | null
          seo_url?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          show_expired_vouchers?: string | null
          status?: string
          updated_at?: string
          url_anchor_js_link?: string | null
          voucher_caption_1?: string | null
          voucher_caption_2?: string | null
          voucher_caption_text_1?: string | null
          voucher_category?: string | null
          voucher_code?: string | null
          voucher_description?: string | null
          voucher_id_pool?: string | null
          voucher_position?: string | null
          voucher_source?: string | null
          voucher_start_date?: string | null
          voucher_terms_and_conditions?: string | null
          voucher_title?: string | null
          voucher_type?: string | null
        }
        Relationships: []
      }
      retailers: {
        Row: {
          active_codes: string | null
          active_deals: string | null
          active_vouchers: string | null
          affiliate_network: string | null
          categories: string | null
          client: string | null
          client_id: string | null
          client_name: string | null
          country: string | null
          created_at: string
          dynamic_vouchers: string | null
          id: string
          indexed: string | null
          keyword_1: string | null
          keyword_2: string | null
          keyword_3: string | null
          keyword_4: string | null
          logo_alt_text: string | null
          merchant_quality: string | null
          old_merchant_id: string | null
          page_published: string | null
          published: string | null
          ranking_algorithm: string | null
          retailer_assignment: string | null
          retailer_pool_id: string | null
          retailer_seo_desc: string | null
          retailer_seo_title: string | null
          retailer_url: string | null
          retailer_url_anchor: string | null
          seo_url: string | null
          updated_at: string
        }
        Insert: {
          active_codes?: string | null
          active_deals?: string | null
          active_vouchers?: string | null
          affiliate_network?: string | null
          categories?: string | null
          client?: string | null
          client_id?: string | null
          client_name?: string | null
          country?: string | null
          created_at?: string
          dynamic_vouchers?: string | null
          id?: string
          indexed?: string | null
          keyword_1?: string | null
          keyword_2?: string | null
          keyword_3?: string | null
          keyword_4?: string | null
          logo_alt_text?: string | null
          merchant_quality?: string | null
          old_merchant_id?: string | null
          page_published?: string | null
          published?: string | null
          ranking_algorithm?: string | null
          retailer_assignment?: string | null
          retailer_pool_id?: string | null
          retailer_seo_desc?: string | null
          retailer_seo_title?: string | null
          retailer_url?: string | null
          retailer_url_anchor?: string | null
          seo_url?: string | null
          updated_at?: string
        }
        Update: {
          active_codes?: string | null
          active_deals?: string | null
          active_vouchers?: string | null
          affiliate_network?: string | null
          categories?: string | null
          client?: string | null
          client_id?: string | null
          client_name?: string | null
          country?: string | null
          created_at?: string
          dynamic_vouchers?: string | null
          id?: string
          indexed?: string | null
          keyword_1?: string | null
          keyword_2?: string | null
          keyword_3?: string | null
          keyword_4?: string | null
          logo_alt_text?: string | null
          merchant_quality?: string | null
          old_merchant_id?: string | null
          page_published?: string | null
          published?: string | null
          ranking_algorithm?: string | null
          retailer_assignment?: string | null
          retailer_pool_id?: string | null
          retailer_seo_desc?: string | null
          retailer_seo_title?: string | null
          retailer_url?: string | null
          retailer_url_anchor?: string | null
          seo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          created_at: string
          details: Json | null
          finished_at: string | null
          function_name: string
          id: string
          message: string | null
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          finished_at?: string | null
          function_name: string
          id?: string
          message?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          finished_at?: string | null
          function_name?: string
          id?: string
          message?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      sync_snapshots: {
        Row: {
          editor_email: string | null
          id: string
          issue_count: number
          issue_type: string
          issues_disappeared: number
          issues_new: number
          issues_resolved: number
          sync_run_id: string
          synced_at: string
        }
        Insert: {
          editor_email?: string | null
          id?: string
          issue_count?: number
          issue_type: string
          issues_disappeared?: number
          issues_new?: number
          issues_resolved?: number
          sync_run_id: string
          synced_at?: string
        }
        Update: {
          editor_email?: string | null
          id?: string
          issue_count?: number
          issue_type?: string
          issues_disappeared?: number
          issues_new?: number
          issues_resolved?: number
          sync_run_id?: string
          synced_at?: string
        }
        Relationships: []
      }
      url_check_results: {
        Row: {
          assigned_email: string | null
          batch_id: string
          checked_at: string
          client_name: string | null
          created_at: string
          error_message: string | null
          http_status: number | null
          id: string
          is_error: boolean
          redirect_url: string
          retailer_pool_id: string | null
          sheet_id: string | null
          sheet_name: string | null
          voucher_id_pool: string
        }
        Insert: {
          assigned_email?: string | null
          batch_id: string
          checked_at?: string
          client_name?: string | null
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          is_error?: boolean
          redirect_url: string
          retailer_pool_id?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          voucher_id_pool: string
        }
        Update: {
          assigned_email?: string | null
          batch_id?: string
          checked_at?: string
          client_name?: string | null
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          is_error?: boolean
          redirect_url?: string
          retailer_pool_id?: string | null
          sheet_id?: string | null
          sheet_name?: string | null
          voucher_id_pool?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_vacation_substitute: {
        Args: { _assigned_email: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "team_lead" | "ops_lead"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "team_lead", "ops_lead"],
    },
  },
} as const
