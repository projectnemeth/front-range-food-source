import React from 'react';

// Reusing the Order interface (subset) compatible with AdminDashboard
export interface PrintOrder {
    id: string;
    userId: string;
    userName: string;
    userPhone?: string; // We will populate this from the user profile
    dryGoodsItems?: string[];
    freshGoodsItems?: string[];
    otherItems?: string; // Legacy "items" or new "otherItems"
    pickupDate?: string;
    batchId?: string;
    createdAt: string;
}

interface PrintLayoutProps {
    orders: PrintOrder[];
    t: (key: string) => string;
    language: string;
}

// Config must match RequestPage (copied for stability)
const checklistConfig = {
    pantry: [
        "pastaSauce", "macNCheese", "rice", "skilletMeals", "cannedChicken",
        "cannedTuna", "cannedFish", "mashedPotatoes", "ramen", "cannedGoods",
        "applesauce", "refriedBeans", "blackBeans", "pintoBeans"
    ],
    additionalPantry: [
        "bakingSupplies", "broth", "spices", "peanutButter", "jelly", "condiments",
        "coffeeWhole", "coffeeGround", "coffeeKCups", "tea", "cereal",
        "oatmeal", "pancakes", "syrup"
    ],
    drinks: [
        "hotChocolate", "generalDrinks", "energyDrinks", "juice"
    ],
    homeGoods: [
        "dishwasherDetergent", "laundrySoap", "dishSoap", "multiPurposeCleaner",
        "bodyWash", "shampoo", "conditioner"
    ],
    petSupplies: [
        "catFoodDry", "catFoodWet", "catTreats", "catLitter",
        "dogFoodDry", "dogFoodWet", "dogTreats"
    ],
    snacks: [
        "snacks", "candy"
    ],
    freshRefrigerated: [
        "bread", "milkDairy", "milkNonDairy", "eggs", "otherDairy",
        "pastries", "freshFruits", "freshVegetables", "freshJuice"
    ],
    frozen: [
        "beef", "chicken", "fish", "ham", "turkey", "pork",
        "sausage", "preparedMeals", "gfPreparedMeals", "veganPreparedMeals",
        "frozenVegetables", "frozenFruit", "iceCream"
    ]
};

