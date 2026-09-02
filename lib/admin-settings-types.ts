export type AdminSettings = {
  id: string;
  name: string;
  is_open: boolean;
  delivery_fee_cents: number;
  delivery_minutes_min: number | null;
  delivery_minutes_max: number | null;
  updated_at: string;
};

export type AdminSettingsResult =
  | { data: AdminSettings; error?: never }
  | { data?: never; error: string; unauthorized?: boolean };

export type SettingsMutationResult =
  | { data: AdminSettings; message: string; error?: never }
  | { data?: never; error: string; conflict?: boolean; unauthorized?: boolean };
