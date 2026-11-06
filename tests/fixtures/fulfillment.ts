import type { Actor, Manifest } from "../../src/lib/fulfillment/model";

// Fictional examples only; mappings and quantities are not operational defaults.
export const manifest: Manifest = {
  id: "example-order",
  eventId: "example-event",
  source: {
    kind: "googleSheet",
    key: "example-sheet/tab/registration",
    revision: "r1",
  },
  mappingVersion: "fictional-v1",
  householdLabel: "Example household",
  dietary: null,
  notes: "Example baby request retained for picking",
  lines: [
    {
      id: "rice",
      originalRequest: "Rice",
      item: "Rice",
      stage: "advanceDry",
      storage: "ambient",
      quantity: 2,
      unit: "bags",
      shelf: "Pantry 01",
    },
    {
      id: "diapers",
      originalRequest: "Diapers size 3",
      item: "Diapers size 3",
      stage: "advanceDry",
      storage: "ambient",
      quantity: 1,
      unit: "pack",
      shelf: "Supplies 01",
    },
    {
      id: "produce",
      originalRequest: "Apples",
      item: "Apples",
      stage: "afterArrival",
      storage: "ambient",
      quantity: 1,
      unit: "bag",
      shelf: "Produce 01",
    },
    {
      id: "milk",
      originalRequest: "Milk",
      item: "Milk",
      stage: "afterArrival",
      storage: "chilled",
      quantity: 1,
      unit: "carton",
      shelf: "Cooler 01",
    },
    {
      id: "frozen",
      originalRequest: "Frozen vegetables",
      item: "Frozen vegetables",
      stage: "afterArrival",
      storage: "frozen",
      quantity: 1,
      unit: "bag",
      shelf: "Freezer 01",
    },
  ],
};
export const actors: Record<string, Actor> = {
  packer: { id: "packer-a", eventId: manifest.eventId, role: "packer" },
  otherPacker: { id: "packer-b", eventId: manifest.eventId, role: "packer" },
  runner: { id: "runner-a", eventId: manifest.eventId, role: "runner" },
  coordinator: {
    id: "coordinator",
    eventId: manifest.eventId,
    role: "coordinator",
  },
  bridge: { id: "station", eventId: manifest.eventId, role: "arrivalBridge" },
};
export const arrival = {
  id: "station/event/registration",
  revision: 1,
  checkedInAt: "2026-11-07T16:00:00Z",
  line: "blue" as const,
  number: "007",
  vehicle: "White van",
};
