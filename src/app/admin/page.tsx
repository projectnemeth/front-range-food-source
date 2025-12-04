"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, where, getCountFromServer, doc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";
import { getCurrentBatchId } from "@/lib/batchUtils";

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
    batchId?: string;
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

interface Batch {
    id: string;
    name: string;
    createdAt: string;
    status: string;
}

export default function AdminDashboard() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { t } = useLanguage();
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
    const [batches, setBatches] = useState<Batch[]>([]);
    const [selectedBatchId, setSelectedBatchId] = useState<string>("");

    useEffect(() => {
        if (!loading) {
            if (!user || profile?.role !== "ADMIN") {
                router.push("/");
            } else {
                fetchInitialData();
            }
        }
    }, [user, profile, loading, router]);

    // Fetch batches and set initial selected batch
    const fetchInitialData = async () => {
        try {
            // Fetch batches
            const q = query(collection(db, "batches"), orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);
            const batchesData = snapshot.docs.map(doc => doc.data() as Batch);
            setBatches(batchesData);

            // Get current batch ID from settings
            const currentId = await getCurrentBatchId();

            // Default to current batch if exists, otherwise the most recent one
            if (currentId) {
                setSelectedBatchId(currentId);
            } else if (batchesData.length > 0) {
                setSelectedBatchId(batchesData[0].id);
            }

            // If we have a batch ID (either current or most recent), fetch data for it
            // If no batches exist yet, we might want to fetch all or nothing. 
            // For now, let's assume if there are no batches, we just show empty state or all orders?
            // The requirement implies filtering by batch. If no batch system was used before, old orders have no batchId.
            // Let's handle the case where selectedBatchId might be empty.

        } catch (err) {
            console.error("Error fetching batches:", err);
        }
    };

    // Fetch data whenever selectedBatchId changes
    useEffect(() => {
        if (selectedBatchId) {
            fetchData(selectedBatchId);
        } else if (!loadingData && batches.length === 0) {
            // Fallback for initial load or no batches: maybe fetch all? 
            // Or just wait for fetchInitialData to set it.
            // If fetchInitialData runs, it sets selectedBatchId, which triggers this.
            // If no batches exist, we might want to run a "no batch" fetch.
            fetchData("");
        }
    }, [selectedBatchId]);


    const fetchData = async (batchId: string) => {
        setLoadingData(true);
        try {
            // 1. Fetch Orders (Filtered by Batch if provided)
            let q;
            if (batchId) {
                q = query(collection(db, "orders"), where("batchId", "==", batchId), orderBy("createdAt", "desc"));
            } else {
                // Fallback: fetch all orders (or maybe just recent ones?)
                // If we implemented batching, we should probably enforce it. 
                // But for backward compatibility, let's fetch all if no batch selected.
                q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            }

            const querySnapshot = await getDocs(q);
            const ordersData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Order));
            setOrders(ordersData);

            // 2. Calculate Order Stats (Based on filtered orders)
            const totalOrders = ordersData.length;
            const pendingOrders = ordersData.filter(o => o.status === "PENDING").length;
            const completedOrders = ordersData.filter(o => o.status === "COMPLETED").length;

            // 3. Calculate 90-Day Rolling View (Weekly) - This might need to be independent of batch?
            // The requirement says "dashboard cards to reflect orders... in each batch".
            // But "Orders (Last 90 Days)" is a trend chart. Usually trend charts are global.
            // However, if I select a batch from a month ago, should the trend chart change?
            // "Current stats would only reflect current batch."
            // Let's keep the trend chart global for now as it gives context, 
            // OR we could make it specific to the batch timeframe? 
            // A batch is usually a week. So a trend chart of a single batch isn't very useful (it's just one point).
            // Let's keep the trend chart as "Global 90 Day Trend" regardless of batch selection, 
            // but the "Order Status" card will be batch-specific.

            // Re-fetching global orders for the trend chart if we are filtered by batch is expensive.
            // Maybe we just don't update the trend chart? Or we do a separate query for it.
            // Let's do a separate query for the trend chart to keep it accurate globally.

            const trendQ = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            // Optimization: Limit to last 1000 or something? For now, fetch all is okay for MVP.
            const trendSnapshot = await getDocs(trendQ);
            const allOrdersData = trendSnapshot.docs.map(doc => ({ ...doc.data() } as Order));

            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            const weeklyMap = new Map<string, number>();

            allOrdersData.forEach(order => {
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

            const weeklyOrders: WeeklyStats[] = Array.from(weeklyMap.entries())
                .map(([weekStart, count]) => ({ weekStart, count }))
                .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

            // 4. Fetch User Stats (Global)
            const usersColl = collection(db, "users");
            const usersSnapshot = await getCountFromServer(usersColl);
            const totalFamilies = usersSnapshot.data().count;

            // 5. Fetch New Users (Last 21 Days) (Global)
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

            // Update stats locally
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

    if (loading) return <div className="text-center mt-md">{t("common.loading")}</div>;

    if (profile?.role !== "ADMIN") return null;

    return (
        <div>
            <div className="flex justify-between items-center mb-md">
                <h1 className="text-2xl font-bold">{t("admin.dashboard")}</h1>
                <div className="flex gap-sm">
                    <Link href="/admin/settings" className="btn btn-secondary">
                        {t("admin.settings")}
                    </Link>
                    <Link href="/admin/print" className="btn btn-primary">
                        {t("admin.printView")}
                    </Link>
                </div>
            </div>

            {/* Batch Selector */}
            <div className="mb-md">
                <label className="label">{t("admin.selectBatch")}</label>
                <select
                    className="input"
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                >
                    <option value="">All Orders (Legacy)</option>
                    {batches.map(batch => (
                        <option key={batch.id} value={batch.id}>
                            {batch.name} {batch.status === "OPEN" ? `(${t("settings.open")})` : ""}
                        </option>
                    ))}
                </select>
            </div>

            {loadingData ? (
                <div className="text-center py-lg">{t("common.loading")}</div>
            ) : (
                <>
                    {/* Widgets Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-md mb-lg">
                        {/* Card 1: Order Breakdown */}
                        <div className="card">
                            <h3 className="text-lg font-bold text-muted mb-sm">{t("admin.orderStatus")}</h3>
                            <div className="flex flex-col gap-xs">
                                <div className="flex justify-between">
                                    <span>{t("admin.totalSubmitted")}:</span>
                                    <span className="font-bold">{stats.totalOrders}</span>
                                </div>
                                <div className="flex justify-between text-green-700">
                                    <span>{t("admin.filledPacked")}:</span>
                                    <span className="font-bold">{stats.completedOrders}</span>
                                </div>
                                <div className="flex justify-between text-yellow-700">
                                    <span>{t("admin.toBeFilled")}:</span>
                                    <span className="font-bold">{stats.pendingOrders}</span>
                                </div>
                            </div>
                        </div>

                        {/* Card 2: New Registrations */}
                        <div className="card text-center flex flex-col justify-center">
                            <h3 className="text-lg font-bold text-muted mb-xs">{t("admin.newFamilies")}</h3>
                            <p className="text-4xl font-bold text-primary">{stats.newFamilies21Days}</p>
                            <p className="text-sm text-muted mt-xs">{t("admin.totalFamilies")}: {stats.totalFamilies}</p>
                        </div>

                        {/* Card 3: 90-Day Weekly Trend */}
                        <div className="card">
                            <h3 className="text-lg font-bold text-muted mb-sm">{t("admin.orders90Days")}</h3>
                            <div className="flex flex-col gap-xs overflow-y-auto" style={{ maxHeight: "150px" }}>
                                {stats.weeklyOrders.length === 0 ? (
                                    <p className="text-sm text-muted">{t("admin.noRecentOrders")}</p>
                                ) : (
                                    stats.weeklyOrders.map((week) => (
                                        <div key={week.weekStart} className="flex justify-between text-sm">
                                            <span>{t("admin.weekOf")} {new Date(week.weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                            <span className="font-bold">{week.count}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    <h2 className="text-xl font-bold mb-md">{t("admin.recentOrders")}</h2>
                    <div className="flex flex-col gap-md">
                        {orders.length === 0 ? (
                            <p className="text-center text-muted">{t("admin.noOrdersFound")}</p>
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
                                                        {t("admin.markCompleted")}
                                                    </button>
                                                )}
                                                {order.status === 'COMPLETED' && (
                                                    <button
                                                        onClick={() => handleStatusUpdate(order.id, "PENDING")}
                                                        disabled={updatingId === order.id}
                                                        className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 transition-colors"
                                                    >
                                                        {t("admin.markPending")}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-sm">
                                        <h4 className="text-sm font-bold mb-xs">{t("admin.items")}</h4>
                                        <p className="whitespace-pre-wrap">{order.items}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
