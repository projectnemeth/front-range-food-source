import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
    console.log('API Route: /api/validate-registration called');

    try {
        const body = await req.json();
        const { firstName, lastName, address, phone, foodBankId } = body;

        console.log('Validating data for:', { firstName, lastName, phone: '***', address: '***' });

        const usersRef = adminDb.collection('users');

        // Check Phone
        const phoneSnap = await usersRef.where('phone', '==', phone).get();
        if (!phoneSnap.empty) {
            console.warn('Duplicate phone found');
            return NextResponse.json({ error: 'duplicatePhone' }, { status: 400 });
        }

        // Check Address
        const addressSnap = await usersRef.where('address', '==', address).get();
        if (!addressSnap.empty) {
            console.warn('Duplicate address found');
            return NextResponse.json({ error: 'duplicateAddress' }, { status: 400 });
        }

        // Check Food Bank ID
        if (foodBankId) {
            const idSnap = await usersRef.where('foodBankId', '==', foodBankId).get();
            if (!idSnap.empty) {
                console.warn('Duplicate Food Bank ID found');
                return NextResponse.json({ error: 'duplicateFoodBankId' }, { status: 400 });
            }
        }

        // Check Name
        const nameSnap = await usersRef
            .where('firstName', '==', firstName)
            .where('lastName', '==', lastName)
            .get();
        if (!nameSnap.empty) {
            console.warn('Duplicate name found');
            return NextResponse.json({ error: 'duplicateName' }, { status: 400 });
        }

        console.log('Validation successful');
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API validation error:', error);
        return NextResponse.json({ error: 'serverError' }, { status: 500 });
    }
}
