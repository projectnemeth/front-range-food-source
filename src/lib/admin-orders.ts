import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  limit,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import type { Order } from "./schemas";
export type Cursor = QueryDocumentSnapshot<DocumentData>;
export async function loadOrders(batchId: string, cursor?: Cursor) {
  const constraints: QueryConstraint[] = [
    orderBy("createdAt", "desc"),
    limit(50),
  ];
  if (batchId !== "*") constraints.unshift(where("batchId", "==", batchId));
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(collection(db, "orders"), ...constraints));
  const profiles = new Map(
    await Promise.all(
      [...new Set(snap.docs.map((d) => d.data().userId as string))].map(
        async (uid) => {
          const profile = await getDoc(doc(db, "users", uid));
          return [uid, profile.data()] as const;
        },
      ),
    ),
  );
  return {
    orders: snap.docs.map((d) => {
      const data = d.data();
      const profile = profiles.get(data.userId);
      return {
        ...data,
        id: d.id,
        userPhone: data.userPhone || profile?.phone,
        familySize: data.familySize || profile?.familySize,
      } as Order;
    }),
    cursor: snap.docs.at(-1),
    more: snap.size === 50,
  };
}
