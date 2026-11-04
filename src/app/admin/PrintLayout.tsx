"use client";
import { useLayoutEffect, useRef } from "react";
import type { Order } from "@/lib/schemas";
import { checklistConfig, freshKeys } from "@/lib/catalog";
import { formatPickupDate } from "@/lib/dates";
export type PrintOrder = Order;
function chunks(value: string): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of value.match(/\S+\s*|\s+/g) ?? []) {
    for (const token of word.match(/[\s\S]{1,120}/g) ?? []) {
      if (line.length + token.length > 160) {
        result.push(line);
        line = "";
      }
      line += token;
    }
  }
  if (line) result.push(line);
  return result;
}
export default function PrintLayout({
  orders,
  t,
  language,
}: {
  orders: Order[];
  t: (key: string) => string;
  language: string;
}) {
  const source = useRef<HTMLDivElement>(null),
    output = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!source.current || !output.current) return;
    const target = output.current;
    target.replaceChildren();
    for (const part of Array.from(source.current.children)) {
      const header = part.firstElementChild!;
      let page: HTMLElement;
      let count = 0;
      const create = () => {
        const next = document.createElement("section");
        next.className = "packing-page";
        next.append(header.cloneNode(true));
        target.append(next);
        count++;
        return next;
      };
      page = create();
      for (const block of Array.from(part.children).slice(1)) {
        const clone = block.cloneNode(true);
        page.append(clone);
        if (page.scrollHeight > page.clientHeight) {
          page.removeChild(clone);
          page = create();
          page.append(clone);
        }
      }
      // Each part consumes complete sheets, based on measured page count rather than a fixed spacer assumption.
      if (count % 2) {
        const blank = document.createElement("section");
        blank.className = "packing-page packing-blank";
        blank.textContent = "\u00a0";
        target.append(blank);
      }
    }
    return () => target.replaceChildren();
  }, [orders, t, language]);
  return (
    <div id="print-container">
      <div className="packing-source" ref={source} aria-hidden="true">
        {orders.flatMap((order) =>
          [false, true].map((fresh) => {
            const items = fresh
              ? (order.freshGoodsItems ??
                order.selectedItems?.filter((k) => freshKeys.has(k)) ??
                [])
              : (order.dryGoodsItems ??
                order.selectedItems?.filter((k) => !freshKeys.has(k)) ??
                []);
            const diet = order.dietaryRestrictions,
              baby = order.babyNeeds;
            const dietText =
              !diet || diet.hasRestrictions === null
                ? t("fix.notRecorded")
                : !diet.hasRestrictions
                  ? t("fix.none")
                  : `${t("fix.glutenFree")}: ${diet.glutenFreeCount}; ${t("fix.vegan")}: ${diet.veganCount}`;
            const babyText =
              !baby || baby.hasBaby === null
                ? t("fix.notRecorded")
                : !baby.hasBaby
                  ? t("fix.none")
                  : [
                      baby.needs?.diapers
                        ? `${t("fix.diapers")}: ${baby.details?.diaperSize || t("fix.notRecorded")}`
                        : "",
                      baby.needs?.formula
                        ? `${t("fix.formula")}: ${baby.details?.formulaType || t("fix.notRecorded")}`
                        : "",
                      baby.details?.other ?? "",
                    ]
                      .filter(Boolean)
                      .join("; ");
            return (
              <article key={`${order.id}-${fresh}`}>
                <header className="packing-header">
                  <h1>{order.userName}</h1>
                  <p>{order.userPhone || t("fix.notRecorded")}</p>
                  <p>
                    {t("fix.pickup")}:{" "}
                    {formatPickupDate(order.pickupDate, language)} ·{" "}
                    {t("fix.order")}: {order.id}
                  </p>
                  <h2>{t(fresh ? "fix.fresh" : "fix.dry")}</h2>
                  <strong>
                    {t("fix.dietary")}: {dietText}
                  </strong>
                </header>
                {order.familySize && (
                  <p>
                    {t("fix.household")}: {t("fix.adults")}{" "}
                    {order.familySize.adults}; {t("fix.children")}{" "}
                    {order.familySize.children}; {t("fix.seniors")}{" "}
                    {order.familySize.seniors}
                  </p>
                )}
                {!fresh &&
                  chunks(`${t("fix.baby")}: ${babyText}`).map((text, i) => (
                    <p className="packing-notes" key={`baby-${i}`}>
                      {text}
                    </p>
                  ))}
                {Object.entries(checklistConfig).flatMap(([section, keys]) => {
                  const selected = items.filter((k) => keys.includes(k));
                  if (!selected.length) return [];
                  return [
                    <h3 key={`section-${section}`}>
                      {t(`request.sections.${section}`)}
                    </h3>,
                    ...selected.map((k) => (
                      <p className="packing-item" key={`item-${k}`}>
                        □ {t(`request.items.${k}`)}
                      </p>
                    )),
                  ];
                })}
                {!items.length && <p>{t("fix.empty")}</p>}
                {!fresh &&
                  chunks(order.otherItems || order.items || "").map(
                    (text, i) => (
                      <p className="packing-notes" key={`note-${i}`}>
                        {i === 0 ? `${t("fix.notes")}: ` : ""}
                        {text}
                      </p>
                    ),
                  )}
                <p>
                  □ {t("fix.packed")}　□ {t("fix.pickedUp")}
                </p>
              </article>
            );
          }),
        )}
      </div>
      <div className="packing-pages" ref={output} />
    </div>
  );
}
