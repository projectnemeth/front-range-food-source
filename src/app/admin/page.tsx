"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, where, getCountFromServer, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";

interface Order {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    items: string;
    scheduledDate?: string;
    scheduledTime?: string;
    status: string;
    createdAt: string;
}

interface DashboardStats {
    totalOrders: number;
    pendingOrders: number;
    totalFamilies: number;
}

export default function AdminDashboard() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const [orders, setOrders] = useState<Order[]>([]);
    const [stats, setStats] = useState<DashboardStats>({ totalOrders: 0, pendingOrders: 0, totalFamilies: 0 });
    const [loadingData, setLoadingData] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        if (!loading) {
            if (!user || profile?.role !== "ADMIN") {
                router.push("/");
            } else {
                fetchData();
            }
        }
    }, [user, profile, loading, router]);

    const fetchData = async () => {
        try {
            // Fetch Orders
            const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            const ordersData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Order));
            setOrders(ordersData);

            // Calculate Stats
            // Note: In a real app with many docs, use getCountFromServer or aggregation queries.
            // For now, calculating from fetched docs (for orders) and separate count for users.

            const totalOrders = ordersData.length;
            const pendingOrders = ordersData.filter(o => o.status === "PENDING").length;

            // Fetch User Count (Families)
            const usersColl = collection(db, "users");
            const usersSnapshot = await getCountFromServer(usersColl); // Efficient count
            const totalFamilies = usersSnapshot.data().count;

            setStats({
                totalOrders,
                pendingOrders,
                totalFamilies
            });

        } catch (err) {
            console.error("Error fetching admin data:", err);
        }
        setLoadingData(false);
    };

    const handleStatusUpdate = async (orderId: string, newStatus: string) => {
        setUpdatingId(orderId);
        try {
            const orderRef = doc(db, "orders", orderId);
            await updateDoc(orderRef, { status: newStatus });

            // Update local state
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));

            // Update stats locally
            if (newStatus === "COMPLETED") {
                setStats(prev => ({ ...prev, pendingOrders: prev.pendingOrders - 1 }));
            } else if (newStatus === "PENDING") {
                setStats(prev => ({ ...prev, pendingOrders: prev.pendingOrders + 1 }));
            }

        } catch (err) {
            console.error("Error updating status:", err);
            alert("Failed to update status");
        }
        setUpdatingId(null);
    };

    if (loading || loadingData) return <div className="text-center mt-md">Loading...</div>;

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

            {/* Widgets Section */}
            <div className="grid grid-cols-3 gap-md mb-lg">
                <div className="card text-center">
                    <h3 className="text-lg font-bold text-muted mb-xs">Pending Orders</h3>
                    <p className="text-3xl font-bold text-primary">{stats.pendingOrders}</p>
                </div>
                <div className="card text-center">
                    <h3 className="text-lg font-bold text-muted mb-xs">Total Orders</h3>
                    <p className="text-3xl font-bold">{stats.totalOrders}</p>
                </div>
                <div className="card text-center">
                    <h3 className="text-lg font-bold text-muted mb-xs">Registered Families</h3>
                    <p className="text-3xl font-bold">{stats.totalFamilies}</p>
                </div>
            </div>

            <h2 className="text-xl font-bold mb-md">Recent Orders</h2>
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
                                    {order.scheduledDate && (
                                        <p className="text-sm text-primary mt-xs">
                                            <strong>Pickup:</strong> {order.scheduledDate} ({order.scheduledTime})
                                        </p>
                                    )}
                                </div>
                                <div className="text-right flex flex-col items-end gap-xs">
                                    <span className={`text-sm px-2 py-1 rounded ${order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                        {order.status}
                                    </span>
                                    <div className="text-xs text-muted">
                                        {new Date(order.createdAt).toLocaleDateString()}
                                    </div>

                                    {order.status === 'PENDING' && (
                                        <button
                                            onClick={() => handleStatusUpdate(order.id, "COMPLETED")}
                                            disabled={updatingId === order.id}
                                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
                                        >
                                            {updatingId === order.id ? "..." : "Mark Completed"}
                                        </button>
                                    )}
                                </div>
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
