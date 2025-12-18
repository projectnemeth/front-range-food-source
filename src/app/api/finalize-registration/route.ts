import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
    console.log('API Route: /api/finalize-registration called');

    try {
        const body = await req.json();
        const {
            uid,
            email,
            firstName,
            lastName,
            address,
            phone,
            county,
            foodBankId,
            familySize
        } = body;

        if (!uid) {
            return NextResponse.json({ error: 'Missing UID' }, { status: 400 });
        }

        console.log(`Creating profile for user: ${uid}`);

        await adminDb.collection('users').doc(uid).set({
            uid,
            email,
            firstName,
            lastName,
            displayName: `${firstName} ${lastName}`,
            address,
            phone,
            county,
            foodBankId,
            familySize,
            role: "USER",
            createdAt: new Date().toISOString()
        });

        console.log('Profile created successfully');
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API finalize-registration error:', error);
        return NextResponse.json({ error: 'serverError' }, { status: 500 });
    }
}
