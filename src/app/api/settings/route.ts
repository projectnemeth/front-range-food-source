import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export async function GET() {
    try {
        const docRef = adminDb.collection("settings").doc("global");
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return NextResponse.json(docSnap.data());
        }

        return NextResponse.json({ isFormOpen: false }, { status: 404 });
    } catch (error) {
        console.error("Error fetching settings via API:", error);
        return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
    }
}
