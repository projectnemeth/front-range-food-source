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

interface WeeklyStats {
    weekStart: string; // ISO date string of the Sunday
    count: number;
}

interface DashboardStats {
    totalOrders: number;
    pendingOrders: number;
    completedOrders: number;
    totalFamilies: number;
    newFamilies21Days: number;
    weeklyOrders: WeeklyStats[];
}

export default function AdminDashboard() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const [orders, setOrders] = useState<Order[]>([]);
    const [stats, setStats] = useState<DashboardStats>({
        totalOrders: 0,
        pendingOrders: 0,
        completedOrders: 0,
        totalFamilies: 0,
        newFamilies21Days: 0,
        weeklyOrders: []
    });
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
            // 1. Fetch Orders
            const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            const ordersData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Order));
            setOrders(ordersData);

            // 2. Calculate Order Stats
            const totalOrders = ordersData.length;
            const pendingOrders = ordersData.filter(o => o.status === "PENDING").length;
            const completedOrders = ordersData.filter(o => o.status === "COMPLETED").length;

            // 3. Calculate 90-Day Rolling View (Weekly)
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const weeklyMap = new Map<string, number>();

            ordersData.forEach(order => {
                const orderDate = new Date(order.createdAt);
                if (orderDate >= ninetyDaysAgo) {
                    // Get start of week (Sunday)
                    const weekStart = new Date(orderDate);
                    weekStart.setDate(orderDate.getDate() - orderDate.getDay());
                    weekStart.setHours(0, 0, 0, 0);
                    const key = weekStart.toISOString();

                    weeklyMap.set(key, (weeklyMap.get(key) || 0) + 1);
                }
            });

            // Fill in missing weeks for the last 90 days? Optional, but looks better.
            // For now, just sorting the existing data.
            const weeklyOrders: WeeklyStats[] = Array.from(weeklyMap.entries())
                .map(([weekStart, count]) => ({ weekStart, count }))
                .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

            // 4. Fetch User Stats
            const usersColl = collection(db, "users");
            const usersSnapshot = await getCountFromServer(usersColl);
            const totalFamilies = usersSnapshot.data().count;

            // 5. Fetch New Users (Last 21 Days)
            const twentyOneDaysAgo = new Date();
            twentyOneDaysAgo.setDate(twentyOneDaysAgo.getDate() - 21);
            const twentyOneDaysAgoISO = twentyOneDaysAgo.toISOString();

            const newUsersQuery = query(usersColl, where("createdAt", ">=", twentyOneDaysAgoISO));
            const newUsersSnapshot = await getCountFromServer(newUsersQuery);
            const newFamilies21Days = newUsersSnapshot.data().count;

            setStats({
                totalOrders,
                pendingOrders,
                completedOrders,
                totalFamilies,
                newFamilies21Days,
                weeklyOrders
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

            // Update stats locally (simplified, ideally re-fetch or careful decrement/increment)
            // Since we have multiple counters, re-fetching might be safer but slower.
            // Let's do local update for responsiveness.
            const oldStatus = orders.find(o => o.id === orderId)?.status;
            if (oldStatus !== newStatus) {
                setStats(prev => {
                    const newStats = { ...prev };
                    if (oldStatus === "PENDING") newStats.pendingOrders--;
                    if (oldStatus === "COMPLETED") newStats.completedOrders--;

                    if (newStatus === "PENDING") newStats.pendingOrders++;
                    if (newStatus === "COMPLETED") newStats.completedOrders++;

                    return newStats;
                });
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

            {/* Widgets Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-md mb-lg">
                {/* Card 1: Order Breakdown */}
                <div className="card">
                    <h3 className="text-lg font-bold text-muted mb-sm">Order Status</h3>
                    <div className="flex flex-col gap-xs">
                        <div className="flex justify-between">
                            <span>Total Submitted:</span>
                            <span className="font-bold">{stats.totalOrders}</span>
                        </div>
                        <div className="flex justify-between text-green-700">
                            <span>Filled / Packed:</span>
                            <span className="font-bold">{stats.completedOrders}</span>
                        </div>
                        <div className="flex justify-between text-yellow-700">
                            <span>To Be Filled:</span>
                            <span className="font-bold">{stats.pendingOrders}</span>
                        </div>
                    </div>
                </div>

                {/* Card 2: New Registrations */}
                <div className="card text-center flex flex-col justify-center">
                    <h3 className="text-lg font-bold text-muted mb-xs">New Families (21 Days)</h3>
                    <p className="text-4xl font-bold text-primary">{stats.newFamilies21Days}</p>
                    <p className="text-sm text-muted mt-xs">Total Families: {stats.totalFamilies}</p>
                </div>

                {/* Card 3: 90-Day Weekly Trend */}
                <div className="card">
                    <h3 className="text-lg font-bold text-muted mb-sm">Orders (Last 90 Days)</h3>
                    <div className="flex flex-col gap-xs overflow-y-auto" style={{ maxHeight: "150px" }}>
                        {stats.weeklyOrders.length === 0 ? (
                            <p className="text-sm text-muted">No recent orders.</p>
                        ) : (
                            stats.weeklyOrders.map((week) => (
                                <div key={week.weekStart} className="flex justify-between text-sm">
                                    <span>Week of {new Date(week.weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                    <span className="font-bold">{week.count}</span>
                                </div>
                            ))
                        )}
                    </div>
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
                                </div>
                                <div className="text-right flex flex-col items-end gap-xs">
                                    <span className={`text-sm px-2 py-1 rounded ${order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                        {order.status}
                                    </span>
                                    <div className="text-xs text-muted">
                                        {new Date(order.createdAt).toLocaleDateString()}
                                    </div>

                                    <div className="flex gap-xs mt-xs">
                                        {order.status === 'PENDING' && (
                                            <button
                                                onClick={() => handleStatusUpdate(order.id, "COMPLETED")}
                                                disabled={updatingId === order.id}
                                                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
                                            >
                                                Mark Completed
                                            </button>
                                        )}
                                        {order.status === 'COMPLETED' && (
                                            <button
                                                onClick={() => handleStatusUpdate(order.id, "PENDING")}
                                                disabled={updatingId === order.id}
                                                className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 transition-colors"
                                            >
                                                Mark Pending
                                            </button>
                                        )}
                                    </div>
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
