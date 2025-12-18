'use server';

import { adminDb } from '@/lib/firebase-admin';

export const validateRegistrationData = async (data: {
    firstName: string;
    lastName: string;
    address: string;
    phone: string;
    foodBankId?: string;
}) => {
    console.log('Server Action: validateRegistrationData called with:', { ...data, phone: '***', address: '***' });
    const { firstName, lastName, address, phone, foodBankId } = data;

    try {
        const usersRef = adminDb.collection('users');

        // Check Phone
        const phoneSnap = await usersRef.where('phone', '==', phone).get();
        if (!phoneSnap.empty) {
            return { error: 'duplicatePhone' };
        }

        // Check Address
        const addressSnap = await usersRef.where('address', '==', address).get();
        if (!addressSnap.empty) {
            return { error: 'duplicateAddress' };
        }

        // Check Food Bank ID
        if (foodBankId) {
            const idSnap = await usersRef.where('foodBankId', '==', foodBankId).get();
            if (!idSnap.empty) {
                return { error: 'duplicateFoodBankId' };
            }
        }

        // Check Name
        const nameSnap = await usersRef
            .where('firstName', '==', firstName)
            .where('lastName', '==', lastName)
            .get();
        if (!nameSnap.empty) {
            return { error: 'duplicateName' };
        }

        return { success: true };
    } catch (error) {
        console.error('Validation error:', error);
        return { error: 'serverError' };
    }
}
