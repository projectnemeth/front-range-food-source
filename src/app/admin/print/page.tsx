"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";

interface Order {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    items: string;
    status: string;
    createdAt: string;
}

export default function PrintView() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { t } = useLanguage();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(true);

    useEffect(() => {
        if (!loading) {
            if (!user || profile?.role !== "ADMIN") {
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

    if (loading || loadingOrders) return <div>{t("common.loading")}</div>;

    if (profile?.role !== "ADMIN") return null;

    return (
        <div className="print-container">
            <style jsx global>{`
        @media print {
          .no-print { display: none; }
          .print-container { padding: 20px; }
          .order-item { break-inside: avoid; page-break-inside: avoid; border-bottom: 1px solid #ccc; padding-bottom: 20px; margin-bottom: 20px; }
        }
        .order-item { border-bottom: 1px solid #eee; padding-bottom: 1rem; margin-bottom: 1rem; }
      `}</style>

            <div className="no-print flex justify-between items-center mb-lg p-md bg-gray-100 rounded">
                <h1 className="text-xl font-bold">{t("admin.printView")}</h1>
                <div className="flex gap-sm">
                    <button onClick={() => window.print()} className="btn btn-primary">Print</button>
                    <button onClick={() => router.push("/admin")} className="btn btn-secondary">{t("common.backToDashboard")}</button>
                </div>
            </div>

            <div>
                <h1 className="text-2xl font-bold mb-lg text-center">Front Range Food Source - {t("admin.recentOrders")}</h1>
                <p className="text-center mb-lg text-muted">Generated on {new Date().toLocaleDateString()}</p>

                {orders.map(order => (
                    <div key={order.id} className="order-item">
                        <div className="flex justify-between mb-sm">
                            <h3 className="font-bold text-lg">{order.userName}</h3>
                            <span className="text-sm">{new Date(order.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm mb-xs"><strong>{t("common.email")}:</strong> {order.userEmail}</p>
                        <div className="mt-sm">
                            <strong>{t("admin.items")}</strong>
                            <p className="whitespace-pre-wrap mt-xs p-sm bg-gray-50 rounded border border-gray-200" style={{ backgroundColor: "#F9FAFB" }}>
                                {order.items}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
