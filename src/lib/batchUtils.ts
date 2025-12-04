import { db } from "@/lib/firebase";
import { doc, setDoc, collection, addDoc, getDoc, updateDoc } from "firebase/firestore";

export const startNewBatch = async (type: "MANUAL" | "SCHEDULED", startDate: string) => {
    try {
        // 1. Create a new batch document
        const batchId = `BATCH_${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const batchName = `Batch ${new Date().toLocaleDateString()} (${type})`;

        const batchRef = doc(db, "batches", batchId);
        await setDoc(batchRef, {
            id: batchId,
            name: batchName,
            startDate: startDate,
            type: type,
            status: "OPEN",
            createdAt: new Date().toISOString()
        });

        // 2. Update global settings with the new currentBatchId
        const settingsRef = doc(db, "settings", "global");
        await setDoc(settingsRef, {
            currentBatchId: batchId
        }, { merge: true });

        return batchId;
    } catch (error) {
        console.error("Error starting new batch:", error);
        throw error;
    }
};

export const getCurrentBatchId = async () => {
    try {
        const settingsRef = doc(db, "settings", "global");
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
            return snap.data().currentBatchId;
        }
        return null;
    } catch (error) {
        console.error("Error getting current batch ID:", error);
        return null;
    }
};