export default function PrintLayout({ orders, t, language }: PrintLayoutProps) {

    const getTranslatedItemName = (key: string) => {
        // We try to find the key in one of the sections
        const sections = [
            'pantry', 'additionalPantry', 'drinks', 'homeGoods', 'petSupplies', 'snacks',
            'freshRefrigerated', 'frozen'
        ];

        // Direct lookup via t function logic
        // The structure in translations.ts is request.items.[key]
        // We can just rely on that generic path if keys are unique (they are).
        return t(`request.items.${key}`);
    };

    // Helper to categorize items for display
    const getGroupedItems = (itemKeys: string[] | undefined, filterSections: string[]) => {
        if (!itemKeys || itemKeys.length === 0) return null;
        const groups: Record<string, string[]> = {};

        filterSections.forEach(section => {
            // @ts-ignore
            const sectionKeys = checklistConfig[section] as string[];
            const found = itemKeys.filter(k => sectionKeys.includes(k));
            if (found.length > 0) {
                groups[section] = found;
            }
        });

        return groups;
    };

    return (
        <div id="print-container" style={{ visibility: 'hidden' }}> {/* Initially hidden, shown by @media print */}
            {orders.map((order) => {
                const dryGroups = getGroupedItems(order.dryGoodsItems, ['pantry', 'additionalPantry', 'drinks', 'homeGoods', 'petSupplies', 'snacks']);
                const freshGroups = getGroupedItems(order.freshGoodsItems, ['freshRefrigerated', 'frozen']);

                // Format Pickup Date
                const pickupDate = order.pickupDate ? new Date(order.pickupDate).toLocaleDateString() : "N/A";

                return (
                    <div key={order.id}>
                        {/* ========================================================================================== */}
                        {/* PAGE 1: DRY GOODS (Part 1) */}
                        {/* ========================================================================================== */}
                        <div className="print-page page-break" style={{ padding: '2rem' }}>
                            {/* Header */}
                            <div style={{ borderBottom: '2px solid black', paddingBottom: '1rem', marginBottom: '2rem' }}>
                                <div style={{ fontSize: '3rem', fontWeight: 'bold' }}>
                                    {order.userName}
                                </div>
                                <div style={{ fontSize: '2rem', marginTop: '0.5rem' }}>
                                    {order.userPhone || "No Phone"}
                                </div>
                                <div style={{ marginTop: '1rem', fontSize: '1.2rem' }}>
                                    <strong>Pickup Date:</strong> {pickupDate}
                                </div>
                                <div style={{ marginTop: '0.5rem', color: '#666' }}>
                                    Order ID: {order.id.slice(0, 8)}
                                </div>
                            </div>

                            {/* Verification/Internal Use Box */}
                            <div style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '2rem', backgroundColor: '#f9f9f9', display: 'flex', justifyContent: 'space-between' }}>
                                <div>
                                    <strong>Part 1: Dry Goods & Household</strong>
                                </div>
                                <div style={{ display: 'flex', gap: '2rem' }}>
                                    <span>[ ] Packed</span>
                                    <span>[ ] Picked Up</span>
                                </div>
                            </div>

                            {/* Dry Goods List */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                {dryGroups && Object.keys(dryGroups).map(section => (
                                    <div key={section} style={{ marginBottom: '1.5rem', breakInside: 'avoid' }}>
                                        <h3 style={{ textTransform: 'uppercase', borderBottom: '1px solid #eee', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#444' }}>
                                            {t(`request.sections.${section}`)}
                                        </h3>
                                        <ul style={{ listStyle: 'none', padding: 0 }}>
                                            {dryGroups[section].map(key => (
                                                <li key={key} style={{ padding: '0.25rem 0', borderBottom: '1px dashed #eee', fontSize: '1.1rem' }}>
                                                    <span style={{ display: 'inline-block', width: '20px', height: '20px', border: '1px solid #333', marginRight: '10px', verticalAlign: 'middle' }}></span>
                                                    {getTranslatedItemName(key)}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>

                            {/* Other Items */}
                            {order.otherItems && (
                                <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #eee', borderRadius: '4px' }}>
                                    <strong>Other Items / Notes:</strong>
                                    <p style={{ whiteSpace: 'pre-wrap', fontSize: '1.1rem' }}>{order.otherItems}</p>
                                </div>
                            )}
                        </div>

                        {/* ========================================================================================== */}
                        {/* PAGE 2: BLANK (Safety Spacer) */}
                        {/* ========================================================================================== */}
                        <div className="print-page page-break" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#eee' }}>
                            (This page intentionally left blank for duplex printing safety)
                        </div>


                        {/* ========================================================================================== */}
                        {/* PAGE 3: MEAT & FROZEN (Part 2) - "Last Page" for Meat Guys */}
                        {/* ========================================================================================== */}
                        <div className="print-page page-break" style={{ padding: '2rem' }}>
                            {/* Header */}
                            <div style={{ borderBottom: '2px solid black', paddingBottom: '1rem', marginBottom: '2rem' }}>
                                <div style={{ fontSize: '3rem', fontWeight: 'bold' }}>
                                    {order.userName}
                                </div>
                                <div style={{ fontSize: '2rem', marginTop: '0.5rem' }}>
                                    {order.userPhone || "No Phone"}
                                </div>
                                <div style={{ marginTop: '1rem', fontSize: '1.2rem' }}>
                                    <strong>Pickup Date:</strong> {pickupDate}
                                </div>
                                <div style={{ marginTop: '0.5rem', fontSize: '1.2rem', color: 'blue' }}>
                                    <strong>PART 2: MEAT & FROZEN</strong>
                                </div>
                            </div>

                            {/* Verification/Internal Use Box */}
                            <div style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '2rem', backgroundColor: '#e6f7ff', display: 'flex', justifyContent: 'space-between' }}>
                                <div>
                                    <strong>Part 2: Fresh, Refrigerated & Frozen</strong>
                                </div>
                                <div style={{ display: 'flex', gap: '2rem' }}>
                                    <span>[ ] Packed</span>
                                    <span>[ ] Loaded</span>
                                </div>
                            </div>

                            {/* Meat/Fresh List */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
                                {freshGroups && Object.keys(freshGroups).map(section => (
                                    <div key={section} style={{ marginBottom: '1.5rem', breakInside: 'avoid' }}>
                                        <h3 style={{ textTransform: 'uppercase', borderBottom: '1px solid #eee', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#444' }}>
                                            {t(`request.sections.${section}`)}
                                        </h3>
                                        <ul style={{ listStyle: 'none', padding: 0 }}>
                                            {freshGroups[section].map(key => (
                                                <li key={key} style={{ padding: '0.5rem 0', borderBottom: '1px dashed #eee', fontSize: '1.4rem', fontWeight: '500' }}> {/* Larger font for warehouse visibility */}
                                                    <span style={{ display: 'inline-block', width: '24px', height: '24px', border: '2px solid #333', marginRight: '15px', verticalAlign: 'middle' }}></span>
                                                    {getTranslatedItemName(key)}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                                {!freshGroups && <p className="text-muted">No fresh items requested.</p>}
                            </div>
                        </div>

                        {/* ========================================================================================== */}
                        {/* PAGE 4: BLANK SPACER (To ensure next order starts on fresh sheet) */}
                        {/* ========================================================================================== */}
                        <div className="print-page page-break" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#eee' }}>
                            (End of Order Spacer)
                        </div>

                    </div>
                );
            })}
        </div>
    );
}
