import Coordinator from "./Coordinator";
export const dynamic = "force-dynamic";
export default function CoordinatorPage() {
  if (process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true")
    return (
      <section>
        <h1>Fulfillment setup</h1>
        <p>Phase Two is not enabled.</p>
      </section>
    );
  return <Coordinator />;
}
