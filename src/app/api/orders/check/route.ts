import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const batchId = searchParams.get("batchId");

        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ") || !batchId) {
            return NextResponse.json({ error: "Unauthorized or missing parameters" }, { status: 401 });
        }

        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const ordersRef = adminDb.collection("orders");
        const snapshot = await ordersRef
            .where("userId", "==", uid)
            .where("batchId", "==", batchId)
            .limit(1)
            .get();

        return NextResponse.json({ hasOrdered: !snapshot.empty });
    } catch (error) {
        console.error("Error checking order via API:", error);
        return NextResponse.json({ error: "Failed to check order" }, { status: 500 });
    }
}
