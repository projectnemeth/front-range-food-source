import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";

export async function GET(request: Request) {
    try {
        // Get the token from the Authorization header
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const docRef = adminDb.collection("users").doc(uid);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return NextResponse.json(docSnap.data());
        }

        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    } catch (error) {
        console.error("Error fetching profile via API:", error);
        return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }
}
