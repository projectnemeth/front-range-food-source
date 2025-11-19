"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import Link from "next/link";

interface Order {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    items: string;
    status: string;
    createdAt: string;
}

export default function AdminDashboard() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(true);

    useEffect(() => {
        if (!loading) {
            if (!user || profile?.role !== "ADMIN") {
                // In a real app, we'd redirect to home or 403
                // For now, let's just redirect home
                router.push("/");
            } else {
                fetchOrders();
            }
        }
    }, [user, profile, loading, router]);

    const fetchOrders = async () => {
        try {
            const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            const ordersData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Order));
            setOrders(ordersData);
        } catch (err) {
            console.error("Error fetching orders:", err);
        }
        setLoadingOrders(false);
    };

    if (loading || loadingOrders) return <div className="text-center mt-md">Loading...</div>;

    if (profile?.role !== "ADMIN") return null;

    return (
        <div>
            <div className="flex justify-between items-center mb-md">
                <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                <div className="flex gap-sm">
                    <Link href="/admin/settings" className="btn btn-secondary">
                        Settings
                    </Link>
                    <Link href="/admin/print" className="btn btn-primary">
                        Print View
                    </Link>
                </div>
            </div>

            <div className="flex flex-col gap-md">
                {orders.length === 0 ? (
                    <p className="text-center text-muted">No orders found.</p>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className="card">
                            <div className="flex justify-between items-start mb-sm">
                                <div>
                                    <h3 className="font-bold">{order.userName}</h3>
                                    <p className="text-sm text-muted">{order.userEmail}</p>
                                </div>
                                <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                                    {new Date(order.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="mt-sm">
                                <h4 className="text-sm font-bold mb-xs">Items:</h4>
                                <p className="whitespace-pre-wrap">{order.items}</p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
