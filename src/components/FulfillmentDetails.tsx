import type { Order } from "@/lib/schemas";
export default function FulfillmentDetails({
  order,
  t,
  baby = true,
}: {
  order: Order;
  t: (key: string) => string;
  baby?: boolean;
}) {
  const diet = order.dietaryRestrictions,
    needs = order.babyNeeds;
  return (
    <div className="fulfillment-details">
      <p>
        <strong>{t("fix.dietary")}:</strong>{" "}
        {!diet || diet.hasRestrictions === null
          ? t("fix.notRecorded")
          : !diet.hasRestrictions
            ? t("fix.none")
            : `${t("fix.glutenFree")}: ${diet.glutenFreeCount}; ${t("fix.vegan")}: ${diet.veganCount}`}
      </p>
      {order.familySize && (
        <p>
          {t("fix.household")}: {t("fix.adults")} {order.familySize.adults};{" "}
          {t("fix.children")} {order.familySize.children}; {t("fix.seniors")}{" "}
          {order.familySize.seniors}
        </p>
      )}
      {baby && (
        <div>
          <strong>{t("fix.baby")}:</strong>{" "}
          {!needs || needs.hasBaby === null ? (
            t("fix.notRecorded")
          ) : !needs.hasBaby ? (
            t("fix.none")
          ) : (
            <>
              {needs.needs?.diapers && (
                <p>
                  {t("fix.diapers")}:{" "}
                  {needs.details?.diaperSize || t("fix.notRecorded")}
                </p>
              )}
              {needs.needs?.formula && (
                <p>
                  {t("fix.formula")}:{" "}
                  {needs.details?.formulaType || t("fix.notRecorded")}
                </p>
              )}
              {needs.details?.other && (
                <p>
                  {t("fix.notes")}: {needs.details.other}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
