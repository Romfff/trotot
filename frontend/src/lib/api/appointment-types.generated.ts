// Generated from backend OpenAPI. Run node scripts/generate-appointment-types.mjs; do not hand-edit.
export type CreateAppointmentDto = {
  propertyId: string;
  tenantName: string;
  tenantPhone: string;
  scheduledDate: string;
  scheduledTime: string;
  notes?: string;
};

export type AppointmentActionDto = {
  expectedStatus: "PENDING" | "ACCEPTED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  reason?: string;
};

export type AppointmentResponseDto = {
  id: string;
  propertyId: string;
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  reason: string | null;
  notes: string | null;
  cancelledBy: "TENANT" | "HOST" | "SYSTEM" | null;
  createdAt: string;
  updatedAt: string;
};

export type HostAppointmentResponseDto = {
  id: string;
  propertyId: string;
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  reason: string | null;
  notes: string | null;
  cancelledBy: "TENANT" | "HOST" | "SYSTEM" | null;
  createdAt: string;
  updatedAt: string;
  tenantName: string;
  tenantPhone: string;
  simultaneousAppointments: number;
};

export type NotificationResponseDto = {
  id: string;
  appointmentId: string;
  type: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

export type CostEstimateLineDto = {
  code: "RENT" | "ELECTRICITY" | "WATER" | "INTERNET" | "GARBAGE" | "PARKING";
  label: string;
  unitPrice: string | null;
  unit: "VND/ROOM/MONTH" | "VND/KWH" | "VND/M3" | "VND/PERSON/MONTH" | "VND/VEHICLE/MONTH";
  quantity: number | null;
  amount: number | null;
  status: "FIXED" | "COMPUTED" | "NEEDS_INPUT" | "NOT_DECLARED" | "FREE";
};

export type CostEstimateDto = {
  lines: (CostEstimateLineDto)[];
  totalMonthly: number;
  deposit: number | null;
  missingInputs: (string)[];
  missingCosts: (string)[];
  isComplete: boolean;
  disclaimer: string;
};
