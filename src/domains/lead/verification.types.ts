export interface LeadDetailsInput {
  sellerId: string;
  block: string;
  street: string;
  town: string;
  askingPrice?: number;
  sellingTimeline: 'one_to_three_months' | 'three_to_six_months' | 'just_thinking';
  sellingReason: 'upgrading' | 'downsizing' | 'relocating' | 'financial' | 'investment' | 'other';
  sellingReasonOther?: string;
}
