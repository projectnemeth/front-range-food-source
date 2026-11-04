import { z } from "zod";
import { itemKeys } from "./catalog";
import { COLORADO_COUNTIES } from "./counties";
import { validDate } from "./dates";
export const shortText = z.string().trim().min(1).max(200);
const count = z.number().int().min(0).max(100);
export const familySchema = z
  .object({
    adults: count,
    children: count,
    seniors: count,
    total: count.optional(),
  })
  .strict()
  .refine(
    (v) => v.adults + v.children + v.seniors > 0,
    "At least one household member is required",
  );
export const profileSchema = z
  .object({
    firstName: shortText,
    lastName: shortText,
    address: shortText,
    phone: z
      .string()
      .trim()
      .max(30)
      .refine(
        (v) => /^\+?1?\d{10}$/.test(v.replace(/[^\d+]/g, "")),
        "Enter a valid phone number",
      ),
    county: shortText.refine((v) => COLORADO_COUNTIES.includes(v)),
    foodBankId: z.string().trim().max(100).optional(),
    familySize: familySchema,
  })
  .strict();
export const dietarySchema = z
  .object({
    hasRestrictions: z.boolean().nullable(),
    glutenFreeCount: count,
    veganCount: count,
  })
  .strict();
export const babySchema = z
  .object({
    hasBaby: z.boolean().nullable(),
    needs: z
      .object({ diapers: z.boolean(), formula: z.boolean() })
      .strict()
      .nullable(),
    details: z
      .object({
        diaperSize: z.string().trim().max(100),
        formulaType: z.string().trim().max(200),
        other: z.string().trim().max(2000),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.hasBaby &&
      (!v.needs ||
        !v.details ||
        (v.needs.diapers && !v.details.diaperSize) ||
        (v.needs.formula && !v.details.formulaType))
    )
      c.addIssue({
        code: "custom",
        message: "Supply requested diaper size and formula type",
      });
  });
export const orderSchema = z
  .object({
    batchId: z.string().regex(/^[\w-]{1,150}$/),
    selectedItems: z
      .array(z.string().refine((v) => itemKeys.includes(v)))
      .max(itemKeys.length)
      .refine((v) => new Set(v).size === v.length),
    otherItems: z.string().trim().max(2000),
    confirmedPickup: z.literal(true),
    disclaimerAgreed: z.literal(true),
    disclaimerVersion: z.literal("2026-11-03"),
    dietaryRestrictions: dietarySchema,
    babyNeeds: babySchema,
  })
  .strict();
export const dateSchema = z.string().refine(validDate, "Invalid pickup date");
export type FamilySize = z.infer<typeof familySchema>;
export type Dietary = z.infer<typeof dietarySchema>;
export type BabyNeeds = z.infer<typeof babySchema>;
export interface UserProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: "USER" | "ADMIN";
  phone: string;
  familySize: FamilySize;
}
export interface Order {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string;
  userPhone?: string;
  createdAt: string;
  status?: string;
  batchId?: string;
  pickupDate?: string;
  items?: string;
  otherItems?: string;
  selectedItems?: string[];
  dryGoodsItems?: string[];
  freshGoodsItems?: string[];
  dietaryRestrictions?: Dietary;
  babyNeeds?: BabyNeeds;
  familySize?: FamilySize;
  packingStatus?: {
    dryGoods: "PENDING" | "PACKED";
    freshGoods: "PENDING" | "PACKED";
  };
}
