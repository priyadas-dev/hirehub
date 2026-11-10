export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      agent_sessions: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string;
          memory: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          conversation_id: string;
          memory?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          conversation_id?: string;
          memory?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /** PROPOSED_0025 — live-generated shape from project munqgybiuqpncxbgfvdp (surgical patch; full gen was too large vs curated types). */
      interview_schedules: {
        Row: {
          application_id: string;
          conference_attempt: number;
          conference_status: string;
          created_at: string;
          end_at: string;
          etag: string | null;
          failure_reason: string | null;
          google_calendar_id: string | null;
          google_event_id: string | null;
          html_link: string | null;
          id: string;
          invited_at: string | null;
          job_id: string;
          last_synced_at: string | null;
          lease_until: string | null;
          meet_link: string | null;
          recruiter_id: string;
          recruiter_response: string;
          reschedule_count: number;
          scheduled_by: string | null;
          seeker_id: string;
          seeker_response: string;
          start_at: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          application_id: string;
          conference_attempt?: number;
          conference_status?: string;
          created_at?: string;
          end_at: string;
          etag?: string | null;
          failure_reason?: string | null;
          google_calendar_id?: string | null;
          google_event_id?: string | null;
          html_link?: string | null;
          id?: string;
          invited_at?: string | null;
          job_id: string;
          last_synced_at?: string | null;
          lease_until?: string | null;
          meet_link?: string | null;
          recruiter_id: string;
          recruiter_response?: string;
          reschedule_count?: number;
          scheduled_by?: string | null;
          seeker_id: string;
          seeker_response?: string;
          start_at: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          application_id?: string;
          conference_attempt?: number;
          conference_status?: string;
          created_at?: string;
          end_at?: string;
          etag?: string | null;
          failure_reason?: string | null;
          google_calendar_id?: string | null;
          google_event_id?: string | null;
          html_link?: string | null;
          id?: string;
          invited_at?: string | null;
          job_id?: string;
          last_synced_at?: string | null;
          lease_until?: string | null;
          meet_link?: string | null;
          recruiter_id?: string;
          recruiter_response?: string;
          reschedule_count?: number;
          scheduled_by?: string | null;
          seeker_id?: string;
          seeker_response?: string;
          start_at?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_schedules_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_schedules_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_schedules_recruiter_id_fkey";
            columns: ["recruiter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_schedules_scheduled_by_fkey";
            columns: ["scheduled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interview_schedules_seeker_id_fkey";
            columns: ["seeker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          cover_note: string | null;
          created_at: string;
          id: string;
          job_id: string;
          portfolio_url: string | null;
          resume_file_name: string | null;
          resume_storage_path: string | null;
          resume_url: string | null;
          seeker_id: string;
          status: Database["public"]["Enums"]["application_status"];
        };
        Insert: {
          cover_note?: string | null;
          created_at?: string;
          id?: string;
          job_id: string;
          portfolio_url?: string | null;
          resume_file_name?: string | null;
          resume_storage_path?: string | null;
          resume_url?: string | null;
          seeker_id: string;
          status?: Database["public"]["Enums"]["application_status"];
        };
        Update: {
          cover_note?: string | null;
          created_at?: string;
          id?: string;
          job_id?: string;
          portfolio_url?: string | null;
          resume_file_name?: string | null;
          resume_storage_path?: string | null;
          resume_url?: string | null;
          seeker_id?: string;
          status?: Database["public"]["Enums"]["application_status"];
        };
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_seeker_id_fkey";
            columns: ["seeker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          created_at: string;
          id: string;
          industry: string | null;
          logo_url: string | null;
          name: string;
          recruiter_id: string;
          rejection_reason: string | null;
          status: Database["public"]["Enums"]["company_status"];
          website: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          industry?: string | null;
          logo_url?: string | null;
          name: string;
          recruiter_id: string;
          rejection_reason?: string | null;
          status?: Database["public"]["Enums"]["company_status"];
          website?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          industry?: string | null;
          logo_url?: string | null;
          name?: string;
          recruiter_id?: string;
          rejection_reason?: string | null;
          status?: Database["public"]["Enums"]["company_status"];
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "companies_recruiter_id_fkey";
            columns: ["recruiter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_categories: {
        Row: {
          id: string;
          scope: string;
          owner_recruiter_id: string | null;
          name: string;
          name_normalized: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          scope: string;
          owner_recruiter_id?: string | null;
          name: string;
          name_normalized?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          scope?: string;
          owner_recruiter_id?: string | null;
          name?: string;
          name_normalized?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_categories_owner_recruiter_id_fkey";
            columns: ["owner_recruiter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          application_deadline: string | null;
          job_category_id: string;
          closed_reason: string | null;
          company_id: string;
          created_at: string;
          description: string | null;
          id: string;
          job_type: Database["public"]["Enums"]["job_type"];
          location: string | null;
          recruiter_id: string;
          rejection_reason: string | null;
          salary_range: string | null;
          status: Database["public"]["Enums"]["job_status"];
          title: string;
        };
        Insert: {
          application_deadline?: string | null;
          job_category_id?: string;
          closed_reason?: string | null;
          company_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          job_type?: Database["public"]["Enums"]["job_type"];
          location?: string | null;
          recruiter_id: string;
          rejection_reason?: string | null;
          salary_range?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          title: string;
        };
        Update: {
          application_deadline?: string | null;
          job_category_id?: string;
          closed_reason?: string | null;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          job_type?: Database["public"]["Enums"]["job_type"];
          location?: string | null;
          recruiter_id?: string;
          rejection_reason?: string | null;
          salary_range?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_recruiter_id_fkey";
            columns: ["recruiter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_job_category_id_fkey";
            columns: ["job_category_id"];
            isOneToOne: false;
            referencedRelation: "job_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          resume_file_name: string | null;
          resume_storage_path: string | null;
          role: Database["public"]["Enums"]["user_role"];
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          resume_file_name?: string | null;
          resume_storage_path?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          resume_file_name?: string | null;
          resume_storage_path?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Relationships: [];
      };
      job_revisions: {
        Row: {
          id: string;
          job_id: string;
          submitted_by: string;
          title: string;
          description: string | null;
          location: string | null;
          job_type: Database["public"]["Enums"]["job_type"];
          salary_range: string | null;
          application_deadline: string | null;
          baseline_title: string;
          baseline_description: string | null;
          baseline_location: string | null;
          baseline_job_type: Database["public"]["Enums"]["job_type"];
          baseline_salary_range: string | null;
          baseline_application_deadline: string | null;
          job_category_id: string;
          baseline_job_category_id: string;
          status: Database["public"]["Enums"]["review_status"];
          rejection_reason: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          submitted_by: string;
          title: string;
          description?: string | null;
          location?: string | null;
          job_type: Database["public"]["Enums"]["job_type"];
          salary_range?: string | null;
          application_deadline?: string | null;
          baseline_title: string;
          baseline_description?: string | null;
          baseline_location?: string | null;
          baseline_job_type: Database["public"]["Enums"]["job_type"];
          baseline_salary_range?: string | null;
          baseline_application_deadline?: string | null;
          job_category_id?: string;
          baseline_job_category_id?: string;
          status?: Database["public"]["Enums"]["review_status"];
          rejection_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          submitted_by?: string;
          title?: string;
          description?: string | null;
          location?: string | null;
          job_type?: Database["public"]["Enums"]["job_type"];
          salary_range?: string | null;
          application_deadline?: string | null;
          baseline_title?: string;
          baseline_description?: string | null;
          baseline_location?: string | null;
          baseline_job_type?: Database["public"]["Enums"]["job_type"];
          baseline_salary_range?: string | null;
          baseline_application_deadline?: string | null;
          job_category_id?: string;
          baseline_job_category_id?: string;
          status?: Database["public"]["Enums"]["review_status"];
          rejection_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_revisions_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_revisions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_jobs: {
        Row: {
          created_at: string;
          id: string;
          job_id: string;
          seeker_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          job_id: string;
          seeker_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          job_id?: string;
          seeker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_jobs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_jobs_seeker_id_fkey";
            columns: ["seeker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_role_is: {
        Args: { _r: Database["public"]["Enums"]["user_role"] };
        Returns: boolean;
      };
      admin_review_company: {
        Args: { _company_id: string; _decision: string; _reason?: string | null };
        Returns: Database["public"]["Tables"]["companies"]["Row"];
      };
      admin_review_job: {
        Args: { _job_id: string; _decision: string; _reason?: string | null };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
      submit_job_revision: {
        Args: {
          _job_id: string;
          _title: string;
          _description: string | null;
          _location: string | null;
          _job_type: Database["public"]["Enums"]["job_type"];
          _salary_range: string | null;
          _application_deadline: string | null;
          _job_category_id?: string;
        };
        Returns: Database["public"]["Tables"]["job_revisions"]["Row"];
      };
      job_category_assignable: {
        Args: { _category_id: string; _user_id: string };
        Returns: boolean;
      };
      admin_review_job_revision: {
        Args: { _revision_id: string; _decision: string; _reason?: string | null };
        Returns: Database["public"]["Tables"]["job_revisions"]["Row"];
      };
      /** PROPOSED_0013 / replaced by PROPOSED_0014 (also stamps closed_reason). */
      close_expired_approved_jobs: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      /** PROPOSED_0014 — owner-only reopen of expiry-auto-closed jobs. */
      recruiter_reopen_expired_job: {
        Args: { _job_id: string; _new_deadline: string };
        Returns: Database["public"]["Tables"]["jobs"]["Row"];
      };
    };
    Enums: {
      application_status: "applied" | "shortlisted" | "interview" | "hired" | "rejected";
      company_status: "pending" | "approved" | "rejected";
      job_status: "pending" | "approved" | "closed" | "rejected";
      job_type: "full_time" | "part_time" | "contract";
      review_status: "pending" | "approved" | "rejected";
      user_role: "job_seeker" | "recruiter" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      application_status: ["applied", "shortlisted", "interview", "hired", "rejected"],
      company_status: ["pending", "approved", "rejected"],
      job_status: ["pending", "approved", "closed", "rejected"],
      job_type: ["full_time", "part_time", "contract"],
      review_status: ["pending", "approved", "rejected"],
      user_role: ["job_seeker", "recruiter", "admin"],
    },
  },
} as const;
