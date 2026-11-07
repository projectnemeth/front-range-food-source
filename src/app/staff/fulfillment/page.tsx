import DryPacking from "./DryPacking";
export const dynamic = "force-dynamic";
export default function FulfillmentPage() {
  if (process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true") {
    return (
      <section>
        <h1>Staff fulfillment</h1>
        <p>
          Phase Two is not enabled. Continue using the existing pickup workflow.
        </p>
      </section>
    );
  }
  return <DryPacking />;
}
