import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const orderData = await request.json();

        // Ensure the order is tied to the authenticated user
        const finalOrder = {
            ...orderData,
            userId: uid,
            createdAt: new Date().toISOString(),
            status: "PENDING",
            packingStatus: {
                dryGoods: "PENDING",
                freshGoods: "PENDING"
            }
        };

        const docRef = await adminDb.collection("orders").add(finalOrder);

        return NextResponse.json({ id: docRef.id });
    } catch (error) {
        console.error("Error submitting order via API:", error);
        return NextResponse.json({ error: "Failed to submit order" }, { status: 500 });
    }
}
